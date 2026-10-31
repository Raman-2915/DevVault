import { Router } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { signToken } from "../middleware/auth.js";
import { HttpError, asyncHandler } from "../middleware/errors.js";
import { verificationEmail, resetEmail } from "../services/email.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Used to keep login timing similar when the email does not exist.
const DUMMY_HASH = bcrypt.hashSync("devvault-dummy-password", 10);

const VERIFY_MINUTES = 60;
const RESET_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;

const sha = (value) => createHash("sha256").update(String(value)).digest("hex");
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
const minutesFromNow = (m) => new Date(Date.now() + m * 60_000);

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function readEmail(value) {
  if (typeof value !== "string" || !EMAIL_PATTERN.test(value) || value.length > 254) {
    throw new HttpError(400, "A valid email is required.");
  }
  return value.trim().toLowerCase();
}

function readPassword(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new HttpError(400, "Password must be 8-128 characters.");
  }
  return value;
}

const SECRET_FIELDS = "+passwordHash +verifyCodeHash +verifyTokenHash +verifyExpires +verifyAttempts +verifySentAt +resetCodeHash +resetExpires +resetAttempts +resetSentAt";

export function createAuthRouter({ User, jwtConfig, mailer, emailConfig, limiters = {} }) {
  const router = Router();
  const sensitive = limiters.sensitive || ((_req, _res, next) => next());

  const session = (user) => ({
    token: signToken(user._id, jwtConfig, user.tokenVersion || 0),
    user: { id: String(user._id), name: user.name, email: user.email }
  });

  const tooSoon = (sentAt) => sentAt && Date.now() - new Date(sentAt).getTime() < RESEND_SECONDS * 1000;

  async function sendVerification(user) {
    const code = newCode();
    const token = randomBytes(32).toString("hex");

    await User.updateOne(
      { _id: user._id },
      { $set: { verifyCodeHash: sha(code), verifyTokenHash: sha(token), verifyExpires: minutesFromNow(VERIFY_MINUTES), verifyAttempts: 0 } }
    );

    const link = `${emailConfig.appUrl}/?verify=${token}`;

    try {
      await mailer.send({ to: user.email, ...verificationEmail({ name: user.name, code, link, minutes: VERIFY_MINUTES }) });
      // The resend cooldown only starts once an email really went out, so a failed send can be retried at once.
      await User.updateOne({ _id: user._id }, { $set: { verifySentAt: new Date() } });
      return true;
    } catch (error) {
      console.error(`[auth] could not send verification email: ${error.message}`);
      if (emailConfig.devFallback) {
        console.warn(`[auth:dev] Email delivery failed, so here is the code for ${user.email}: ${code}   (only shown outside production)`);
      }
      return false;
    }
  }

  // Checks a 6-digit code against a stored hash with an attempt limit. Returns true on success.
  async function checkCode(user, { hashField, expiresField, attemptsField, code }) {
    if (!user?.[hashField] || !user[expiresField] || new Date(user[expiresField]) < new Date()) return false;

    if ((user[attemptsField] || 0) >= MAX_ATTEMPTS) {
      throw new HttpError(429, "Too many wrong attempts. Request a new code.");
    }

    if (typeof code === "string" && /^\d{6}$/.test(code) && safeEqual(sha(code), user[hashField])) return true;

    await User.updateOne({ _id: user._id }, { $inc: { [attemptsField]: 1 } });
    return false;
  }

  router.post(
    "/register",
    asyncHandler(async (req, res) => {
      const { name, email, password } = req.body || {};

      if (typeof name !== "string" || !name.trim() || name.length > 100) {
        throw new HttpError(400, "A name (max 100 characters) is required.");
      }

      const normalized = readEmail(email);
      readPassword(password);

      if (await User.findOne({ email: normalized })) {
        throw new HttpError(409, "An account with this email already exists. Try logging in, or run `devvault verify --resend` if you never verified it.");
      }

      const user = await User.create({
        name: name.trim(),
        email: normalized,
        passwordHash: await bcrypt.hash(password, 12),
        emailVerified: !emailConfig.required,
        tokenVersion: 0
      });

      if (!emailConfig.required) return res.status(201).json(session(user));

      const emailSent = await sendVerification(user);
      res.status(201).json({ verificationRequired: true, email: normalized, emailSent });
    })
  );

  router.post(
    "/verify-email",
    sensitive,
    asyncHandler(async (req, res) => {
      const { email, code, token } = req.body || {};
      let user;

      if (typeof token === "string" && /^[a-f0-9]{64}$/.test(token)) {
        user = await User.findOne({ verifyTokenHash: sha(token) }).select(SECRET_FIELDS);
        if (!user || !user.verifyExpires || new Date(user.verifyExpires) < new Date()) {
          throw new HttpError(400, "This verification link is invalid or has expired. Request a new one.");
        }
      } else {
        user = await User.findOne({ email: readEmail(email) }).select(SECRET_FIELDS);
        const ok = await checkCode(user, { hashField: "verifyCodeHash", expiresField: "verifyExpires", attemptsField: "verifyAttempts", code });
        if (!ok) throw new HttpError(400, "Invalid or expired code.");
      }

      await User.updateOne(
        { _id: user._id },
        { $set: { emailVerified: true }, $unset: { verifyCodeHash: "", verifyTokenHash: "", verifyExpires: "", verifyAttempts: "", verifySentAt: "" } }
      );

      res.json(session(user));
    })
  );

  router.post(
    "/resend-verification",
    sensitive,
    asyncHandler(async (req, res) => {
      const user = await User.findOne({ email: readEmail(req.body?.email) }).select("+verifySentAt");

      if (user && user.emailVerified === false && !tooSoon(user.verifySentAt)) {
        await sendVerification(user);
      }

      // Same answer whether or not the account exists (no account enumeration).
      res.json({ ok: true, message: "If that account needs verification, a new code was sent." });
    })
  );

  router.post(
    "/forgot-password",
    sensitive,
    asyncHandler(async (req, res) => {
      const user = await User.findOne({ email: readEmail(req.body?.email) }).select("+resetSentAt");

      if (user && !tooSoon(user.resetSentAt)) {
        const code = newCode();
        await User.updateOne(
          { _id: user._id },
          { $set: { resetCodeHash: sha(code), resetExpires: minutesFromNow(RESET_MINUTES), resetAttempts: 0, resetSentAt: new Date() } }
        );

        try {
          await mailer.send({ to: user.email, ...resetEmail({ name: user.name, code, minutes: RESET_MINUTES }) });
        } catch (error) {
          console.error(`[auth] could not send reset email: ${error.message}`);
          if (emailConfig.devFallback) {
            console.warn(`[auth:dev] Email delivery failed, so here is the reset code for ${user.email}: ${code}   (only shown outside production)`);
          }
        }
      }

      res.json({ ok: true, message: "If that account exists, a reset code was sent." });
    })
  );

  router.post(
    "/reset-password",
    sensitive,
    asyncHandler(async (req, res) => {
      const { email, code, newPassword } = req.body || {};
      const password = readPassword(newPassword);
      const user = await User.findOne({ email: readEmail(email) }).select(SECRET_FIELDS);
      const ok = await checkCode(user, { hashField: "resetCodeHash", expiresField: "resetExpires", attemptsField: "resetAttempts", code });

      if (!ok) throw new HttpError(400, "Invalid or expired code.");

      await User.updateOne(
        { _id: user._id },
        {
          $set: { passwordHash: await bcrypt.hash(password, 12), emailVerified: true },
          $inc: { tokenVersion: 1 }, // signs out every existing session
          $unset: { resetCodeHash: "", resetExpires: "", resetAttempts: "", resetSentAt: "" }
        }
      );

      res.json({ ok: true, message: "Password updated. Please log in." });
    })
  );

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const { email, password } = req.body || {};

      if (typeof email !== "string" || typeof password !== "string") {
        throw new HttpError(400, "Email and password are required.");
      }

      const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+passwordHash");
      const valid = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);

      if (!user || !valid) {
        throw new HttpError(401, "Invalid email or password.");
      }

      if (user.emailVerified === false) {
        return res.status(403).json({ error: "Please verify your email before logging in.", code: "EMAIL_NOT_VERIFIED", email: user.email });
      }

      res.json(session(user));
    })
  );

  return router;
}

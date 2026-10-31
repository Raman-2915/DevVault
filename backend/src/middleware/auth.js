import jwt from "jsonwebtoken";

export function signToken(userId, { secret, expiresIn }, tokenVersion = 0) {
  return jwt.sign({ sub: String(userId), v: tokenVersion }, secret, { expiresIn, algorithm: "HS256" });
}

// Verifies the JWT, then checks the account still exists, is verified, and the token has not been
// invalidated by a password reset (tokenVersion).
const RENEW_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function requireAuth(secret, User, jwtConfig = null) {
  return async (req, res, next) => {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ error: "Authentication required.", code: "SESSION_INVALID" });
    }

    let payload;
    try {
      payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    } catch {
      return res.status(401).json({ error: "Invalid or expired token. Run `devvault login`.", code: "SESSION_INVALID" });
    }

    try {
      const user = await User.findOne({ _id: payload.sub }).select("tokenVersion emailVerified").lean();

      if (!user || (user.tokenVersion || 0) !== (payload.v || 0)) {
        return res.status(401).json({ error: "Session is no longer valid. Run `devvault login`.", code: "SESSION_INVALID" });
      }

      if (user.emailVerified === false) {
        return res.status(403).json({ error: "Please verify your email first.", code: "EMAIL_NOT_VERIFIED" });
      }

      // Sliding session: while you keep using DevVault your token is renewed, so you only sign in again on a
      // new device or after a long break.
      if (jwtConfig && payload.iat && Date.now() - payload.iat * 1000 > RENEW_AFTER_MS) {
        res.setHeader("X-DevVault-Token", signToken(payload.sub, jwtConfig, user.tokenVersion || 0));
      }

      req.userId = payload.sub;
      next();
    } catch (error) {
      next(error);
    }
  };
}

import { useEffect, useState } from "react";
import { api, setToken } from "../api.js";
import { LogoDial, Screws, PasswordField } from "../components.jsx";

const COOLDOWN = 60;

export default function Login({ onAuth, initialError = "", initialMode = "login" }) {
  const [mode, setMode] = useState(initialMode); // login | register | verify | forgot | reset
  const [form, setForm] = useState({ name: "", email: "", password: "", code: "", newPassword: "" });
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const update = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const go = (next, message = "") => {
    setMode(next);
    setError("");
    setNotice(message);
  };

  async function run(task) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const finish = (data) => {
    setToken(data.token);
    onAuth(data.user);
  };

  const sendCode = async () => {
    await api("POST", "/api/auth/resend-verification", { email: form.email });
    setCooldown(COOLDOWN);
  };

  const submit = (event) => {
    event.preventDefault();

    run(async () => {
      if (mode === "login") {
        try {
          finish(await api("POST", "/api/auth/login", { email: form.email, password: form.password }));
        } catch (err) {
          if (err.code !== "EMAIL_NOT_VERIFIED") throw err;
          await sendCode();
          go("verify", "Your email isn't verified yet. We sent a fresh 6-digit code.");
        }
      } else if (mode === "register") {
        const data = await api("POST", "/api/auth/register", { name: form.name, email: form.email, password: form.password });
        if (data.verificationRequired) {
          setCooldown(data.emailSent === false ? 0 : COOLDOWN);
          go("verify", data.emailSent === false ? "We couldn't send the email yet. Check the server log, then press “Resend code”." : `We emailed a 6-digit code to ${data.email}.`);
        } else {
          finish(data);
        }
      } else if (mode === "verify") {
        finish(await api("POST", "/api/auth/verify-email", { email: form.email, code: form.code.trim() }));
      } else if (mode === "forgot") {
        await api("POST", "/api/auth/forgot-password", { email: form.email });
        go("reset", "If that account exists, we sent a reset code (valid 15 minutes).");
      } else if (mode === "reset") {
        await api("POST", "/api/auth/reset-password", { email: form.email, code: form.code.trim(), newPassword: form.newPassword });
        setForm({ ...form, password: "", code: "", newPassword: "" });
        go("login", "Password updated. Please log in.");
      }
    });
  };

  const titles = { login: "Log in", register: "Create account", verify: "Verify email", forgot: "Forgot password", reset: "Reset password" };
  const buttons = { login: "Log in", register: "Create account", verify: "Verify", forgot: "Send reset code", reset: "Set new password" };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <Screws />
        <div className="brand big"><LogoDial size={46} /> <span>DevVault</span></div>
        <p className="muted">{titles[mode]}</p>

        {notice && <div className="notice">{notice}</div>}

        {mode === "register" && (
          <label>Name<input value={form.name} onChange={update("name")} required maxLength={100} autoComplete="name" /></label>
        )}

        <label>Email<input type="email" value={form.email} onChange={update("email")} required autoComplete="email" /></label>

        {(mode === "login" || mode === "register") && (
          <PasswordField value={form.password} onChange={update("password")} minLength={mode === "register" ? 8 : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        )}

        {(mode === "verify" || mode === "reset") && (
          <label>
            6-digit code
            <input className="lcd-input" value={form.code} onChange={update("code")} required inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" placeholder="000000" />
          </label>
        )}

        {mode === "reset" && (
          <PasswordField label="New password" value={form.newPassword} onChange={update("newPassword")} minLength={8} autoComplete="new-password" />
        )}

        {error && <div className="alert">{error}</div>}

        <button className="btn primary" disabled={busy}>{busy ? "Please wait…" : buttons[mode]}</button>

        {mode === "verify" && (
          <button type="button" className="link" disabled={cooldown > 0 || busy} onClick={() => run(async () => { await sendCode(); setNotice("A new code is on its way."); })}>
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
        )}

        {mode === "login" && (
          <>
            <button type="button" className="link" onClick={() => go("forgot")}>Forgot your password?</button>
            <button type="button" className="link" onClick={() => go("register")}>New here? Create an account</button>
          </>
        )}
        {mode !== "login" && <button type="button" className="link" onClick={() => go("login")}>Back to log in</button>}
        <a className="link auth-home" href="#/">← About DevVault &amp; install guide</a>
      </form>
    </div>
  );
}

// Transactional email over HTTPS APIs (works on hosts that block SMTP, e.g. Render's free tier).

export class MailError extends Error {}

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#d6cab0;font-family:Georgia,serif;color:#2a2118">
<div style="max-width:480px;margin:0 auto;background:#fbf6e9;border:1px solid #e1d4b4;border-radius:12px;padding:28px">
<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>${bodyHtml}
<p style="color:#6b5a45;font-size:12px;margin-top:24px">If you didn't request this, you can ignore this email.</p></div></body></html>`;
}

const codeBlock = (code) =>
  `<p style="font:700 32px/1 'Courier New',monospace;letter-spacing:8px;background:#12201a;color:#8dff9a;padding:16px;border-radius:8px;text-align:center">${escapeHtml(code)}</p>`;

export function verificationEmail({ name, code, link, minutes = 60 }) {
  return {
    subject: `Your DevVault verification code: ${code}`,
    text: `Hi ${name},\n\nYour DevVault verification code is ${code} (valid for ${minutes} minutes).\nIn the terminal run: devvault verify\nOr open: ${link}\n\nIf you didn't create this account, ignore this email.`,
    html: layout("Verify your email", `<p>Hi ${escapeHtml(name)}, enter this code in the terminal (<code>devvault verify</code>) or on the website:</p>${codeBlock(code)}<p><a href="${escapeHtml(link)}">Or verify with one click</a> (valid ${minutes} minutes).</p>`)
  };
}

export function resetEmail({ name, code, minutes = 15 }) {
  return {
    subject: `Your DevVault password reset code: ${code}`,
    text: `Hi ${name},\n\nYour password reset code is ${code} (valid for ${minutes} minutes).\nIn the terminal run: devvault reset-password\n\nIf you didn't ask for this, ignore this email; your password is unchanged.`,
    html: layout("Reset your password", `<p>Hi ${escapeHtml(name)}, use this code with <code>devvault reset-password</code> or on the website:</p>${codeBlock(code)}<p>It expires in ${minutes} minutes.</p>`)
  };
}

export function createMailer(config, fetchImpl = globalThis.fetch) {
  const { provider, from } = config;

  async function viaHttp(url, headers, body, label) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000)
      });
    } catch (error) {
      throw new MailError(`${label} request failed: ${error.message}`);
    }

    if (!response.ok) {
      let detail = "";
      try {
        detail = String(await response.text()).replace(/\s+/g, " ").slice(0, 200);
      } catch {
        // ignore
      }
      console.error(`[email] ${label} returned HTTP ${response.status}: ${detail}`);

      if (label === "Brevo" && /unrecogni[sz]ed IP|IP address|not authori[sz]ed/i.test(detail)) {
        const ip = /\b(?:\d{1,3}\.){3}\d{1,3}\b/.exec(detail)?.[0] || "this server's IP";
        throw new MailError(
          `Brevo blocked the sending IP (${ip}). Fix: Brevo > Settings > Security > Authorized IPs (https://app.brevo.com/security/authorised_ips): ` +
            `authorize that IP, or click "Deactivate blocking" for API keys (needed on Render, whose outbound IPs change).`
        );
      }

      throw new MailError(`${label} rejected the email (HTTP ${response.status}).`);
    }
  }

  async function send({ to, subject, html, text }) {
    if (provider === "console") {
      console.log(`\n[email:console] To: ${to}\n[email:console] Subject: ${subject}\n${text}\n`);
      return;
    }

    if (provider === "brevo") {
      return viaHttp("https://api.brevo.com/v3/smtp/email", { "api-key": config.brevoKey }, {
        sender: { name: from.name, email: from.email },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text
      }, "Brevo");
    }

    if (provider === "resend") {
      return viaHttp("https://api.resend.com/emails", { Authorization: `Bearer ${config.resendKey}` }, {
        from: `${from.name} <${from.email}>`,
        to: [to],
        subject,
        html,
        text
      }, "Resend");
    }

    // smtp (local development, or paid hosts). Loaded lazily so it is optional at runtime.
    try {
      const nodemailer = (await import("nodemailer")).default;
      const transport = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined
      });
      await transport.sendMail({ from: `"${from.name}" <${from.email}>`, to, subject, html, text });
    } catch (error) {
      throw new MailError(`SMTP send failed: ${error.message}`);
    }
  }

  return { send, provider };
}

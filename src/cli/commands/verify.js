import { apiRequest } from "../../api/client.js";
import { readUserConfig } from "../../config/userConfig.js";
import { startSession } from "../session.js";
import { ask } from "../prompt.js";

export const command = "verify";
export const describe = "Verify your email with the 6-digit code we sent you";

export const builder = (yargs) =>
  yargs
    .option("email", { type: "string", describe: "Your account email (default: the one you just registered)" })
    .option("code", { type: "string", describe: "The 6-digit code" })
    .option("resend", { type: "boolean", default: false, describe: "Send a new code" });

export async function resend(email) {
  await apiRequest("POST", "/api/auth/resend-verification", { email }, { auth: false });
  console.log(`If ${email} still needs verification, a new code is on its way (wait a minute between requests).`);
}

export async function completeVerification(email, code) {
  const entered = code || (await ask("Enter the 6-digit code (or type 'resend'): ")).trim();

  if (entered.toLowerCase() === "resend") {
    await resend(email);
    return completeVerification(email);
  }

  const result = await apiRequest("POST", "/api/auth/verify-email", { email, code: entered }, { auth: false });
  const session = startSession(result.user, result.token);
  console.log(`\n✔ Email verified. Signed in as ${result.user.email}.`);
  if (session.created) console.log(`Your personal vault was created at ${session.vault}`);
}

export const handler = async (argv) => {
  try {
    const email = argv.email || readUserConfig().pendingEmail || (await ask("Email: "));

    if (argv.resend) return await resend(email);
    await completeVerification(email, argv.code);
  } catch (error) {
    console.error(`\nVerification failed: ${error.message}`);
    process.exitCode = 1;
  }
};

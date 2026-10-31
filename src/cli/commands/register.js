import { apiRequest } from "../../api/client.js";
import { readUserConfig, writeUserConfig } from "../../config/userConfig.js";
import { ask } from "../prompt.js";
import { completeVerification } from "./verify.js";
import { startSession } from "../session.js";

export const command = "register";
export const describe = "Create a DevVault cloud account (sync, search and ask across devices)";

export const builder = (yargs) =>
  yargs
    .option("name", { type: "string", describe: "Your name" })
    .option("email", { type: "string", describe: "Account email" })
    .option("password", { type: "string", describe: "Password (prefer the hidden prompt)" })
    .option("api-url", { type: "string", describe: "DevVault server URL" });

export const handler = async (argv) => {
  try {
    if (argv.apiUrl) writeUserConfig({ ...readUserConfig(), apiUrl: argv.apiUrl.replace(/\/+$/, "") });

    const name = argv.name || (await ask("Name: "));
    const email = argv.email || (await ask("Email: "));
    const password = argv.password || (await ask("Password (min 8 chars): ", { hidden: true }));

    const result = await apiRequest("POST", "/api/auth/register", { name, email, password }, { auth: false });

    if (!result.verificationRequired) {
      startSession(result.user, result.token);
      console.log(`\n✔ Account created. Signed in as ${result.user.email}.`);
      return;
    }

    writeUserConfig({ ...readUserConfig(), pendingEmail: result.email });
    console.log(`\nAccount created. ${result.emailSent === false ? "We could not send the email; run `devvault verify --resend`." : `We emailed a 6-digit code to ${result.email}.`}`);

    if (process.stdin.isTTY) await completeVerification(result.email);
    else console.log("Then run: devvault verify");
  } catch (error) {
    console.error(`\nRegistration failed: ${error.message}`);
    process.exitCode = 1;
  }
};

import { apiRequest } from "../../api/client.js";
import { readUserConfig, writeUserConfig } from "../../config/userConfig.js";
import { ask } from "../prompt.js";
import { completeVerification, resend } from "./verify.js";
import { startSession } from "../session.js";

export const command = "login";
export const describe = "Log in to your DevVault cloud account";

export const builder = (yargs) =>
  yargs
    .option("email", { type: "string", describe: "Account email" })
    .option("password", { type: "string", describe: "Password (prefer the hidden prompt)" })
    .option("api-url", { type: "string", describe: "DevVault server URL" });

export const handler = async (argv) => {
  try {
    if (argv.apiUrl) writeUserConfig({ ...readUserConfig(), apiUrl: argv.apiUrl.replace(/\/+$/, "") });

    const email = argv.email || (await ask("Email: "));
    const password = argv.password || (await ask("Password: ", { hidden: true }));

    try {
      const result = await apiRequest("POST", "/api/auth/login", { email, password }, { auth: false });
      const session = startSession(result.user, result.token);
      console.log(`\n✔ Signed in as ${result.user.email}. You'll stay signed in on this device.`);
      if (session.created) console.log(`Your personal vault was created at ${session.vault}`);
      if (session.adopted) console.log("Your earlier notes on this computer were moved into your account's vault.");
    } catch (error) {
      if (error.code !== "EMAIL_NOT_VERIFIED") throw error;

      console.log("\nYour email is not verified yet.");
      writeUserConfig({ ...readUserConfig(), pendingEmail: email });

      if (!process.stdin.isTTY) {
        console.log("Run: devvault verify   (or `devvault verify --resend` for a new code)");
        process.exitCode = 1;
        return;
      }

      await resend(email);
      await completeVerification(email);
    }
  } catch (error) {
    console.error(`\nLogin failed: ${error.message}`);
    process.exitCode = 1;
  }
};

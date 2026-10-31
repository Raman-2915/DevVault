import { apiRequest } from "../../api/client.js";
import { readUserConfig } from "../../config/userConfig.js";
import { ask } from "../prompt.js";

export const command = "reset-password";
export const describe = "Set a new password using the code from your email";

export const builder = (yargs) =>
  yargs
    .option("email", { type: "string" })
    .option("code", { type: "string", describe: "6-digit code from the email" })
    .option("new-password", { type: "string", describe: "New password (prefer the hidden prompt)" });

export const handler = async (argv) => {
  try {
    const email = argv.email || readUserConfig().pendingEmail || (await ask("Account email: "));
    const code = argv.code || (await ask("6-digit code: ")).trim();
    const newPassword = argv.newPassword || (await ask("New password (min 8 chars): ", { hidden: true }));

    await apiRequest("POST", "/api/auth/reset-password", { email, code, newPassword }, { auth: false });
    console.log("\nPassword updated. All old sessions were signed out. Run: devvault login");
  } catch (error) {
    console.error(`\nReset failed: ${error.message}`);
    process.exitCode = 1;
  }
};

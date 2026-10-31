import { apiRequest } from "../../api/client.js";
import { writeUserConfig, readUserConfig } from "../../config/userConfig.js";
import { ask } from "../prompt.js";

export const command = "forgot-password";
export const describe = "Email yourself a code to reset a forgotten password";

export const builder = (yargs) => yargs.option("email", { type: "string" });

export const handler = async (argv) => {
  try {
    const email = argv.email || (await ask("Account email: "));
    await apiRequest("POST", "/api/auth/forgot-password", { email }, { auth: false });
    writeUserConfig({ ...readUserConfig(), pendingEmail: email });
    console.log("If that account exists, we sent a 6-digit reset code (valid 15 minutes).\nThen run: devvault reset-password");
  } catch (error) {
    console.error(`\nRequest failed: ${error.message}`);
    process.exitCode = 1;
  }
};

import { apiRequest } from "../../api/client.js";
import { clearAuth, readUserConfig } from "../../config/userConfig.js";
import { ask, confirm } from "../prompt.js";

export const command = "account <action>";
export const describe = "Account tools: `whoami`, or `delete` to erase your cloud account and all its data";

export const builder = (yargs) =>
  yargs
    .positional("action", { choices: ["whoami", "delete"] })
    .option("password", { type: "string", describe: "Password (prefer the hidden prompt)" })
    .option("yes", { alias: "y", type: "boolean", default: false });

export const handler = async (argv) => {
  try {
    if (argv.action === "whoami") {
      const { user } = await apiRequest("GET", "/api/me");
      console.log(`${user.name} <${user.email}>`);
      return;
    }

    const email = readUserConfig().user?.email;
    console.log(`This permanently deletes the cloud account ${email || ""} and everything synced to it.`);
    console.log("Your local vault on this computer is NOT deleted.");

    if (!argv.yes && !(await confirm("Delete the cloud account?"))) return console.log("Cancelled.");

    const password = argv.password || (await ask("Password: ", { hidden: true }));
    await apiRequest("DELETE", "/api/me", { password });
    clearAuth();
    console.log("Account deleted.");
  } catch (error) {
    console.error(`Account failed: ${error.message}`);
    process.exitCode = 1;
  }
};

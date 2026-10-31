import path from "node:path";
import { initializeStorage, isInitialized, getDevVaultPath } from "../../storage/localStorage.js";

export const command = "init";

export const describe = "Set up your personal DevVault (once per user; all projects share it)";

export const builder = (yargs) =>
  yargs.option("local", {
    type: "boolean",
    default: false,
    describe: "Advanced: create a separate vault in the current folder instead of your personal one"
  });

export const handler = (argv) => {
  if (argv.local) {
    process.env.DEVVAULT_VAULT_DIR = path.join(process.cwd(), ".devvault");
  }

  if (isInitialized()) {
    console.log(`DevVault is already set up. Your vault: ${getDevVaultPath()}`);
    return;
  }

  initializeStorage();

  console.log("DevVault is ready.");
  console.log(`Your vault: ${getDevVaultPath()}`);
  console.log("You only need to do this once. From any project folder you can now run:");
  console.log("  devvault note \"what I just learned\"      keep a quick note for the current project");
  console.log("  devvault run -- npm test                   run a command; get past solutions if it fails");
  console.log("  devvault explain .                         understand a project in plain English");
};

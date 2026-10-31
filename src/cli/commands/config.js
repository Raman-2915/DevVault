import { getApiUrl, getUserConfigPath, readUserConfig, setSetting } from "../../config/userConfig.js";
import { getDevVaultPath } from "../../storage/localStorage.js";

export const command = "config <action> [key] [value]";
export const describe = "Show or change settings (api-url, auto-sync)";

export const builder = (yargs) =>
  yargs
    .positional("action", { choices: ["show", "set"], describe: "show settings or set one" })
    .positional("key", { type: "string", describe: "api-url | auto-sync" })
    .positional("value", { type: "string" });

export const handler = (argv) => {
  try {
    if (argv.action === "show") {
      const config = readUserConfig();
      console.log(`Vault:      ${getDevVaultPath()}`);
      console.log(`Settings:   ${getUserConfigPath()}`);
      console.log(`api-url:    ${getApiUrl()}`);
      console.log(`auto-sync:  ${config.autoSync ? "on" : "off"}`);
      console.log(`Logged in:  ${config.user?.email || "no"}`);
      return;
    }

    if (argv.key === "api-url") {
      if (!/^https?:\/\/[^\s]+$/i.test(argv.value || "")) throw new Error("Give a full URL, e.g. https://devvault.onrender.com");
      setSetting("apiUrl", argv.value.replace(/\/+$/, ""));
      console.log(`api-url set to ${argv.value.replace(/\/+$/, "")}`);
    } else if (argv.key === "auto-sync") {
      const on = ["on", "true", "yes", "1"].includes(String(argv.value).toLowerCase());
      if (!on && !["off", "false", "no", "0"].includes(String(argv.value).toLowerCase())) throw new Error("Use: config set auto-sync on|off");
      setSetting("autoSync", on);
      console.log(`auto-sync ${on ? "on: notes and captured errors upload automatically when you're logged in" : "off"}`);
    } else {
      throw new Error("Unknown setting. Use: api-url or auto-sync.");
    }
  } catch (error) {
    console.error(`Config failed: ${error.message}`);
    process.exitCode = 1;
  }
};

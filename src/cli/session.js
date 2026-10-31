import { readUserConfig, setSetting, writeUserConfig } from "../config/userConfig.js";
import { getUserVaultPath, adoptLegacyVault } from "../storage/vault.js";
import { initializeStorage, isInitialized, getDevVaultPath } from "../storage/localStorage.js";

// Called after any successful sign-in: point the CLI at this account's own vault, create it if needed, and
// turn on auto-sync so the dashboard always shows what you just did.
export function startSession(user, token) {
  writeUserConfig({ ...readUserConfig(), token, user, pendingEmail: undefined });

  const dir = getUserVaultPath(user.id);
  const adopted = adoptLegacyVault(dir);
  process.env.DEVVAULT_VAULT_DIR = dir;

  const created = !isInitialized();
  if (created) initializeStorage();
  if (readUserConfig().autoSync === undefined) setSetting("autoSync", true);

  return { vault: getDevVaultPath(), created, adopted };
}

export function isLoggedIn() {
  const config = readUserConfig();
  return Boolean(config.token && config.user?.id);
}

// Commands usable without an account: everything needed to GET one, plus diagnostics.
export const OPEN_COMMANDS = new Set([
  "start", "setup", "login", "register", "verify", "forgot-password", "reset-password", "config", "doctor", "help", "completion"
]);

export function gateMessage() {
  return [
    "",
    "Welcome to DevVault!",
    "",
    "Please sign in first, so your notes, fixes and projects appear in your dashboard.",
    "",
    "  First time here?     devvault start      (guided setup, about a minute)",
    "  Already registered?  devvault login",
    "",
    "Need help? Run: devvault doctor",
    ""
  ].join("\n");
}

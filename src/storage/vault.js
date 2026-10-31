import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readUserConfig } from "../config/userConfig.js";

const VAULT_FILES = ["config.json", "knowledge.json", "projects.json", "history.json", "last-error.json"];

export function getGlobalVaultPath() {
  return path.join(os.homedir(), ".devvault");
}

// Every account gets its own local vault, so signing in as someone else on the same computer can never
// mix their notes into your cloud account.
export function getUserVaultPath(userId) {
  return path.join(getGlobalVaultPath(), "users", String(userId).replace(/[^a-zA-Z0-9_-]/g, "_"));
}

// Older versions kept ONE vault directly in ~/.devvault. The first account to sign in adopts it.
export function adoptLegacyVault(userDir) {
  const legacy = getGlobalVaultPath();
  if (fs.existsSync(path.join(userDir, "config.json")) || !fs.existsSync(path.join(legacy, "config.json"))) return false;

  fs.mkdirSync(userDir, { recursive: true });
  for (const file of VAULT_FILES) {
    const from = path.join(legacy, file);
    if (fs.existsSync(from)) fs.renameSync(from, path.join(userDir, file));
  }
  return true;
}

// Decides which vault the CLI uses:
//   1. DEVVAULT_VAULT_DIR, if set explicitly
//   2. the signed-in account's own vault  (~/.devvault/users/<id>)
//   3. anonymous/legacy mode (only reachable with DEVVAULT_ALLOW_ANONYMOUS=1): ./.devvault if it exists,
//      otherwise ~/.devvault
export function selectVault() {
  if (process.env.DEVVAULT_VAULT_DIR) return process.env.DEVVAULT_VAULT_DIR;

  const config = readUserConfig();
  if (config.token && config.user?.id) {
    const dir = getUserVaultPath(config.user.id);
    adoptLegacyVault(dir);
    process.env.DEVVAULT_VAULT_DIR = dir;
    return dir;
  }

  const local = path.join(process.cwd(), ".devvault");
  if (fs.existsSync(path.join(local, "config.json"))) return local;

  process.env.DEVVAULT_VAULT_DIR = getGlobalVaultPath();
  return process.env.DEVVAULT_VAULT_DIR;
}

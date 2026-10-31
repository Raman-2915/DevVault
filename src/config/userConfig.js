import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Per-user (not per-workspace) settings: API URL + auth token.
// Deliberately NOT ~/.devvault, which would collide with a workspace in the home directory.
export function getUserConfigPath() {
  if (process.env.DEVVAULT_HOME) {
    return path.join(process.env.DEVVAULT_HOME, "auth.json");
  }

  const base =
    process.platform === "win32"
      ? process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");

  return path.join(base, "devvault", "auth.json");
}

export function readUserConfig() {
  try {
    return JSON.parse(fs.readFileSync(getUserConfigPath(), "utf8"));
  } catch {
    return {};
  }
}

export function writeUserConfig(data) {
  const file = getUserConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function clearAuth() {
  const config = readUserConfig();
  delete config.token;
  delete config.user;
  writeUserConfig(config);
}

// A hosted DevVault site can ship its address inside the package ("devvault": {"defaultApiUrl": "..."} in
// package.json), so users never have to type it.
export function getPackageDefaultApiUrl() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    return pkg.devvault?.defaultApiUrl || "";
  } catch {
    return "";
  }
}

export function getApiUrl() {
  return (
    process.env.DEVVAULT_API_URL ||
    readUserConfig().apiUrl ||
    getPackageDefaultApiUrl() ||
    "http://localhost:5000"
  ).replace(/\/+$/, "");
}

export function getSetting(key, fallback) {
  const value = readUserConfig()[key];
  return value === undefined ? fallback : value;
}

export function setSetting(key, value) {
  writeUserConfig({ ...readUserConfig(), [key]: value });
}

import { isInitialized, getDevVaultPath } from "../../storage/localStorage.js";
import { detectProject } from "../../storage/projectContext.js";
import { getApiUrl, getUserConfigPath, readUserConfig } from "../../config/userConfig.js";
import { apiRequest } from "../../api/client.js";

export const command = "doctor";
export const describe = "Diagnose your setup (Node, workspace, login, server connection)";

export async function runChecks() {
  const checks = [];
  const add = (name, status, detail, fix) => checks.push({ name, status, detail, fix });

  const major = Number(process.versions.node.split(".")[0]);
  add("Node.js version", major >= 18 ? "ok" : "fail", `v${process.versions.node}`, major >= 18 ? undefined : "Install Node.js 18 or newer.");

  const vault = getDevVaultPath();
  add(
    "Vault set up",
    isInitialized() ? "ok" : "fail",
    isInitialized() ? vault : "not created yet",
    isInitialized() ? undefined : "Run `devvault init` once; it works for all your projects."
  );

  const project = (() => { try { return isInitialized() ? detectProject() : null; } catch { return null; } })();
  add("Current project", project ? "ok" : "warn", project ? `${project.name}${project.registered ? "" : " (not saved yet; the first `devvault note` here registers it)"}` : "no project detected in this folder", project ? undefined : "cd into a project folder (one with a .git or package.json) before using `devvault note`.");

  const config = readUserConfig();
  add("API URL", "ok", getApiUrl(), "Change it with `devvault login --api-url <url>` or DEVVAULT_API_URL.");
  add("Config file", "ok", getUserConfigPath());
  add("Logged in", config.token ? "ok" : "warn", config.user?.email || "not logged in", config.token ? undefined : "Run `devvault register` or `devvault login`.");

  let reachable = false;
  try {
    const response = await fetch(`${getApiUrl()}/api/health`, { signal: AbortSignal.timeout(8000) });
    reachable = response.ok;
    add("Server reachable", reachable ? "ok" : "fail", `HTTP ${response.status}`, reachable ? undefined : "Is the backend running? (cd backend && npm start)");

    const health = reachable ? await response.json().catch(() => null) : null;

    if (health?.ai) {
      add(
        "AI provider",
        health.ai.configured ? "ok" : "fail",
        `${health.ai.provider} · chat ${health.ai.chatModel} · embeddings ${health.ai.embedModel}`,
        health.ai.configured ? undefined : "Set AI_PROVIDER and AI_API_KEY in backend/.env, then run `npm run ai:check`."
      );
    }
  } catch (error) {
    add("Server reachable", "warn", error.cause?.code || error.message, "Start the backend, or check the API URL. Local commands work without it.");
  }

  if (reachable && config.token) {
    try {
      const { user } = await apiRequest("GET", "/api/me");
      add("Token valid", "ok", user.email);
    } catch (error) {
      add("Token valid", "fail", error.message, "Run `devvault login` again.");
    }
  }

  return checks;
}

export const handler = async () => {
  const checks = await runChecks();
  const icon = { ok: "✔", warn: "!", fail: "✘" };

  console.log("\nDevVault doctor\n---------------");

  for (const check of checks) {
    console.log(`${icon[check.status]} ${check.name}: ${check.detail}`);
    if (check.fix && check.status !== "ok") console.log(`    → ${check.fix}`);
  }

  if (checks.some((check) => check.status === "fail")) process.exitCode = 1;
};

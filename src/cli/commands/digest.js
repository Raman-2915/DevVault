import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { addKnowledge, addHistory } from "../../storage/localStorage.js";
import { findProjectRoot, resolveProject } from "../../storage/projectContext.js";
import { apiRequest } from "../../api/client.js";
import { readUserConfig } from "../../config/userConfig.js";
import { sanitizeSensitiveText } from "../../analyzer/secretSanitizer.js";
import { autoSync } from "../syncCore.js";

export const command = "digest";
export const describe = "Automatically write a work-log note from your recent git commits";

export const builder = (yargs) =>
  yargs
    .option("since", { type: "string", default: "7 days ago", describe: 'How far back to look, e.g. "2 days ago"' })
    .option("ai", { type: "boolean", default: false, describe: "Have the AI turn the commits into a short summary" });

export const handler = async (argv) => {
  try {
    const root = findProjectRoot();
    if (!root) throw new Error("Run this inside a project folder.");

    let log;
    try {
      log = execFileSync("git", ["log", `--since=${argv.since}`, "--no-merges", "--date=short", "--pretty=format:%ad  %s", "-n", "100"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch {
      throw new Error("This folder is not a git repository (or git is not installed).");
    }

    if (!log) {
      console.log(`No commits since "${argv.since}". Nothing to record.`);
      return;
    }

    const project = resolveProject(undefined, { create: true });
    const commits = log.split("\n");
    let body = `Commits since ${argv.since} (${commits.length}):\n${commits.map((c) => `- ${c}`).join("\n")}`;

    if (argv.ai && readUserConfig().token) {
      try {
        const { text } = await apiRequest("POST", "/api/compose", { kind: "worklog", facts: log.slice(0, 6000) }, { timeoutMs: 60_000 });
        body = `${text}\n\n${body}`;
      } catch (error) {
        console.error(`(AI summary skipped: ${error.message})`);
      }
    }

    const now = new Date().toISOString();
    const entry = addKnowledge({
      id: randomUUID(),
      title: `Work log: ${project?.name || "project"} (${now.slice(0, 10)})`,
      type: "work-log",
      project: project?.name || null,
      projectId: project?.id || null,
      tags: ["work-log", "git"],
      content: sanitizeSensitiveText(body),
      source: "digest",
      createdAt: now,
      updatedAt: now
    });

    addHistory({ action: "digest", entryId: entry.id });
    console.log(`Saved a work log with ${commits.length} commits for "${project?.name}".`);
    await autoSync();
  } catch (error) {
    console.error(`Digest failed: ${error.message}`);
    process.exitCode = 1;
  }
};

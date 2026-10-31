import fs from "node:fs";
import path from "node:path";
import { explainProject } from "../../analyzer/projectExplainer.js";
import { apiRequest } from "../../api/client.js";
import { readUserConfig } from "../../config/userConfig.js";
import { addKnowledge, deleteKnowledge, getAllKnowledge, getAllProjects, addHistory, isInitialized } from "../../storage/localStorage.js";
import { findProjectRoot, detectProject } from "../../storage/projectContext.js";
import { randomUUID } from "node:crypto";

export const command = "explain [target]";
export const describe = "Explain a project in plain English: what it does, how it is built, how requests flow";

export const builder = (yargs) =>
  yargs
    .positional("target", { type: "string", describe: "Project folder or saved project name (default: the project you are in)" })
    .option("out", { alias: "o", type: "string", describe: "Write the explanation to a Markdown file" })
    .option("save", { type: "boolean", default: false, describe: "Keep the overview in your vault so `devvault ask` can use it" })
    .option("ai", { type: "boolean", default: false, describe: "Add a friendlier AI-written summary (sends only the extracted facts, never code)" });

function resolveTarget(target) {
  if (target && fs.existsSync(target) && fs.statSync(target).isDirectory()) return path.resolve(target);

  if (target && isInitialized()) {
    const hit = getAllProjects().find((p) => p.name.toLowerCase() === target.toLowerCase() || p.id === target);
    if (hit && fs.existsSync(hit.path)) return hit.path;
  }

  if (target) throw new Error(`"${target}" is not a folder or a saved project name.`);
  return findProjectRoot() || process.cwd();
}

export const handler = async (argv) => {
  try {
    const root = resolveTarget(argv.target);
    const { facts, markdown } = explainProject(root);
    let text = markdown;

    if (argv.ai) {
      if (!readUserConfig().token) {
        console.error("(--ai needs `devvault login`; showing the built-in explanation.)\n");
      } else {
        try {
          const compact = JSON.stringify({ ...facts, routes: facts.routes.slice(0, 30), folders: facts.folders.slice(0, 15) });
          const { text: narrative } = await apiRequest("POST", "/api/compose", { kind: "overview", facts: compact }, { timeoutMs: 60_000 });
          text += `\n## In simple words (AI summary)\n${narrative}\n`;
        } catch (error) {
          console.error(`(AI summary skipped: ${error.message})\n`);
        }
      }
    }

    console.log(text);

    if (argv.out) {
      fs.writeFileSync(path.resolve(argv.out), text, "utf8");
      console.log(`Saved to ${path.resolve(argv.out)}`);
    }

    if (argv.save) {
      if (!isInitialized()) throw new Error("Run `devvault init` first to use --save.");
      const project = detectProject({ from: root, create: true }) || { name: facts.name, id: null };
      const name = project.name || facts.name;

      for (const old of getAllKnowledge().filter((e) => e.type === "project-overview" && e.project === name)) deleteKnowledge(old.id);

      const now = new Date().toISOString();
      addKnowledge({
        id: randomUUID(),
        title: `${name} — project overview`,
        type: "project-overview",
        project: name,
        projectId: project.id || null,
        tags: ["overview", "architecture", ...facts.frameworks.map((f) => f.toLowerCase())],
        content: text.slice(0, 19000),
        source: "explain",
        createdAt: now,
        updatedAt: now
      });
      addHistory({ action: "explain", projectPath: root });
      console.log(`Overview saved to your vault as "${name} — project overview".`);
    }
  } catch (error) {
    console.error(`Explain failed: ${error.message}`);
    process.exitCode = 1;
  }
};

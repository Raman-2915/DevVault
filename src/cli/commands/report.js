
import fs from "node:fs";
import path from "node:path";
import { sanitizeSensitiveText } from "../../analyzer/secretSanitizer.js";

import {
  getProjectById,
  getAllKnowledge
} from "../../storage/localStorage.js";

export const command = "report <projectId>";
export const describe = "Generate a project intelligence report";

export const builder = (yargs) =>
  yargs
    .positional("projectId", {
      describe: "ID of the analyzed project",
      type: "string"
    })
    .option("output", {
      alias: "o",
      type: "string",
      describe: "Save the Markdown report to this file"
    })
    .option("overwrite", {
      type: "boolean",
      default: false,
      describe: "Allow overwriting an existing report file"
    });

function list(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "- None detected";
  }

  return items
    .map((item) => {
      if (typeof item === "string") return `- ${item}`;

      if (item && typeof item === "object") {
        return `- ${item.name || "Unknown"}${
          item.version ? ` (${item.version})` : ""
        }`;
      }

      return `- ${String(item)}`;
    })
    .join("\n");
}

function safeCell(value) {
  return String(value ?? "Unknown")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function buildReport(project, entries) {
  const routes = entries
    .filter((entry) => entry.type === "api-route")
    .sort((a, b) =>
      String(a.title || "").localeCompare(String(b.title || ""))
    );

  const typeCounts = countBy(entries, (entry) => entry.type || "unknown");

  const lines = [
    `# Project Intelligence Report: ${project.name || "Unknown"}`,
    "",
    `- **Project ID:** ${project.id}`,
    `- **Path:** ${project.path || "Unknown"}`,
    `- **Analyzed at:** ${project.analyzedAt || "Unknown"}`,
    `- **Package manager:** ${project.packageManager || "Unknown"}`,
    `- **Files scanned:** ${project.fileCount ?? "Unknown"}`,
    `- **Directories:** ${project.directoryCount ?? "Unknown"}`,
    `- **Saved knowledge entries:** ${entries.length}`,
    `- **Saved API-route findings:** ${routes.length}`,
    "",
    "## Summary",
    "",
    project.summary || "No summary available.",
    "",
    "## Languages",
    "",
    list(project.languages),
    "",
    "## Technologies",
    "",
    list(project.technologies),
    "",
    "## Frameworks",
    "",
    list(project.frameworks),
    "",
    "## Dependencies",
    "",
    list(project.dependencies),
    "",
    "## Architecture Indicators",
    "",
    list(project.architecture),
    "",
    "## Databases",
    "",
    list(project.databases),
    "",
    "## Authentication Libraries",
    "",
    list(project.authenticationLibraries),
    "",
    "## Saved Knowledge by Type",
    ""
  ];

  if (Object.keys(typeCounts).length === 0) {
    lines.push("- No saved knowledge entries");
  } else {
    for (const [type, count] of Object.entries(typeCounts).sort()) {
      lines.push(`- ${type}: ${count}`);
    }
  }

  lines.push("", "## Detected API Routes", "");

  if (routes.length === 0) {
    lines.push("No saved API-route findings were found.");
  } else {
    lines.push(
      "| Route finding | Source file | Line |",
      "|---|---|---:|"
    );

    for (const route of routes) {
      lines.push(
        `| ${safeCell(route.title)} | ${safeCell(route.sourceFile)} | ${
          Number.isInteger(route.sourceLine) ? route.sourceLine : "Unknown"
        } |`
      );
    }
  }

  lines.push("", "## Scan Warnings", "", list(project.warnings), "");

  lines.push(
    "## Interpretation Notes",
    "",
    "- This report reflects the saved project profile and saved knowledge at generation time.",
    "- Technologies and architecture indicators are heuristic detections, not proof of runtime behavior.",
    "- API routes are extracted findings and may not include every runtime endpoint.",
    ""
  );

  return sanitizeSensitiveText(lines.join("\n"));
}

function countBy(items, getKey) {
  const counts = {};

  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] || 0) + 1;
  }

  return counts;
}

export const handler = ({ projectId, output, overwrite }) => {
  try {
    const project = getProjectById(projectId);

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const entries = getAllKnowledge().filter(
      (entry) => entry.projectId === project.id
    );

    const report = buildReport(project, entries);

    if (!output) {
      console.log(report);
      return;
    }

    const outputPath = path.resolve(process.cwd(), output);

    if (fs.existsSync(outputPath) && !overwrite) {
      throw new Error(
        `File already exists: ${outputPath}. Use --overwrite to replace it.`
      );
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, report, "utf8");

    console.log("Report generated successfully.");
    console.log(`Project: ${project.name || project.id}`);
    console.log(`Saved to: ${outputPath}`);
  } catch (error) {
    console.error(`Report generation failed: ${error.message}`);
    process.exitCode = 1;
  }
};

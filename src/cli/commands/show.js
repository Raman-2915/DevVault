import {
  getKnowledgeById
} from "../../storage/localStorage.js";

export const command = "show <id>";

export const describe =
  "Show a knowledge entry";

export const handler = (argv) => {
  const entry = getKnowledgeById(argv.id);

  if (!entry) {
    console.error(
      `Knowledge entry not found: ${argv.id}`
    );

    process.exitCode = 1;
    return;
  }

  console.log("\n==============================");
  console.log("       DEVVAULT KNOWLEDGE");
  console.log("==============================\n");

  console.log(`ID:         ${entry.id}`);
  console.log(`Title:      ${entry.title}`);
  console.log(`Type:       ${entry.type}`);
  console.log(`Project:    ${entry.project || "None"}`);
  console.log(
  `Tags:       ${
    Array.isArray(entry.tags) && entry.tags.length > 0
      ? entry.tags.join(", ")
      : "None"
  }`
);
  console.log(`Source:     ${entry.source}`);
  console.log(`Created:    ${entry.createdAt}`);
  console.log(`Updated:    ${entry.updatedAt}`);

  console.log("\nContent:");
  console.log("--------------------------------");
  console.log(entry.content);
  console.log("--------------------------------\n");
};
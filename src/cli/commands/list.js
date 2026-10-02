import {
  getAllKnowledge
} from "../../storage/localStorage.js";

export const command = "list";

export const describe =
  "List all knowledge entries";

export const builder = {
  project: {
    type: "string",
    describe: "Filter by project"
  },

  type: {
    type: "string",
    describe: "Filter by knowledge type"
  }
};

export const handler = (argv) => {
  let entries = getAllKnowledge();

  if (argv.project) {
    entries = entries.filter(
      (entry) =>
        entry.project?.toLowerCase() ===
        argv.project.toLowerCase()
    );
  }

  if (argv.type) {
    entries = entries.filter(
      (entry) =>
        entry.type.toLowerCase() ===
        argv.type.toLowerCase()
    );
  }

  if (entries.length === 0) {
    console.log("No knowledge entries found.");
    return;
  }

  console.log(`\nFound ${entries.length} knowledge entry(s):\n`);

  entries.forEach((entry, index) => {
    console.log(`${index + 1}. ${entry.title}`);
    console.log(`   ID: ${entry.id}`);
    console.log(`   Type: ${entry.type}`);

    if (entry.project) {
      console.log(`   Project: ${entry.project}`);
    }

    if (Array.isArray(entry.tags) && entry.tags.length > 0) {
      console.log(
  `   Tags: ${
    Array.isArray(entry.tags) && entry.tags.length > 0
      ? entry.tags.join(", ")
      : "None"
  }`
);
    }

    console.log(`   Created: ${entry.createdAt}`);
    console.log("");
  });
};
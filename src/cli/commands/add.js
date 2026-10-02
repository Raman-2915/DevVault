import { randomUUID } from "crypto";

import {
  addKnowledge,
  addHistory
} from "../../storage/localStorage.js";

export const command = "add";

export const describe =
  "Add a developer knowledge entry";

export const builder = {
  title: {
    type: "string",
    demandOption: true,
    describe: "Knowledge title"
  },

  content: {
    type: "string",
    demandOption: true,
    describe: "Knowledge content"
  },

  type: {
    type: "string",
    default: "general",
    describe: "Knowledge type"
  },

  project: {
    type: "string",
    default: null,
    describe: "Related project name"
  },

  tags: {
    type: "string",
    default: "",
    describe: "Comma-separated tags"
  }
};

export const handler = (argv) => {
  const now = new Date().toISOString();

  const tags = argv.tags
    ? argv.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

  const entry = {
    id: randomUUID(),
    title: argv.title.trim(),
    content: argv.content.trim(),
    type: argv.type.trim(),
    project: argv.project
      ? argv.project.trim()
      : null,
    tags,
    source: "manual",
    createdAt: now,
    updatedAt: now
  };

  addKnowledge(entry);

  addHistory({
    action: "add",
    entryId: entry.id
  });

  console.log("\nKnowledge added successfully.\n");

  console.log(`ID:      ${entry.id}`);
  console.log(`Title:   ${entry.title}`);
  console.log(`Type:    ${entry.type}`);

  if (entry.project) {
    console.log(`Project: ${entry.project}`);
  }

  if (entry.tags.length > 0) {
    console.log(`Tags:    ${entry.tags.join(", ")}`);
  }
};
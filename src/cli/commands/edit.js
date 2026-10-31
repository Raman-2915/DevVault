import {
  getKnowledgeById,
  updateKnowledge,
  addHistory
} from "../../storage/localStorage.js";

export const command = "edit <id>";

export const describe =
  "Edit a knowledge entry";

export const builder = {
  title: {
    type: "string",
    describe: "New title"
  },

  content: {
    type: "string",
    describe: "New content"
  },

  type: {
    type: "string",
    describe: "New knowledge type"
  },

  project: {
    type: "string",
    describe: "New project name"
  },

  tags: {
    type: "string",
    describe: "New comma-separated tags"
  }
};

export const handler = (argv) => {
  const existing = getKnowledgeById(argv.id);

  if (!existing) {
    console.error(
      `Knowledge entry not found: ${argv.id}`
    );

    process.exitCode = 1;
    return;
  }

  const updates = {};

  if (argv.title !== undefined) {
    updates.title = argv.title.trim();
  }

  if (argv.content !== undefined) {
    updates.content = argv.content.trim();
  }

  if (argv.type !== undefined) {
    updates.type = argv.type.trim();
  }

  if (argv.project !== undefined) {
    updates.project = argv.project.trim();
  }

  if (argv.tags !== undefined) {
    updates.tags = argv.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  if (Object.keys(updates).length === 0) {
    console.log(
      "No changes provided. Use --title, --content, --type, --project or --tags."
    );
    return;
  }

  const updated = updateKnowledge(
    argv.id,
    updates
  );

  addHistory({
    action: "edit",
    entryId: argv.id
  });

  console.log("\nKnowledge updated successfully.\n");
  console.log(`ID:    ${updated.id}`);
  console.log(`Title: ${updated.title}`);
};
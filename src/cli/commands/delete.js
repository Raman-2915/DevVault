import {
  deleteKnowledge,
  addHistory
} from "../../storage/localStorage.js";

export const command = "delete <id>";

export const describe =
  "Delete a knowledge entry";

export const builder = {
  force: {
    type: "boolean",
    default: false,
    describe: "Confirm deletion"
  }
};

export const handler = (argv) => {
  if (!argv.force) {
    console.log(
      "Deletion requires confirmation."
    );

    console.log(
      `Run: devvault delete ${argv.id} --force`
    );

    return;
  }

  const deleted = deleteKnowledge(argv.id);

  if (!deleted) {
    console.error(
      `Knowledge entry not found: ${argv.id}`
    );

    process.exitCode = 1;
    return;
  }

  addHistory({
    action: "delete",
    entryId: argv.id
  });

  console.log(
    `Knowledge entry "${deleted.title}" deleted successfully.`
  );
};
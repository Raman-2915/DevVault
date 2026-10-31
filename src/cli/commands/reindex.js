import { apiRequest } from "../../api/client.js";

export const command = "reindex";
export const describe = "Re-embed your cloud entries (run after switching AI provider/model)";

export const handler = async () => {
  try {
    let total = 0;
    let model = "";

    for (let round = 0; round < 500; round++) {
      const result = await apiRequest("POST", "/api/sync/reindex", {});
      model = result.model;
      total += result.reindexed;

      if (result.reindexed > 0) console.log(`  re-embedded ${total} (${result.remaining} remaining)…`);
      if (result.remaining === 0 || result.reindexed === 0) break;
    }

    console.log(total ? `\nDone. ${total} entries re-embedded with ${model}.` : `\nNothing to do: all entries already use ${model}.`);
  } catch (error) {
    console.error(`\nReindex failed: ${error.message}`);
    process.exitCode = 1;
  }
};

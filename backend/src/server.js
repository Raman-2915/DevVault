import mongoose from "mongoose";
import { loadDotEnv, loadConfig } from "./config.js";

const loaded = loadDotEnv();

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`\nConfiguration error: ${error.message}`);
  if (!loaded) console.error("\n(No backend/.env file was found.)");
  process.exit(1);
}

const models = await import("./models/index.js");
const { createAiClient } = await import("./services/ai.js");
const { createRetriever, createProfileLister } = await import("./services/retrieval.js");
const { createApp } = await import("./app.js");

const ai = createAiClient(config.ai);
const retrieve = createRetriever({
  KnowledgeEntry: models.KnowledgeEntry,
  atlasVectorIndex: config.atlasVectorIndex,
  minScore: config.minScore
});

config.ai.warnings.forEach((warning) => console.warn(`Warning: ${warning}`));
config.email.warnings.forEach((warning) => console.warn(`Warning: ${warning}`));
console.log(`Email: provider=${config.email.provider}, verification ${config.email.required ? "REQUIRED" : "off"}`);
const aiInfo = ai.describe();
console.log(`AI provider: ${aiInfo.provider} (chat: ${aiInfo.chatModel}, embeddings: ${aiInfo.embedModel || "none"}${aiInfo.backup ? `, backup chat: ${aiInfo.backup}` : ""})`);

if (!aiInfo.configured) {
  console.warn("Warning: no AI API key is set. Sync will store entries without embeddings and ask/search --semantic will fail.");
}

try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  console.log("MongoDB connected.");
} catch (error) {
  console.error(`\nCould not connect to MongoDB: ${error.message}`);
  console.error("Check MONGODB_URI and that your IP is allowed in Atlas > Network Access.");
  process.exit(1);
}

const app = createApp({ config, models, ai, retrieve, listProfiles: createProfileLister({ KnowledgeEntry: models.KnowledgeEntry }) });

app.listen(config.port, () => {
  console.log(`DevVault API listening on http://localhost:${config.port}`);
  console.log(`Dashboard: http://localhost:${config.port}/  (after \`npm run build\` in dashboard/)`);
});

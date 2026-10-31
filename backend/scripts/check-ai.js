// Verifies your AI settings end-to-end and finds a chat model that works for YOUR key.
//   npm run ai:check          (from the repo root)   |   npm run check:ai   (from backend/)
import { loadDotEnv, loadConfig } from "../src/config.js";
import { createAiClient } from "../src/services/ai.js";

loadDotEnv();

let config;
try {
  config = loadConfig({ JWT_SECRET: "x".repeat(40), ...process.env });
} catch (error) {
  console.error(`Configuration error: ${error.message}`);
  process.exit(1);
}

config.ai.warnings.forEach((warning) => console.warn(`Warning: ${warning}\n`));
const ai = createAiClient(config.ai);
const configuredChat = config.ai.chat.model;

console.log(`Provider: ${config.ai.provider}`);
console.log(`Chat model: ${configuredChat}   (${config.ai.chat.provider})`);
console.log(`Embedding model: ${ai.embedModel || "(none)"}   (${config.ai.embed.provider})`);
if (config.ai.chatBackup) console.log(`Backup chat: ${config.ai.chatBackup.provider} / ${config.ai.chatBackup.model}`);
console.log("");

let embedOk = true;
let chatOk = true;

try {
  const [vector] = await ai.embed(["DevVault embedding check"], { inputType: "query" });
  console.log(`✔ Embeddings work (vector length ${vector.length}).`);
} catch (error) {
  embedOk = false;
  console.error(`✘ Embeddings failed: ${error.message}`);
}

try {
  const reply = await ai.chat([{ role: "user", content: "Reply with exactly one word: OK" }]);
  console.log(`✔ Chat works (model said: ${JSON.stringify(reply.slice(0, 60))}).`);

  if (ai.chatModel !== configuredChat) {
    console.log(`\n⚠ "${configuredChat}" is not available to your key, so DevVault switched to "${ai.chatModel}".`);
    console.log(`  Make it permanent by putting this in backend/.env:\n    AI_CHAT_MODEL=${ai.chatModel}`);
  }
} catch (error) {
  chatOk = false;
  console.error(`✘ Chat failed: ${error.message}`);
}

if (!chatOk || process.argv.includes("--probe")) {
  console.log("\nTrying candidate chat models with your key...");
  const results = await ai.probeChatModels({ max: 8 });
  for (const r of results) console.log(`  ${r.ok ? "✔" : "✘"} ${r.provider}: ${r.model}${r.ok ? "" : `  (${r.reason.slice(0, 70)})`}`);

  const working = results.find((r) => r.ok);
  if (working) {
    chatOk = true;
    const configured = results.find((r) => r.model === configuredChat && r.provider === config.ai.chat.provider);
    console.log(
      configured?.ok
        ? `\nYour configured model "${configuredChat}" works. The earlier failure was temporary (providers show 503 "high demand" / 429 quota at busy times). DevVault now retries and switches models automatically, so no change is needed.`
        : `\nUse this in backend/.env:\n  AI_CHAT_MODEL=${working.model}`
    );
  } else {
    console.error("\nNo candidate worked. Check the API key, the provider (AI_PROVIDER) and your network/quota.");
  }
}

if (!embedOk) {
  const embedModels = (await ai.listModels()).filter((m) => /embed/i.test(m));
  if (embedModels.length) console.error(`\nEmbedding models your key can see: ${embedModels.slice(0, 6).join(", ")}\nSet AI_EMBED_MODEL to one of them.`);
}

console.log("\nNote: DevVault still works in keyword mode if AI is down or rate-limited (free tiers have limits).");
process.exit(embedOk && chatOk ? 0 : 1);

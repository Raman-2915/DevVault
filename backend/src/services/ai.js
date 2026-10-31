// Minimal client for OpenAI-compatible providers (Gemini, Groq, NVIDIA, OpenAI, Ollama, ...).
// Chat and embeddings may use different providers/keys. Chat can also have a BACKUP provider, and every
// chat provider retries temporary failures and falls back to other models.

export class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "AiError";
    this.status = status;
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Models that can't chat (embedding, image, speech, safety ...) are never auto-selected.
const NOT_CHAT = /embed|rerank|parse|image|imagen|flux|asr|riva|parakeet|tts|vsr|pose|kumo|proteina|retriev|guard|safeguard|safety|translate|vision|\bvl\b|veo|aqa|whisper|clip|ocr|speech|audio|video|robotics|molmim|genmol|diffdock/i;

// Order models discovered through /models: stable "latest" aliases first, then well-known chat families.
export function preferChatModels(ids) {
  const usable = ids.filter((id) => !NOT_CHAT.test(id));
  const score = (id) => (/latest/.test(id) ? 0 : /flash|lightning|instruct|chat|llama|nemotron|gemini|gpt/.test(id) ? 1 : 2) + (/preview|exp|thinking/.test(id) ? 0.5 : 0);
  return [...new Set(usable)].sort((a, b) => score(a) - score(b));
}

export function createAiClient(options, fetchImpl = globalThis.fetch) {
  const { provider = "custom", chat: chatCfg, embed: embedCfg, chatBackup, chatExtraBody = {}, retryDelayMs = 800 } = options;
  const EMBED_BATCH = 64;

  // Some providers reject the optional `dimensions` parameter; we then retry once without it.
  let useDimensions = Boolean(embedCfg.dimensions);
  // Vectors from different models/dimensions are not comparable, so the tag identifies them.
  const currentTag = () => `${embedCfg.model}${useDimensions ? `@${embedCfg.dimensions}` : ""}`;

  async function post(target, path, body, label) {
    if (!target.apiKey) {
      throw new AiError(`AI provider is not configured on the server (no API key for ${label || "the provider"}).`, 503);
    }

    let response;
    try {
      response = await fetchImpl(`${target.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000)
      });
    } catch (error) {
      throw Object.assign(new AiError(`AI provider request failed: ${error.message}`), { network: true });
    }

    if (!response.ok) {
      // Log (server side only) what the provider said; never echo it to clients.
      let detail = "";
      try {
        detail = String(await response.text()).replace(/\s+/g, " ").slice(0, 300);
      } catch {
        // ignore
      }
      console.error(`[ai] ${target.provider || provider} ${path} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);

      const message =
        response.status === 401 || response.status === 403
          ? `The AI provider rejected the API key or the model (HTTP ${response.status}).`
          : response.status === 429
            ? "The AI provider rate/quota limit was reached (HTTP 429). Wait a moment and retry."
            : response.status === 503 || response.status === 500 || response.status === 502 || response.status === 504
              ? `The AI provider is temporarily unavailable (HTTP ${response.status}).`
              : response.status === 404
                ? `AI provider returned HTTP 404 from ${hostOf(target.baseUrl)}. Check the base URL and the model name (AI_PROVIDER / AI_CHAT_MODEL / AI_EMBED_MODEL).`
                : `AI provider returned HTTP ${response.status}.`;

      throw Object.assign(new AiError(message), { providerStatus: response.status, providerDetail: detail });
    }

    return response.json();
  }

  // ---------------- embeddings ----------------
  async function embed(texts, { inputType = "passage" } = {}) {
    if (!embedCfg.model) {
      throw new AiError("No embedding model is configured (Groq has no embeddings; set AI_EMBED_PROVIDER=gemini).", 503);
    }

    const inputs = texts.map((text) => String(text).slice(0, 8000));
    const vectors = [];

    for (let i = 0; i < inputs.length; i += EMBED_BATCH) {
      const batch = inputs.slice(i, i + EMBED_BATCH);
      const body = { model: embedCfg.model, input: batch };
      if (useDimensions) body.dimensions = embedCfg.dimensions;
      // Asymmetric retrieval models (NVIDIA NIM) need to know if text is a search query or a stored passage.
      if (embedCfg.inputTypes) {
        body.input_type = inputType;
        body.truncate = "END";
      }

      let data;
      try {
        data = await postWithRetry(embedCfg, "/embeddings", body, "embeddings");
      } catch (error) {
        if (useDimensions && error.providerStatus === 400) {
          console.warn("[ai] provider rejected `dimensions`; retrying without it (set AI_EMBED_DIMENSIONS to disable).");
          useDimensions = false;
          vectors.length = 0; // restart so every vector has the same dimension
          i = -EMBED_BATCH;
          continue;
        }
        throw error;
      }

      if (!Array.isArray(data?.data) || data.data.length !== batch.length) {
        throw new AiError("AI provider returned an unexpected embeddings response.");
      }

      const ordered = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      vectors.push(...ordered.map((item) => item.embedding));
    }

    return vectors;
  }

  // ---------------- error classification ----------------
  const isTransient = (error) => [500, 502, 503, 504].includes(error.providerStatus) || Boolean(error.network);

  const modelish = (error) => /model|not found|not available|no longer|entitle|function|access/i.test(error.providerDetail || "");

  // Should we move on to another model/provider? Not for bad keys or malformed requests (those would repeat).
  const shouldAdvance = (error) => {
    const status = error.providerStatus;
    if (status === undefined) return true; // network trouble, empty/over-long replies
    if ([404, 429, 500, 502, 503, 504].includes(status)) return true;
    return [400, 403, 422].includes(status) && modelish(error);
  };

  // Temporary failures (e.g. "high demand" 503) deserve a couple of quick retries before giving up on a model.
  async function postWithRetry(target, path, body, label, attempts = 3) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await post(target, path, body, label);
      } catch (error) {
        if (!isTransient(error) || attempt >= attempts) throw error;
        await sleep(retryDelayMs * attempt);
      }
    }
  }

  // ---------------- chat ----------------
  async function chatWith(cfg, model, messages, { temperature = 0.1, maxTokens = cfg.maxTokens } = {}) {
    const data = await postWithRetry(cfg, "/chat/completions", { ...chatExtraBody, model, messages, temperature, max_tokens: maxTokens }, "chat");

    const choice = data?.choices?.[0];
    const text = choice?.message?.content;

    if (typeof text !== "string" || !text.trim()) {
      throw new AiError(
        choice?.finish_reason === "length"
          ? "The model used all its output tokens before answering (reasoning models spend tokens thinking). Increase AI_CHAT_MAX_TOKENS."
          : "AI provider returned an empty response."
      );
    }

    return text.trim();
  }

  async function listModelsFor(cfg) {
    if (!cfg.apiKey) return [];
    try {
      const response = await fetchImpl(`${cfg.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data?.data || []).map((m) => String(m.id).replace(/^models\//, ""));
    } catch {
      return [];
    }
  }

  // One chat provider with its own "currently working" model, retries and fallback list.
  function makeChatRunner(cfg) {
    let active = cfg.model;
    const fallbacks = cfg.fallbackModels || [];

    async function run(messages, opts) {
      const queue = [active, ...fallbacks];
      const tried = [];
      let discovered = false;
      let lastError;

      for (let i = 0; i < queue.length && tried.length < 6; i++) {
        const model = queue[i];
        if (!model || tried.includes(model)) continue;
        tried.push(model);

        try {
          const text = await chatWith(cfg, model, messages, opts);
          if (model !== active) {
            console.warn(`[ai] ${cfg.provider || provider}: chat model "${active}" is unavailable right now; using "${model}". Set AI_CHAT_MODEL=${model} to make this permanent.`);
            active = model;
          }
          return text;
        } catch (error) {
          lastError = error;
          if (!shouldAdvance(error)) throw error;

          if (i === queue.length - 1 && !discovered) {
            discovered = true;
            queue.push(...preferChatModels(await listModelsFor(cfg)).slice(0, 6));
          }
        }
      }

      throw Object.assign(
        new AiError(`No chat model worked on ${cfg.provider || provider} (tried: ${tried.join(", ")}). Last problem: ${lastError?.message}`, lastError?.status ?? 502),
        { providerStatus: lastError?.providerStatus }
      );
    }

    return { run, cfg, get model() { return active; }, listModels: () => listModelsFor(cfg) };
  }

  const primary = makeChatRunner(chatCfg);
  const backup = chatBackup?.apiKey ? makeChatRunner(chatBackup) : null;

  async function chat(messages, opts) {
    try {
      return await primary.run(messages, opts);
    } catch (error) {
      if (!backup) throw error;

      console.warn(`[ai] ${chatCfg.provider} chat failed (${error.message}); trying backup provider ${chatBackup.provider}.`);
      try {
        return await backup.run(messages, opts);
      } catch (backupError) {
        throw Object.assign(new AiError(`Chat failed on ${chatCfg.provider} (${error.message}) and on backup ${chatBackup.provider} (${backupError.message}).`, backupError.status ?? 502), { providerStatus: backupError.providerStatus });
      }
    }
  }

  // Actually calls each candidate model once so you can see which ones work for YOUR key.
  async function probeChatModels({ max = 8 } = {}) {
    const results = [];

    for (const runner of [primary, backup].filter(Boolean)) {
      const listed = preferChatModels(await runner.listModels());
      const candidates = [...new Set([runner.model, ...(runner.cfg.fallbackModels || []), ...listed])].slice(0, max);

      for (const model of candidates) {
        try {
          const reply = await chatWith(runner.cfg, model, [{ role: "user", content: "Reply with exactly one word: OK" }]);
          results.push({ provider: runner.cfg.provider, model, ok: true, reply: reply.slice(0, 30) });
        } catch (error) {
          results.push({ provider: runner.cfg.provider, model, ok: false, reason: error.message });
        }
      }
    }

    return results;
  }

  function describe() {
    return {
      provider,
      chatModel: primary.model,
      embedModel: currentTag(),
      backup: backup ? `${chatBackup.provider}:${backup.model}` : null,
      configured: Boolean(chatCfg.apiKey && embedCfg.apiKey && embedCfg.model)
    };
  }

  return {
    embed,
    chat,
    describe,
    listModels: () => primary.listModels(),
    probeChatModels,
    get embedModel() {
      return currentTag();
    },
    get chatModel() {
      return primary.model;
    }
  };
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readTextFile(file) {
  const buffer = fs.readFileSync(file);

  // Windows PowerShell's `echo > .env` writes UTF-16 LE; Notepad may add a BOM.
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

// Dependency-free .env loader. Never overrides variables that are already set
// (so Render/Docker settings win), and always resolves relative to backend/, not the cwd.
export function loadDotEnv(file = path.join(BACKEND_ROOT, ".env"), env = process.env) {
  if (!fs.existsSync(file)) return false;

  for (const rawLine of readTextFile(file).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    let value = match[2].trim();
    const quote = value[0];

    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }

    if (env[match[1]] === undefined) env[match[1]] = value;
  }

  return true;
}


// One-line provider setup. Anything can still be overridden with AI_* variables.
export const AI_PRESETS = {
  // Free tier via Google AI Studio (https://aistudio.google.com/apikey). One key covers chat + embeddings.
  // "-latest" aliases keep working when Google retires a specific version (e.g. gemini-2.5-flash).
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    chatModel: "gemini-flash-latest",
    embedModel: "gemini-embedding-001",
    embedDimensions: 768,
    keyEnv: "GEMINI_API_KEY",
    chatFallbacks: ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest", "gemini-2.5-flash-lite"]
  },
  // Free tier at https://console.groq.com (no card). Very fast chat, but Groq has NO embeddings endpoint:
  // pair it with Gemini for embeddings (AI_EMBED_PROVIDER=gemini). Free-tier model availability changes,
  // so DevVault tries several (gpt-oss first) and can auto-discover others.
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    chatModel: "openai/gpt-oss-120b",
    chatMaxTokens: 3000,
    noEmbeddings: true,
    keyEnv: "GROQ_API_KEY",
    chatFallbacks: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
  },
  // Free hosted API at https://build.nvidia.com (key starts with nvapi-). Availability differs per account,
  // so DevVault tries several chat models. Embedding models need input_type=query|passage (handled automatically).
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    chatModel: "nvidia/nemotron-3.5-lightning-30b-a3b",
    embedModel: "nvidia/nemotron-3-embed-1b",
    embedInputTypes: true,
    chatMaxTokens: 4096,
    keyEnv: "NVIDIA_API_KEY",
    chatFallbacks: [
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-3-super-120b-a12b",
      "meta/llama-3.3-70b-instruct",
      "meta/llama-3.1-8b-instruct"
    ]
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    chatModel: "gpt-4o-mini",
    embedModel: "text-embedding-3-small",
    keyEnv: "OPENAI_API_KEY",
    chatFallbacks: ["gpt-4o-mini"]
  },
  // Fully local and free (https://ollama.com). No real key needed; only works when the backend runs on your machine.
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    chatModel: "llama3.2",
    embedModel: "nomic-embed-text",
    apiKey: "ollama",
    chatFallbacks: []
  }
};

export function resolveAiConfig(env = process.env) {
  const lower = (value) => String(value).toLowerCase();
  const base = lower(env.AI_PROVIDER || (env.AI_BASE_URL ? "custom" : "openai"));
  const chatProvider = lower(env.AI_CHAT_PROVIDER || base);
  // Groq cannot embed: if a Gemini key is available, silently use Gemini for embeddings.
  const defaultEmbed = AI_PRESETS[base]?.noEmbeddings && (env.GEMINI_API_KEY || env.AI_EMBED_API_KEY) ? "gemini" : base;
  const embedProvider = lower(env.AI_EMBED_PROVIDER || defaultEmbed);
  const backupName = env.AI_CHAT_BACKUP_PROVIDER ? lower(env.AI_CHAT_BACKUP_PROVIDER) : null;

  for (const provider of new Set([base, chatProvider, embedProvider, backupName].filter(Boolean))) {
    if (provider !== "custom" && !AI_PRESETS[provider]) {
      throw new Error(`AI provider "${provider}" is not valid. Use one of: ${Object.keys(AI_PRESETS).join(", ")}, custom.`);
    }
  }

  const warnings = [];
  if (env.AI_BASE_URL && chatProvider !== "custom" && embedProvider !== "custom") {
    // A preset already knows its endpoint. A stray AI_BASE_URL (e.g. the wrong "gemini" site) would silently break it.
    warnings.push(`AI_BASE_URL is ignored because AI_PROVIDER=${base} already sets the correct endpoint. Delete the AI_BASE_URL line (or use AI_PROVIDER=custom).`);
  }

  if (AI_PRESETS[embedProvider]?.noEmbeddings) {
    warnings.push(`${embedProvider} has no embeddings endpoint, so semantic search is off (keyword search still works). Add AI_EMBED_PROVIDER=gemini and GEMINI_API_KEY for semantic search.`);
  }

  let chatExtraBody = {};
  if (env.AI_CHAT_EXTRA_BODY) {
    try {
      chatExtraBody = JSON.parse(env.AI_CHAT_EXTRA_BODY);
    } catch {
      throw new Error("AI_CHAT_EXTRA_BODY must be valid JSON, e.g. {\"reasoning_effort\":\"low\"}.");
    }
  }

  const strip = (url) => String(url || "").replace(/\/+$/, "");
  const role = (name, provider) => {
    const preset = AI_PRESETS[provider] || {};
    const upper = name.toUpperCase();
    return {
      preset,
      provider,
      baseUrl: strip(env[`AI_${upper}_BASE_URL`] || (provider === "custom" ? env.AI_BASE_URL : undefined) || preset.baseUrl),
      // Most specific key wins: AI_CHAT_API_KEY > GEMINI_API_KEY/NVIDIA_API_KEY/... > AI_API_KEY
      apiKey: env[`AI_${upper}_API_KEY`] || (preset.keyEnv && env[preset.keyEnv]) || env.AI_API_KEY || preset.apiKey || ""
    };
  };

  const chat = role("chat", chatProvider);
  // Backup chat provider (presets only). It uses ITS OWN key, never the primary provider's.
  const backupPreset = backupName && backupName !== chatProvider ? AI_PRESETS[backupName] : null;
  const backupKey = backupPreset
    ? (backupPreset.keyEnv && env[backupPreset.keyEnv]) || (backupName === base ? env.AI_API_KEY : "") || backupPreset.apiKey || ""
    : "";
  if (backupPreset && !backupKey) warnings.push(`AI_CHAT_BACKUP_PROVIDER=${backupName} is ignored: set ${backupPreset.keyEnv || "its API key"}.`);
  const embed = role("embed", embedProvider);
  const fallbacks = env.AI_CHAT_FALLBACK_MODELS
    ? env.AI_CHAT_FALLBACK_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
    : chat.preset.chatFallbacks || [];

  return {
    provider: chatProvider === embedProvider ? chatProvider : `${chatProvider}+${embedProvider}`,
    chat: {
      provider: chatProvider,
      baseUrl: chat.baseUrl,
      apiKey: chat.apiKey,
      model: env.AI_CHAT_MODEL || chat.preset.chatModel || "",
      maxTokens: Number(env.AI_CHAT_MAX_TOKENS) || chat.preset.chatMaxTokens || 2000,
      fallbackModels: fallbacks
    },
    embed: {
      provider: embedProvider,
      baseUrl: embed.baseUrl,
      apiKey: embed.apiKey,
      model: embed.preset.noEmbeddings ? "" : env.AI_EMBED_MODEL || embed.preset.embedModel || "",
      dimensions: Number(env.AI_EMBED_DIMENSIONS) || embed.preset.embedDimensions || undefined,
      inputTypes: ["1", "true", "yes", "on"].includes(lower(env.AI_EMBED_INPUT_TYPES ?? "")) || Boolean(embed.preset.embedInputTypes)
    },
    chatBackup: backupPreset && backupKey
      ? {
          provider: backupName,
          baseUrl: strip(backupPreset.baseUrl),
          apiKey: backupKey,
          model: backupPreset.chatModel || "",
          maxTokens: backupPreset.chatMaxTokens || 2000,
          fallbackModels: backupPreset.chatFallbacks || []
        }
      : null,
    chatExtraBody,
    warnings
  };
}

export function resolveEmailConfig(env = process.env, { production = false, port = 5000 } = {}) {
  const detected = env.BREVO_API_KEY ? "brevo" : env.RESEND_API_KEY ? "resend" : env.SMTP_HOST ? "smtp" : "console";
  const provider = String(env.EMAIL_PROVIDER || detected).toLowerCase();

  if (!["brevo", "resend", "smtp", "console"].includes(provider)) {
    throw new Error(`EMAIL_PROVIDER "${provider}" is not valid. Use brevo, resend, smtp or console.`);
  }

  const flag = env.REQUIRE_EMAIL_VERIFICATION;
  const warnings = [];
  let required;

  if (flag !== undefined && flag !== "") {
    required = !["false", "0", "off", "no"].includes(String(flag).toLowerCase());
  } else {
    // Locked-out users would be the result of requiring verification with no way to send mail.
    required = provider !== "console" || !production;
    if (production && provider === "console") {
      warnings.push("No email provider is configured, so email verification is OFF. Set BREVO_API_KEY (+ EMAIL_FROM_ADDRESS) to enable it.");
    }
  }

  if (provider === "brevo" && !env.EMAIL_FROM_ADDRESS) warnings.push("EMAIL_FROM_ADDRESS must be a sender verified in Brevo.");
  if (provider === "resend" && !env.EMAIL_FROM_ADDRESS) warnings.push("EMAIL_FROM_ADDRESS is required for Resend.");

  return {
    provider,
    required,
    warnings,
    devFallback: !production, // outside production, print codes in the server log if email delivery fails
    appUrl: String(env.APP_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/+$/, ""),
    from: { email: env.EMAIL_FROM_ADDRESS || "no-reply@devvault.local", name: env.EMAIL_FROM_NAME || "DevVault" },
    brevoKey: env.BREVO_API_KEY || "",
    resendKey: env.RESEND_API_KEY || "",
    smtp: {
      host: env.SMTP_HOST || "",
      port: Number(env.SMTP_PORT) || 587,
      user: env.SMTP_USER || "",
      pass: env.SMTP_PASS || ""
    }
  };
}

export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT) || 5000,
    mongoUri: env.MONGODB_URI || "mongodb://127.0.0.1:27017/devvault",
    jwtSecret: env.JWT_SECRET || "",
    jwtExpiresIn: env.JWT_EXPIRES_IN || "90d",
    production: env.NODE_ENV === "production",
    atlasVectorIndex: env.ATLAS_VECTOR_INDEX || "",
    minScore: 0.25, // set below, once the embedding provider is known
    dashboardDir: env.DASHBOARD_DIR || path.join(BACKEND_ROOT, "..", "dashboard", "dist"),
    ai: resolveAiConfig(env)
  };
  config.email = resolveEmailConfig(env, { production: config.production, port: config.port });
  // Gemini embeddings score even unrelated text around 0.5, so its default threshold is higher.
  config.minScore = env.MIN_SCORE !== undefined && env.MIN_SCORE !== "" ? Number(env.MIN_SCORE) : config.ai.embed.provider === "gemini" ? 0.5 : 0.25;

  if (!config.jwtSecret) {
    throw new Error(
      "JWT_SECRET is not set.\n" +
        `  1. Create ${path.join(BACKEND_ROOT, ".env")} (copy .env.example)\n` +
        "  2. Add a line: JWT_SECRET=<32+ random characters>\n" +
        "  Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  }

  if (config.jwtSecret.length < 32) {
    throw new Error(`JWT_SECRET is only ${config.jwtSecret.length} characters; it must be at least 32.`);
  }

  return config;
}

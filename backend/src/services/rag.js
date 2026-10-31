import { buildRagMessages } from "./prompts.js";

export const INSUFFICIENT_MESSAGE =
  "I couldn't find anything in your stored knowledge that answers this. " +
  "Try analyzing/extracting the relevant project, adding a note, or running `devvault sync`.";

// Embeds the query; if the AI provider is down we fall back to keyword-only retrieval.
export async function embedQuery(ai, text) {
  try {
    const [vector] = await ai.embed([text], { inputType: "query" });
    return { vector, notice: null };
  } catch (error) {
    return { vector: null, notice: `Semantic search is unavailable (${error.message}); used keyword matching instead.` };
  }
}

const GREETING = /^(hi+|hey+|hello+|hola|yo|sup|namaste|good\s+(morning|afternoon|evening)|thanks?( you)?|thank u|ok(ay)?|cool|nice|bye|help|test(ing)?)\W*$/i;

export function isSmallTalk(question) {
  const q = String(question).trim();
  return q.length <= 40 && GREETING.test(q);
}

// "Which databases have I used across my projects?": similarity search can't cover every project, so these
// questions also receive every project's technology profile.
export function needsPortfolio(question) {
  const q = String(question).toLowerCase();
  const scope = /\b(all|every|each|any|which|what|list|show|compare|across|overall|total|how many|have i|did i|do i)\b/.test(q);
  const subject = /\b(projects?|portfolio|databases?|db|languages?|frameworks?|stack|technolog\w*|librar\w*|tools?|orm|odm|auth\w*|models?|schemas?|apis?|postgres\w*|mongo\w*|mysql|sqlite|redis|prisma|sequelize|react|express|node)\b/.test(q);
  return (scope && subject) || /\bmy (projects|portfolio|work|stack)\b/.test(q);
}

// Models like to use markdown even when told not to; the UI shows plain text.
export function plainText(text) {
  return String(text)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*\*\s+/gm, "- ");
}

function plainAnswer(sources, reason) {
  const lines = sources.slice(0, 5).map((source, index) => {
    const snippet = String(source.content).replace(/\s+/g, " ").slice(0, 220);
    return `${index + 1}. ${source.title}${source.project ? ` (${source.project})` : ""}: ${snippet}`;
  });

  return `The AI writer is unavailable right now (${reason}). Here are the closest entries from your vault:\n\n${lines.join("\n")}`;
}

// Keep only the entries the answer actually relies on, numbered the way the answer cites them.
export function citedSources(answer, sources) {
  const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  return sources
    .map((source, index) => ({ ...source, ref: index + 1 }))
    .filter((source) => cited.has(source.ref));
}

export async function answerQuestion({ ai, retrieve, listProfiles, userId, question, filters, limit = 8 }) {
  if (isSmallTalk(question)) {
    const profiles = listProfiles ? await listProfiles({ userId, filters }) : [];
    const known = profiles.map((p) => p.project).filter(Boolean);
    const intro = known.length
      ? `You have ${known.length} analyzed project${known.length === 1 ? "" : "s"} in your vault: ${known.slice(0, 8).join(", ")}${known.length > 8 ? ", …" : ""}.`
      : "Your vault has no analyzed projects yet. Run `devvault analyze <folder>` then `devvault extract <id>` to teach me about one.";

    return {
      answer: `Hi! I'm your DevVault assistant. ${intro}\n\nTry asking:\n- Which databases have I used across my projects?\n- How is authentication implemented in my projects?\n- What data models does my FindIt project have?\n- How did I fix a MongoDB connection error before?`,
      sources: [],
      grounded: true,
      smalltalk: true,
      degraded: false
    };
  }

  const { vector, notice } = await embedQuery(ai, question);
  const retrieved = await retrieve({ userId, queryVector: vector, queryText: question, filters, limit });

  let sources = retrieved;
  if (listProfiles && needsPortfolio(question)) {
    const profiles = await listProfiles({ userId, filters });
    const seen = new Set(profiles.map((p) => p.id));
    sources = [...profiles, ...retrieved.filter((r) => !seen.has(r.id))].slice(0, 30);
  }

  // Grounding guard: with no relevant evidence we do NOT call the LLM at all,
  // so it cannot invent project-specific facts.
  if (sources.length === 0) {
    return { answer: INSUFFICIENT_MESSAGE, sources: [], grounded: false, degraded: Boolean(notice), notice };
  }

  try {
    const answer = plainText(await ai.chat(buildRagMessages(question, sources)));
    return { answer, sources: citedSources(answer, sources), considered: sources.length, grounded: true, degraded: Boolean(notice), notice };
  } catch (error) {
    return {
      answer: plainAnswer(sources, error.message),
      sources: sources.slice(0, 5).map((source, index) => ({ ...source, ref: index + 1 })),
      considered: sources.length,
      grounded: true,
      degraded: true,
      notice: notice || `AI answer unavailable (${error.message}).`
    };
  }
}

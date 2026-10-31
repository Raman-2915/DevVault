// Offline ranking for the vault: keyword overlap, no network needed.

const STOP = new Set("a an and are as at be by did do does for from have how i in is it me my of on or our that the this to use used using was what when where which who why with at line file node_modules error".split(" "));

export function tokenize(text) {
  return [...new Set(
    String(text ?? "")
      .toLowerCase()
      .split(/[^a-z0-9_+#.]+/)
      .map((t) => t.replace(/^\.+|\.+$/g, ""))
      .filter((t) => t.length >= 2 && t.length <= 40 && !STOP.has(t) && !/^\d+$/.test(t))
  )];
}

// Reduces a noisy stack trace to the part that identifies the problem.
export function errorSignature(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const interesting = lines.filter((l) => /error|exception|failed|cannot|can't|not found|refused|denied|timeout|timed out|undefined|invalid|unauthorized|forbidden|ECONN|ENOENT|EADDR|EACCES|unhandled|missing/i.test(l) && !/^\s*at\s/.test(l));
  const chosen = (interesting.length ? interesting : lines).slice(0, 4).join(" ");
  return chosen
    .replace(/[A-Za-z]:\\[^\s]+|\/[\w./-]+\.\w+(:\d+)*/g, " ") // file paths
    .replace(/0x[0-9a-f]+|\b[0-9a-f]{12,}\b|\b\d+\b/gi, " ")   // hex ids, numbers
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

export function rankEntries(entries, queryText, { limit = 5, minMatched = 2, boostTypes = [] } = {}) {
  const terms = tokenize(queryText).slice(0, 25);
  if (!terms.length) return [];

  const results = [];

  for (const entry of entries) {
    const title = String(entry.title ?? "").toLowerCase();
    const tags = (entry.tags || []).join(" ").toLowerCase();
    const body = `${entry.content ?? ""} ${entry.debug?.error ?? ""}`.toLowerCase();
    let score = 0;
    let matched = 0;

    for (const term of terms) {
      let hit = false;
      if (title.includes(term)) { score += 3; hit = true; }
      if (tags.includes(term)) { score += 2; hit = true; }
      if (body.includes(term)) { score += 1; hit = true; }
      if (hit) matched += 1;
    }

    const needed = Math.min(minMatched, terms.length);
    if (matched < needed) continue;

    const coverage = matched / terms.length;
    if (terms.length > 3 && coverage < 0.2) continue;

    if (boostTypes.includes(entry.type)) score *= 1.5;
    results.push({ entry, score, coverage });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

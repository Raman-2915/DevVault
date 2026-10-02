import {
  getAllKnowledge,
  getAllProjects,
  addHistory
} from "../../storage/localStorage.js";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim();
}

function tokenize(query) {
  return normalize(query)
    .split(/[^a-z0-9_+#.-]+/i)
    .filter((term) => term.length > 0);
}


function getSearchableFields(entry) {
  let content = normalize(entry.content);

  // Generic extractor wording should not make every route
  // appear relevant to a search for "express".
  if (entry.type === "api-route") {
    content = content.replace(
      /detected an express-style route declaration\.?/g,
      ""
    );
  }

  return {
    title: normalize(entry.title),
    content,
    type: normalize(entry.type),
    project: normalize(entry.project),
    projectId: normalize(entry.projectId),
    tags: Array.isArray(entry.tags)
      ? entry.tags.map(normalize)
      : [],
    source: normalize(entry.source),
    sourceFile: normalize(entry.sourceFile),

    // Kept available for future filtering or display,
    // but not used as evidence of content relevance.
    sourceType: normalize(entry.sourceType)
  };
}


function matchesFilter(value, filter) {
  if (!filter) {
    return true;
  }

  return normalize(value).includes(normalize(filter));
}



function matchesProject(entry, projectFilter) {
  if (!projectFilter) {
    return true;
  }

  const filter = normalize(projectFilter);

  const project = normalize(entry.project);
  const projectId = normalize(entry.projectId);
  const projectPath = normalize(entry.projectPath);

  // Direct matches.
  if (
    project.includes(filter) ||
    projectId.includes(filter) ||
    projectPath.includes(filter)
  ) {
    return true;
  }

  const savedProjects = getAllProjects();

  // Resolve the supplied filter to a saved project.
  const savedProject = savedProjects.find((item) => {
    return (
      normalize(item.id) === filter ||
      normalize(item.name) === filter ||
      normalize(item.path) === filter
    );
  });

  if (!savedProject) {
    return false;
  }

  const savedName = normalize(savedProject.name);
  const savedPath = normalize(savedProject.path);

  // Match entries linked by ID or path.
  if (
    projectId === normalize(savedProject.id) ||
    projectPath === savedPath
  ) {
    return true;
  }

  // Match entries linked by project name, including a short name
  // such as "Wanderlust" for "wanderlust-web-app".
  const projectNameMatches =
    project === savedName ||
    (project.length >= 5 &&
      savedName.startsWith(project + "-"));

  return projectNameMatches;
}




function scoreEntry(entry, query, terms) {
  const fields = getSearchableFields(entry);
  const normalizedQuery = normalize(query);

  let score = 0;
  let matchedTerms = 0;

  // Exact or strong title matches.
  if (fields.title === normalizedQuery) {
    score += 100;
  } else if (fields.title.includes(normalizedQuery)) {
    score += 60;
  }

  // Exact phrase matches in meaningful content.
  if (fields.content.includes(normalizedQuery)) {
    score += 25;
  }

  // Tags are strong relevance signals.
  if (fields.tags.some((tag) => tag === normalizedQuery)) {
    score += 40;
  } else if (
    fields.tags.some((tag) => tag.includes(normalizedQuery))
  ) {
    score += 25;
  }

  for (const term of terms) {
    let termMatched = false;

    if (fields.title.includes(term)) {
      score += fields.title === term ? 18 : 10;
      termMatched = true;
    }

    if (fields.tags.some((tag) => tag.includes(term))) {
      score += 8;
      termMatched = true;
    }

    if (fields.type.includes(term)) {
      score += 6;
      termMatched = true;
    }

    if (
      fields.project.includes(term) ||
      fields.projectId.includes(term)
    ) {
      score += 5;
      termMatched = true;
    }

    if (fields.sourceFile.includes(term)) {
      score += 4;
      termMatched = true;
    }

    // Don't score sourceType: it's metadata, not proof that
    // the entry's actual content is relevant to the query.

    if (fields.content.includes(term)) {
      score += 3;
      termMatched = true;
    }

    if (fields.source.includes(term)) {
      score += 2;
      termMatched = true;
    }

    if (termMatched) {
      matchedTerms += 1;
    }
  }

  // Reward entries that cover more of the query terms.
  if (terms.length > 0) {
    score += Math.round(
      (matchedTerms / terms.length) * 10
    );
  }

  return {
    score,
    matchedTerms,
    totalTerms: terms.length
  };
}


function makeSnippet(content, query, maxLength = 180) {
  const text = String(content ?? "").replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) {
    return text;
  }

  const normalizedContent = normalize(text);
  const normalizedQuery = normalize(query);
  const matchIndex = normalizedContent.indexOf(normalizedQuery);

  if (matchIndex === -1) {
    return `${text.slice(0, maxLength).trim()}...`;
  }

  const start = Math.max(0, matchIndex - 55);
  const end = Math.min(text.length, start + maxLength);

  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function getLimit(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function formatResult(result, index) {
  const entry = result.entry;

  console.log(`\n${index + 1}. ${entry.title || "Untitled"}`);
  console.log(`   Relevance score: ${result.score}`);
  console.log(`   ID: ${entry.id}`);

  if (entry.type) {
    console.log(`   Type: ${entry.type}`);
  }

  if (entry.project) {
    console.log(`   Project: ${entry.project}`);
  }

  if (entry.projectId) {
    console.log(`   Project ID: ${entry.projectId}`);
  }

  if (entry.sourceFile) {
    const line = entry.sourceLine
      ? `:${entry.sourceLine}`
      : "";

    console.log(`   Source file: ${entry.sourceFile}${line}`);
  }

  if (entry.source) {
    console.log(`   Source: ${entry.source}`);
  }

  console.log(
    `   Match coverage: ${result.matchedTerms}/${result.totalTerms} query terms`
  );

  const snippet = makeSnippet(entry.content, result.query);

  if (snippet) {
    console.log(`   ${snippet}`);
  }
}

export const command = "search <query>";

export const describe =
  "Search knowledge with relevance ranking and filters";

export const builder = (yargs) => {
  return yargs
    .positional("query", {
      describe: "Words or phrase to search for",
      type: "string"
    })
    .option("project", {
      alias: "p",
      describe: "Filter by project name, ID, or saved path",
      type: "string"
    })
    .option("type", {
      alias: "t",
      describe: "Filter by knowledge type",
      type: "string"
    })
    .option("source", {
      alias: "s",
      describe: "Filter by knowledge source, such as manual or extractor",
      type: "string"
    })
    .option("limit", {
      alias: "n",
      describe: `Maximum results to display (1-${MAX_LIMIT})`,
      type: "number",
      default: DEFAULT_LIMIT
    });
};

export const handler = (argv) => {
  try {
    const query = String(argv.query ?? "").trim();

    if (!query) {
      console.error("Please provide a search query.");
      process.exitCode = 1;
      return;
    }

    const terms = tokenize(query);

    if (terms.length === 0) {
      console.error(
        "The query must contain at least one searchable character."
      );
      process.exitCode = 1;
      return;
    }

    const allKnowledge = getAllKnowledge();

    const filtered = allKnowledge.filter((entry) => {
      return (
        matchesProject(entry, argv.project) &&
        matchesFilter(entry.type, argv.type) &&
        matchesFilter(entry.source, argv.source)
      );
    });

    const results = filtered
      .map((entry) => ({
        entry,
        query,
        ...scoreEntry(entry, query, terms)
      }))
      .filter((result) => result.score > 0)
      .sort((a, b) => {
        // Relevance first; newer entries break ties.
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        const aDate = Date.parse(
          a.entry.updatedAt || a.entry.createdAt || ""
        ) || 0;

        const bDate = Date.parse(
          b.entry.updatedAt || b.entry.createdAt || ""
        ) || 0;

        return bDate - aDate;
      });

    const limit = getLimit(argv.limit);
    const displayedResults = results.slice(0, limit);

    addHistory({
      action: "search",
      query,
      filters: {
        project: argv.project || null,
        type: argv.type || null,
        source: argv.source || null,
        limit
      },
      resultCount: results.length
    });

    console.log(`\nSearch results for: "${query}"`);
    console.log("----------------------------------------");
    console.log(`Knowledge entries: ${allKnowledge.length}`);
    console.log(`After filters: ${filtered.length}`);
    console.log(`Matches: ${results.length}`);
    console.log(`Showing: ${displayedResults.length}`);

    if (displayedResults.length === 0) {
      console.log(
        "\nNo matching knowledge found. Try different keywords or remove a filter."
      );
      return;
    }

    displayedResults.forEach(formatResult);
    console.log("\n----------------------------------------");
  } catch (error) {
    console.error(`Search failed: ${error.message}`);
    process.exitCode = 1;
  }
};

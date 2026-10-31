import fs from "node:fs";
import path from "node:path";

// Shared, dependency-free helpers for reading project source (used by explain and the stack fingerprint).

export function read(file, max = 200_000) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= max ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

export const posix = (p) => p.split(path.sep).join("/");

// Reads keys at the top level of an object literal such as Schema({ a: ..., b: ... }).
export function topLevelKeys(text, limit = 12) {
  const start = text.indexOf("{");
  if (start === -1) return [];

  const keys = [];
  let depth = 0;
  let token = "";

  for (let i = start; i < Math.min(text.length, start + 4000) && keys.length < limit; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") {
      depth -= 1;
      if (depth === 0) break;
    }

    if (depth === 1) {
      if (ch === ":" && /^[A-Za-z_$][\w$]*$/.test(token.trim().replace(/^["']|["']$/g, ""))) {
        keys.push(token.trim().replace(/^["']|["']$/g, ""));
        token = "";
      } else if (ch === "," || ch === "{") token = "";
      else token += ch;
    }
  }

  return keys;
}

export function findRoutes(root, sourceFiles) {
  const imports = new Map(); // identifier -> resolved file (relative)
  const mounts = []; // {prefix, file}
  const routes = [];
  const contents = new Map();

  for (const absolute of sourceFiles) contents.set(absolute, read(absolute));

  for (const [absolute, source] of contents) {
    for (const m of source.matchAll(/import\s+(\w+)\s+from\s+["'](\.[^"']+)["']/g)) imports.set(`${absolute}::${m[1]}`, path.resolve(path.dirname(absolute), m[2]));
    for (const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s+["'](\.[^"']+)["']/g)) {
      for (const name of m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean)) imports.set(`${absolute}::${name}`, path.resolve(path.dirname(absolute), m[2]));
    }
    for (const m of source.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*["'](\.[^"']+)["']\s*\)/g)) imports.set(`${absolute}::${m[1]}`, path.resolve(path.dirname(absolute), m[2]));
  }

  const resolveImported = (resolved) => sourceFiles.find((f) => f === resolved || f.replace(/\.(js|mjs|cjs|ts)$/, "") === resolved || f.replace(/[\\/]index\.(js|mjs|ts)$/, "") === resolved);

  for (const [absolute, source] of contents) {
    for (const m of source.matchAll(/\b(?:app|server)\.use\(\s*["'`](\/[^"'`]*)["'`]\s*,([^)]*)\)/g)) {
      for (const ident of m[2].match(/\b[A-Za-z_$][\w$]*\b/g) || []) {
        const target = resolveImported(imports.get(`${absolute}::${ident}`));
        if (target) mounts.push({ prefix: m[1], file: target });
      }
    }
  }

  const prefixOf = (file) => mounts.find((m) => m.file === file)?.prefix || "";

  for (const [absolute, source] of contents) {
    const rel = posix(path.relative(root, absolute));
    for (const m of source.matchAll(/\b(\w+)\.(get|post|put|patch|delete)\(\s*["'`](\/[^"'`]*|)["'`]/g)) {
      if (!/^(app|router|server|api|\w*Router|\w*routes?)$/i.test(m[1])) continue;
      routes.push({ method: m[2].toUpperCase(), path: (`${prefixOf(absolute)}${m[3]}` || "/").replace(/(.)\/$/, "$1"), file: rel });
    }
  }

  return routes;
}

export function findModels(root, sourceFiles) {
  const models = [];

  for (const absolute of sourceFiles) {
    const source = read(absolute);
    const rel = posix(path.relative(root, absolute));

    // schema variables defined in this file: const userSchema = new Schema({ ... })
    const schemas = new Map();
    for (const m of source.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*new\s+(?:mongoose\.)?Schema\s*\(\s*(?=(\{[\s\S]{0,4000}))/g)) schemas.set(m[1], topLevelKeys(m[2]));
    const onlySchema = schemas.size === 1 ? [...schemas.values()][0] : [];

    for (const m of source.matchAll(/(?:mongoose\.)?model\(\s*["'](\w+)["']\s*(?:,\s*(new\s+(?:mongoose\.)?Schema\s*\(\s*(?=(\{[\s\S]{0,4000}))|(\w+)))?/g)) {
      const fields = m[3] ? topLevelKeys(m[3]) : m[4] && schemas.has(m[4]) ? schemas.get(m[4]) : onlySchema;
      models.push({ name: m[1], file: rel, source: "Mongoose", fields });
    }

    for (const m of source.matchAll(/(?:sequelize|db)\.define\(\s*["'](\w+)["']\s*,\s*(?=(\{[\s\S]{0,3000}))/g)) {
      models.push({ name: m[1], file: rel, source: "Sequelize", fields: topLevelKeys(m[2]) });
    }
  }

  const prismaPath = path.join(root, "prisma", "schema.prisma");
  for (const m of read(prismaPath).matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const fields = m[2].split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((f) => f && !f.startsWith("@") && !f.startsWith("//"));
    models.push({ name: m[1], file: "prisma/schema.prisma", source: "Prisma", fields: fields.slice(0, 12) });
  }

  const seen = new Set();
  return models.filter((m) => (seen.has(m.name) ? false : seen.add(m.name)));
}


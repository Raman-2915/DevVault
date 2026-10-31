import { spawn } from "node:child_process";
import { findSimilar, printSimilar } from "../similar.js";
import { rememberLastError, clean } from "../incident.js";
import { resolveProject } from "../../storage/projectContext.js";

export const command = "run [cmd..]";
export const describe = "Run a command; if it fails, instantly search your vault for past solutions";

export const builder = (yargs) =>
  yargs
    .positional("cmd", { type: "string", array: true, describe: "Command to run (put it after --, e.g. devvault run -- npm test)" })
    .option("local", { type: "boolean", default: false, describe: "Only search this computer on failure" });

const TAIL_BYTES = 12_000;

const SAFE = /^[A-Za-z0-9_\-./:=@%+,]+$/;

// Re-quotes arguments the user's shell already split, so `run -- node -e "a (b)"` survives.
export function quoteArg(arg, platform = process.platform) {
  if (arg !== "" && SAFE.test(arg)) return arg;
  if (platform === "win32") return `"${arg.replace(/"/g, '\\"')}"`;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

// One argument with spaces = a whole command line (e.g. "npm test && npm run lint"): pass it through.
export function buildCommandLine(parts, platform = process.platform) {
  return parts.length === 1 ? parts[0] : parts.map((part) => quoteArg(part, platform)).join(" ");
}

export const handler = async (argv) => {
  const parts = argv["--"]?.length ? argv["--"] : argv.cmd || [];

  if (!parts.length) {
    console.error("Nothing to run. Example: devvault run -- npm test");
    process.exitCode = 1;
    return;
  }

  const commandLine = buildCommandLine(parts);
  let tail = "";
  const keep = (chunk) => { tail = (tail + chunk.toString()).slice(-TAIL_BYTES); };

  const code = await new Promise((resolve) => {
    const child = spawn(commandLine, { shell: true, stdio: ["inherit", "pipe", "pipe"] });
    child.stdout.on("data", (c) => { process.stdout.write(c); keep(c); });
    child.stderr.on("data", (c) => { process.stderr.write(c); keep(c); });
    child.on("error", (error) => { console.error(`Could not start the command: ${error.message}`); resolve(127); });
    child.on("close", (c) => resolve(c ?? 1));
  });

  process.exitCode = code;
  if (code === 0) return;

  const errorText = clean(tail);
  console.error(`\n✘ \`${commandLine}\` failed with exit code ${code}. Checking your vault…`);

  try {
    const project = resolveProject();
    rememberLastError({ command: commandLine, error: errorText, project: project?.name || null, projectId: project?.id || null });

    const found = await findSimilar(errorText, { cloud: !argv.local });
    printSimilar(found, { heading: "You may have solved this before" });
    console.log("\nOnce it's fixed, save the lesson:  devvault capture-error --last --solution \"what fixed it\"");
  } catch (error) {
    console.error(`(vault lookup skipped: ${error.message})`);
  }
};

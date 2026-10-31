#!/usr/bin/env node

import { selectVault } from "./storage/vault.js";
import { isLoggedIn, OPEN_COMMANDS, gateMessage } from "./cli/session.js";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import * as initCommand from "./cli/commands/init.js";
import * as addCommand from "./cli/commands/add.js";
import * as listCommand from "./cli/commands/list.js";
import * as showCommand from "./cli/commands/show.js";
import * as editCommand from "./cli/commands/edit.js";
import * as deleteCommand from "./cli/commands/delete.js";
import * as searchCommand from "./cli/commands/search.js";
import * as analyzeCommand from "./cli/commands/analyze.js";
import * as extractCommand from "./cli/commands/extract.js";
import * as projectCommand from "./cli/commands/project.js";
import * as architectureCommand from "./cli/commands/architecture.js";
import * as mapCommand from "./cli/commands/map.js";
import * as maintainCommand from "./cli/commands/maintain.js";
import * as reportCommand from "./cli/commands/report.js";
import * as statsCommand from "./cli/commands/stats.js";
import * as registerCommand from "./cli/commands/register.js";
import * as loginCommand from "./cli/commands/login.js";
import * as logoutCommand from "./cli/commands/logout.js";
import * as syncCommand from "./cli/commands/sync.js";
import * as askCommand from "./cli/commands/ask.js";
import * as captureerrorCommand from "./cli/commands/capture-error.js";
import * as historyCommand from "./cli/commands/history.js";
import * as exportCommand from "./cli/commands/export.js";
import * as importCommand from "./cli/commands/import.js";
import * as doctorCommand from "./cli/commands/doctor.js";
import * as reindexCommand from "./cli/commands/reindex.js";
import * as noteCommand from "./cli/commands/note.js";
import * as notesCommand from "./cli/commands/notes.js";
import * as fixCommand from "./cli/commands/fix.js";
import * as runCommand from "./cli/commands/run.js";
import * as configCommand from "./cli/commands/config.js";
import * as vaultCommand from "./cli/commands/vault.js";
import * as explainCommand from "./cli/commands/explain.js";
import * as digestCommand from "./cli/commands/digest.js";
import * as verifyCommand from "./cli/commands/verify.js";
import * as forgotpasswordCommand from "./cli/commands/forgot-password.js";
import * as resetpasswordCommand from "./cli/commands/reset-password.js";
import * as accountCommand from "./cli/commands/account.js";

// Sign-in comes first: every command that touches your vault needs an account (see `devvault start`).
{
  const args = hideBin(process.argv);
  const command = args.find((arg) => !arg.startsWith("-"));
  // Only flags before a "--" separator belong to DevVault; `devvault run -- node -v` must not count as `--version`.
  const own = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
  const wantsHelp = own.some((arg) => ["--help", "-h", "--version", "-v"].includes(arg));
  const open = wantsHelp || (command && OPEN_COMMANDS.has(command)) || process.env.DEVVAULT_ALLOW_ANONYMOUS === "1";

  if (!open && !isLoggedIn()) {
    console.error(gateMessage());
    process.exit(1);
  }
}
import * as startCommand from "./cli/commands/start.js";
import * as projectsCommand from "./cli/commands/projects.js";
import * as forgetCommand from "./cli/commands/forget.js";

selectVault();

yargs(hideBin(process.argv))
  .scriptName("devvault")
  .usage("$0 <command> [options]")
  .command(initCommand)
  .command(addCommand)
  .command(listCommand)
  .command(showCommand)
  .command(editCommand)
  .command(deleteCommand)
  .command(searchCommand)
  .command(analyzeCommand)
  .command(extractCommand)
  .command(projectCommand)
  .command(architectureCommand)
  .command(mapCommand)
  .command(maintainCommand)
  .command(reportCommand)
  .command(statsCommand)
  .command(registerCommand)
  .command(loginCommand)
  .command(logoutCommand)
  .command(syncCommand)
  .command(askCommand)
  .command(captureerrorCommand)
  .command(historyCommand)
  .command(exportCommand)
  .command(importCommand)
  .command(doctorCommand)
  .command(reindexCommand)
  .command(noteCommand)
  .command(notesCommand)
  .command(fixCommand)
  .command(runCommand)
  .command(configCommand)
  .command(vaultCommand)
  .command(explainCommand)
  .command(digestCommand)
  .command(verifyCommand)
  .command(forgotpasswordCommand)
  .command(resetpasswordCommand)
  .command(accountCommand)
  .command(startCommand)
  .command(projectsCommand)
  .command(forgetCommand)
  .demandCommand(1, "Please provide a command.")
  .parserConfiguration({ "populate--": true })
  .help()
  .strict()
  .parse();
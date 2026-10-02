#!/usr/bin/env node

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
  .demandCommand(1, "Please provide a command.")
  .help()
  .strict()
  .parse();
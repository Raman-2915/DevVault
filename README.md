# DevVault

**An AI-ready Developer Knowledge & Project Intelligence CLI**

DevVault is a command-line tool that analyzes software projects, extracts useful developer knowledge, searches stored information, maps source-code relationships, and generates project reports.

It is designed to help developers understand unfamiliar repositories and maintain a searchable, structured record of their projects.

## Features

- **Project analysis:** Detects languages, technologies, frameworks, dependencies, scripts, and architecture indicators.
- **Knowledge extraction:** Extracts README documentation, package metadata, and conventional Express-style route declarations.
- **Smart search:** Searches stored knowledge with project, type, and source filters.
- **Project intelligence:** Displays saved project profiles and summarizes extracted API routes.
- **Relationship mapping:** Identifies static import relationships and groups files by conventional architectural roles.
- **Knowledge maintenance:** Previews outdated extracted entries and optionally removes confirmed stale entries.
- **Markdown reports:** Generates project summaries, dependency information, architecture indicators, API route tables, and warnings.
- **Workspace-based storage:** Stores DevVault data in a `.devvault` directory under the working directory.
- **Safety controls:** Skips common generated directories and sensitive files during scanning, applies resource limits, and protects manually created knowledge during maintenance.

## Technology stack

- Node.js
- JavaScript ES modules
- Yargs
- UUID
- Node.js built-in test runner

## Requirements

- Node.js compatible with the versions required by the installed dependencies
- npm

Check your installed versions:

```bash
node --version
npm --version
```

## Installation for development

Clone the repository and enter its directory:

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd DevVault
npm install
```

Run the automated tests:

```bash
npm test
```

Link the CLI globally for local development:

```bash
npm link
```

Verify that the command is available:

```bash
devvault --help
```

## Quick start

Run DevVault from the directory you want to use as its workspace.

Initialize the workspace:

```bash
devvault init
```

Analyze a project:

```bash
devvault analyze "C:\path\to\your\project"
```

List stored knowledge:

```bash
devvault list
```

Search stored knowledge:

```bash
devvault search "express"
```

Display a saved knowledge entry:

```bash
devvault show <knowledge-id>
```

Use `devvault --help` and each command's help output to inspect the available options.

## Main commands

| Command | Purpose |
|---|---|
| `init` | Initialize DevVault storage |
| `analyze` | Analyze a software project |
| `extract` | Extract knowledge from a saved project |
| `list` | List stored knowledge |
| `show` | Display an entry |
| `add` | Add a knowledge entry |
| `edit` | Edit an entry |
| `delete` | Delete an entry |
| `search` | Search stored knowledge |
| `project` | Display a saved project profile |
| `architecture` | Summarize extracted API routes |
| `map` | Map static source relationships |
| `maintain` | Preview or apply knowledge maintenance |
| `report` | Generate a project report |
| `stats` | Display knowledge statistics |

Command arguments and options may vary by version. Use the CLI's help output for exact syntax.

## Search filters

Search supports filters for project, knowledge type, and source, along with a configurable result limit.

For example:

```bash
devvault search "express" --type api-route
devvault search "mongodb" --project Wanderlust
```

## Knowledge maintenance

Preview potentially stale extracted knowledge before deleting anything:

```bash
devvault maintain <project-id>
```

Apply the maintenance operation only after reviewing the preview:

```bash
devvault maintain <project-id> --apply
```

Maintenance is designed to protect manually created entries and preserve uncertain entries when the scan cannot establish that they are stale.

## Reports

Display a report in the terminal:

```bash
devvault report <project-id>
```

Export a Markdown report:

```bash
devvault report <project-id> --output report.md
```

Use the supported overwrite option only when you intend to replace an existing output file.

## Data storage

DevVault uses local JSON-based storage in a `.devvault` directory under the current working directory.

The workspace contains files for configuration, knowledge entries, saved project profiles, and history.

**Important:** Run commands from the intended DevVault workspace when accessing its stored data. Analyzing a project at another path does not automatically move the central workspace to that project's directory.

Back up your `.devvault` directory before performing manual data edits or destructive operations.

## Security and limitations

- Project scanning skips common generated directories, symbolic links, and selected secret-file patterns.
- Source scanning uses file-count, depth, and file-size limits.
- Text sanitization uses targeted patterns and cannot guarantee detection of every possible secret.
- Relationship maps represent static import relationships and conventional file roles, not verified runtime call flows.
- Express route extraction is based on conventional source-code patterns; it is not a complete framework parser.
- Project analysis uses heuristics, so some technologies or architectural roles may be missed.
- Reports describe detected and stored information, not a complete security audit.

Do not treat DevVault as a substitute for secret scanning, dependency auditing, or security review.

## Testing

Run the complete test suite:

```bash
npm test
```

Check dependency vulnerabilities:

```bash
npm audit
```

## Roadmap

Potential future improvements include richer framework-aware extraction, more accurate dependency relationships, interactive report views, and additional automated integration tests.

## License

See [LICENSE](LICENSE).
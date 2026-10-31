# Troubleshooting

## `JWT_SECRET is not set` / `JWT_SECRET must be set`
The backend reads `backend/.env`.
1. `cd backend && copy .env.example .env` (Windows) / `cp .env.example .env`
2. Put a 32+ character value on the `JWT_SECRET=` line. Generate one:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
3. No spaces around `=`; no quotes needed. UTF-8 and the UTF-16 files that PowerShell's `echo > .env` creates are both handled.
4. Run `npm start` from `backend/` (the file is located relative to the backend folder, so the working directory does not matter).

## `devvault` is not recognized
The command only exists after the package is linked onto your PATH.
1. In the **repository root** (the folder containing the top-level `package.json`): `npm link`
2. Close and reopen the terminal.
3. Still not found? Your npm global folder is not on PATH. Run `npm prefix -g` and add that folder to PATH (Windows: usually `%APPDATA%\npm`).
4. Fallback without linking, from your workspace folder:
   `node C:\path\to\DevVault\src\index.js <command>`
   or add a PowerShell function to `$PROFILE`:
   `function devvault { node "C:\path\to\DevVault\src\index.js" @args }`

Never run it from inside DevVault's own `src/` folder: data is stored in `.devvault/` in the *current* directory. Use a separate workspace folder. `devvault doctor` warns about this.

## `DevVault is not initialized in this directory`
Run `devvault init` in the folder you are in, or `cd` back to your workspace.

## `Could not connect to MongoDB`
Atlas → Network Access → add your IP (or `0.0.0.0/0` for Render). Check the password in `MONGODB_URI` is URL-encoded and the database name precedes `?`.

## Setting up the free Gemini provider
1. Create a key at https://aistudio.google.com/apikey.
2. In `backend/.env`: `AI_PROVIDER=gemini` and `AI_API_KEY=<your key>`.
3. Run `npm run ai:check` (from the repo root). It tests embeddings and chat separately and prints exactly which one fails.
4. Common results: `rejected the API key` (wrong/blocked key), `rate limit` (free tier; wait and retry, sync again later), `HTTP 404` (model name retired; set `AI_CHAT_MODEL` / `AI_EMBED_MODEL` to a current one), `used all its output tokens` (raise `AI_CHAT_MAX_TOKENS`).

## I switched AI provider/model and search got worse
Old vectors were made by a different model. Run `devvault reindex` once.

## Entries sync but `ask` finds nothing
- `AI_API_KEY` missing/invalid: the sync output says entries were "saved but not embedded". Fix the key, then run `devvault reindex`.
- Relevance threshold too strict: lower `MIN_SCORE` (e.g. `0.15`) and restart.
- Changed `AI_EMBED_MODEL` or `AI_EMBED_DIMENSIONS`? Run `devvault reindex`.

Run `devvault doctor` first for most of these.

## Brevo says "unrecognised IP address" (HTTP 401)
Brevo blocks API calls from IPs it hasn't seen. This is a Brevo account setting, not a bug:
1. Brevo → account menu → **Settings → Security → Authorized IPs** (https://app.brevo.com/security/authorised_ips).
2. Either **Authorize** the IP shown in the error (fine for testing from your laptop; check your inbox for Brevo's "Validate your IP address" email), or click **Deactivate blocking** for API keys.
3. On **Render** you should deactivate blocking: its outbound IPs aren't fixed. This lowers protection of your Brevo API key, so keep the key secret and rotate it if it ever leaks.
Meanwhile, outside production DevVault prints the verification code in the backend terminal (`[auth:dev] ...`) so you can keep testing.

## AI: "model is no longer available" (404)
Providers retire model versions. DevVault now switches automatically and tells you which model to pin; run `npm run ai:check`. Remove any old `AI_CHAT_MODEL=gemini-2.5-flash` line from `backend/.env` (or set `AI_CHAT_MODEL=gemini-flash-latest`).

## AI errors 503 / 429 (Gemini "high demand" or "quota exceeded")
These are *temporary provider-side* limits on the free tier, not bugs in your setup. DevVault retries 503s, switches to another model on 429 (Gemini limits are per model) and can fall back to a backup provider. If it keeps happening, use Groq for chat answers (free) and keep Gemini for embeddings:
```
AI_CHAT_PROVIDER=groq
GROQ_API_KEY=gsk_...
AI_EMBED_PROVIDER=gemini
GEMINI_API_KEY=...
AI_CHAT_BACKUP_PROVIDER=gemini
```
No reindex is needed because the embedding model stays the same. Groq has no embeddings endpoint, so it cannot be your only provider. `npm run ai:check` shows which models work for your key, and DevVault still works in keyword mode if all AI is unavailable.

## `npm audit` warnings
This version has 0 known vulnerabilities in the root, backend and dashboard packages. If you see old ones, run `npm run setup` again. Do **not** run `npm audit fix --force`: it can downgrade packages (it suggests nodemon 1.x). The dashboard needs Node 20.19+ or 22.12+ (`node -v`). The "esbuild install script blocked" notice from newer npm versions is harmless here.

## Using NVIDIA (build.nvidia.com)
1. Create a free account, generate an API key (starts with `nvapi-`).
2. `.env`: `AI_PROVIDER=nvidia` and `AI_API_KEY=nvapi-...` (don't set `AI_BASE_URL`).
3. `npm run ai:check`. Not every model is available to every account, and some hosted models time out; the check lists which ones respond for you. Free usage is rate-limited.
4. If you already synced with another embedding provider, run `devvault reindex` (vector sizes differ).
5. Reasoning models may spend output tokens "thinking". If answers come back empty, raise `AI_CHAT_MAX_TOKENS` or set `AI_CHAT_EXTRA_BODY={"chat_template_kwargs":{"enable_thinking":false}}`.

## I never received the verification email
- **Local development (no provider configured):** the code is printed in the terminal running the backend, in a block starting with `[email:console]`.
- **Brevo:** the sender in `EMAIL_FROM_ADDRESS` must be a *verified sender* in your Brevo account, and `BREVO_API_KEY` must be an API key (starts with `xkeysib-`), not an SMTP password. New Brevo accounts are sometimes reviewed before they can send; check Brevo's dashboard for a notice.
- Look at the backend log: failures appear as `[email] Brevo returned HTTP ...`.
- Check spam. You can request a new code once a minute: `devvault verify --resend`.
- **SMTP does not work on Render's free tier** (outgoing SMTP ports are blocked); use Brevo/Resend.
- Locked out and email isn't working yet? Set `REQUIRE_EMAIL_VERIFICATION=false` on the server (accounts become usable immediately).

## `devvault init` ran in the wrong place / my old notes are missing
`devvault init` now creates **one personal vault** at `~/.devvault` (Windows: `C:\Users\<you>\.devvault`) shared by every project. If you used an older version that kept a vault inside a project folder, run `devvault vault migrate` from that folder to merge it. `devvault vault where` prints the active vault.

## `devvault note` says "No project detected"
Run it inside a project folder (one containing `.git` or `package.json`/`pyproject.toml`/etc.), or pass `--project "name"`. `devvault doctor` shows what it detects.

## `ask` says it has no information about my databases / technologies
DevVault answers from facts it extracted from your projects. Make sure each project has been analyzed with this version and synced:
```
devvault analyze <folder>      # re-run: it now reads schemas and config (Prisma datasource, Mongoose models, Django settings, docker-compose ...)
devvault projects              # shows each project, its entry count and detected databases
```
Changes sync automatically. If a project shows no databases, it may use a technology DevVault doesn't recognise yet; `devvault explain <folder>` shows what it can see.

## There is junk in my vault (test projects, old notes)
```
devvault projects              # list projects
devvault forget "Large Test Project"     # removes the project and all its entries here and in your account
```
Single entries can be deleted from the dashboard's Knowledge page. The dashboard's Projects page also has a Delete project button.

## "Please sign in first"
Every vault command needs an account so everything lands in the right dashboard. Run `devvault start` (first time) or `devvault login`. You then stay signed in on that computer.

## I use two accounts on one computer
Each account has its own separate local vault, so notes never mix. Sign out with `devvault logout`, sign in with the other account.

## Advanced: use the CLI without an account (CI, scripting)
Set `DEVVAULT_ALLOW_ANONYMOUS=1`. Everything stays local (no dashboard, no sync, no AI answers).

# Project review: what is strong, what is risky, what to do next

An honest assessment as of this version, ordered by how much each item matters.

## Strong
- **Clear problem and a daily-use workflow.** `run`/`fix`/`note` solve a real, repeated pain; the stack fingerprint and `ask` make the history queryable.
- **Evidence-based analysis.** Technologies come from schemas and config with file:line evidence, secrets are never stored, and `.env` is never read.
- **Defensive AI layer.** Retries, per-model fallback, backup provider, keyword fallback, grounded answers that cite only used sources.
- **Real account system.** Verified email, hashed single-use codes with lockouts, token versioning, per-user data isolation, per-account local vaults.
- **Good delivery story.** One deployable site that also distributes the CLI; guided onboarding; `doctor`.
- **Test depth.** 200+ tests including security cases (JWT forgery, injection, isolation) and full CLI journeys in isolated fake home folders.

## Risks and gaps (fix in this order)
1. **Backend tests never touch a real MongoDB.** They use in-memory fakes, so a wrong Mongoose query could slip through (the app has been exercised manually against Atlas, which is why it works today). *Next:* add `mongodb-memory-server` integration tests in CI.
2. **Dashboard stores its login token in `localStorage`.** Any XSS would expose it. CSP and no third-party scripts reduce the risk, but the robust fix is an `httpOnly` cookie (with CSRF protection).
3. **CLI token is stored as plain text** in the user config (file mode 600). An OS keychain (Keychain/Credential Manager/libsecret) is safer.
4. **Embeddings run inside the sync request.** A first sync of a big vault on a rate-limited free tier can partially fail (entries are kept and retried later). *Next:* a background job/queue with backoff.
5. **Similarity search is in-process** (fine up to a few thousand entries per user). Atlas Vector Search is wired but untested; use it if users have large vaults.
6. **No monitoring or backups.** Only console logs; Atlas M0 has no backups. Add structured logging, error tracking (e.g. Sentry) and scheduled exports.
7. **No dashboard automated tests.** The UI was verified in a real browser by script, but there is no CI browser suite. Add Playwright tests.
8. **Language depth.** Detection is strongest for JavaScript/TypeScript; Python/Java/Go get dependency/schema basics only. Add more analyzers (Rails, Laravel, .NET, Rust).
9. **Legal basics.** You collect emails: add a privacy policy and terms page, and a way to change email.
10. **Single-user vault.** No shared/team vaults, no editing of notes in the dashboard, no import from GitHub.

## Quick wins (small, high value)
- Add `dependabot.yml` and `npm audit` to CI.
- Add ESLint + Prettier.
- Record a 60-second screen capture of the install → `start` → `analyze` → `ask` flow for your README and resume.
- Add a custom domain to the Render service.

# Deploy DevVault (step by step, all free tiers)

You will end up with **one website** (API + dashboard + install guide) that anyone can use. Visitors install the CLI straight from your site, with no GitHub clone and no npm account.

Time: about 45 minutes the first time. Accounts needed: GitHub, MongoDB Atlas, Google AI Studio, Brevo, Render.

> **Secrets:** never commit `backend/.env`, never paste keys into chats or screenshots. If a key ever leaks, delete it and create a new one.

---

## 1. Database: MongoDB Atlas
1. Create a free account at https://www.mongodb.com/atlas and a free **M0** cluster.
2. **Database Access** → Add user → username + password (avoid `@ : / ?` in the password) → role *Read and write to any database*.
3. **Network Access** → Add IP → **Allow access from anywhere (`0.0.0.0/0`)** (Render's IPs change).
4. **Connect → Drivers** → copy the connection string and put the database name before the `?`:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/devvault?retryWrites=true&w=majority`

## 2. AI keys (free)
- **Gemini** (embeddings + chat): https://aistudio.google.com/apikey → *Create API key*.
- **Groq** (optional, faster chat answers; Groq has no embeddings so Gemini still does those): https://console.groq.com → *API Keys*.

Run the check locally before deploying: `npm run ai:check` (it prints which models work for your key).

## 3. Email: Brevo (for verification codes and password reset)
Render's free tier blocks SMTP, so DevVault uses Brevo's HTTPS API.
1. Sign up at https://www.brevo.com (free: 300 emails/day, no domain needed).
2. **Senders** → add and **verify your own email address** as a sender. This is `EMAIL_FROM_ADDRESS`.
3. **SMTP & API → API Keys** → create a key (starts with `xkeysib-`). This is `BREVO_API_KEY`.
4. **Settings → Security → Authorized IPs** (https://app.brevo.com/security/authorised_ips) → **Deactivate blocking**. Render's outgoing IPs are not fixed, so IP allow-listing cannot work there. Keep the API key secret.
5. New Brevo accounts are sometimes reviewed before they can send. If emails don't arrive, check Brevo's dashboard for a notice.

## 4. Put the code on GitHub
```bash
git init                      # skip if already a repo
git add .
git status                    # make sure NO .env file is listed
git commit -m "DevVault"
git branch -M main
git remote add origin https://github.com/<you>/DevVault.git
git push -u origin main
```
Check `git check-ignore -v backend/.env` prints a match.

## 5. Deploy on Render
1. https://render.com → sign in with GitHub → **New → Blueprint** → pick your repo. Render reads `render.yaml`.
2. Fill in the environment variables it asks for:

| Variable | Value |
|---|---|
| `MONGODB_URI` | the Atlas string from step 1 |
| `AI_API_KEY` | your Gemini key (with `AI_PROVIDER=gemini`, already set) |
| `BREVO_API_KEY` | from step 3 |
| `EMAIL_FROM_ADDRESS` | the sender you verified in Brevo |
| `JWT_SECRET` | generated automatically |
| `APP_URL` | leave empty for now |

   *Optional Groq chat:* add `AI_CHAT_PROVIDER=groq`, `GROQ_API_KEY`, `AI_EMBED_PROVIDER=gemini`, `GEMINI_API_KEY`, `AI_CHAT_BACKUP_PROVIDER=gemini` (and you can remove `AI_PROVIDER`/`AI_API_KEY`).
3. **Apply**. The first build takes a few minutes. When it is live Render shows your address, e.g. `https://devvault-xxxx.onrender.com`.
4. **Set `APP_URL`** to that address (Environment tab) and let it redeploy. This bakes your site address into the downloadable CLI (so `devvault start` needs no typing) and makes email links point to the right place.

## 6. Check it works
1. Open `https://<your-app>.onrender.com/api/health`. You should see `"status":"ok"` and `"ai":{"configured":true,...}`.
2. Open the site root. You should see the DevVault landing page with an install command containing your address.
3. **Create account** → you receive a 6-digit code by email → enter it → you are in the dashboard.
   - No email? See *Troubleshooting → I never received the verification email* and `docs/TROUBLESHOOTING.md`. Render's **Logs** tab shows `[email] Brevo returned ...` with the reason.

## 7. Use it from a terminal (what your users do)
```bash
npm install -g https://<your-app>.onrender.com/downloads/devvault-cli.tgz
devvault start --api-url https://<your-app>.onrender.com
cd my-project
devvault analyze .                      # teaches DevVault your stack, databases, models
devvault ask "which databases have I used?"
```
Refresh the dashboard: the project, technology panel and notes are there.

## 8. Keep it healthy
- **Free servers sleep** after ~15 minutes idle; the first request then takes 30-60 s. To avoid that, add a free monitor (e.g. UptimeRobot) that requests `/api/health` every 5 minutes.
- **Updating:** `git push` → Render redeploys automatically. Users update the CLI by running the same `npm install -g ...` command again.
- **Backups:** Atlas M0 has no automatic backups. For anything important, export regularly (`devvault export backup.json`) or upgrade the cluster.
- **Rotating secrets:** change the value in Render → *Environment* → save (redeploys). Changing `JWT_SECRET` signs everyone out.

## 9. Optional: publish the CLI to npm too
The site download is enough, but npm gives people a shorter command.
1. Pick a free name (`npm view <name>`); scoped names like `@yourname/devvault` are always available. Change `"name"` in the root `package.json`.
2. `npm login` then `npm publish --access public`.
3. Users then run `npm install -g @yourname/devvault`; set the server once with `devvault start --api-url https://<your-app>.onrender.com` (or put it in `package.json` → `devvault.defaultApiUrl` before publishing).

## Limits to know
| Service | Free-tier limit |
|---|---|
| Render | sleeps when idle; ~750 instance hours/month |
| MongoDB Atlas M0 | 512 MB storage |
| Brevo | 300 emails/day |
| Gemini / Groq | rate limits and daily quotas; DevVault retries, switches models/providers, and falls back to keyword answers |

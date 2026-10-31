import { apiRequest, ApiError } from "../../api/client.js";
import { getApiUrl, getPackageDefaultApiUrl, readUserConfig, setSetting } from "../../config/userConfig.js";
import { ask } from "../prompt.js";
import { isLoggedIn, startSession } from "../session.js";
import { completeVerification } from "./verify.js";

export const command = ["start", "setup"];
export const describe = "Guided first-time setup: connect to your DevVault site, sign in or sign up, verify your email";

export const builder = (yargs) =>
  yargs.option("api-url", { type: "string", describe: "Address of your DevVault website" });

export function normalizeUrl(input) {
  let url = String(input).trim().replace(/\/+$/, "").replace(/\/api$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `${/^(localhost|127\.0\.0\.1)/i.test(url) ? "http" : "https"}://${url}`;
  return url;
}

async function reachable(url) {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(50_000) });
    return response.ok;
  } catch {
    return false;
  }
}

const step = (n, title) => console.log(`\n── Step ${n}: ${title} ${"─".repeat(Math.max(2, 44 - title.length))}`);

function cheatSheet(url, vault) {
  console.log("\nYou're all set! 🎉");
  console.log(`  Dashboard:  ${url}   (sign in with the same email)`);
  console.log(`  Your vault: ${vault}   (stays on this computer, backed up to your account)`);
  console.log("\nYou stay signed in on this device; no need to log in again. Try this inside any project folder:");
  console.log('  devvault note "what I just learned"       save a note for the project you are in');
  console.log("  devvault run -- npm test                   run a command; if it fails, see how you fixed it before");
  console.log("  devvault explain .                         understand a project in plain English");
  console.log("  devvault analyze <folder>                  teach DevVault about a finished project (stack, databases, models)");
  console.log('  devvault ask "which databases have I used?"  ask questions about all your projects');
  console.log("\nTip: run `devvault doctor` any time something looks wrong.");
}

async function askPassword(label) {
  return ask(`${label} (typing is hidden, that is normal): `, { hidden: true });
}

export const handler = async (argv) => {
  try {
    if (!process.stdin.isTTY) {
      throw new Error("`devvault start` is interactive. Run it in a normal terminal window.");
    }

    console.log("\nWelcome to DevVault! 👋");
    console.log("This takes about a minute. We will: 1) connect to your DevVault site  2) sign you in (or create your account)  3) verify your email.");

    if (isLoggedIn()) {
      const { user } = readUserConfig();
      console.log(`\nYou're already signed in as ${user.email}.`);
      return cheatSheet(getApiUrl(), process.env.DEVVAULT_VAULT_DIR || "(your vault)");
    }

    // ---- Step 1: server ----
    step(1, "Connect to your DevVault site");
    let url = normalizeUrl(argv.apiUrl || readUserConfig().apiUrl || getPackageDefaultApiUrl() || "");

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (!url) {
        console.log("Enter the address of your DevVault website, for example https://devvault.onrender.com");
        url = normalizeUrl(await ask("Website address: "));
      }

      process.stdout.write(`Checking ${url} ... (a free server may need up to a minute to wake up)\n`);
      if (await reachable(url)) {
        console.log("✔ Connected.");
        break;
      }

      console.log("✘ Could not reach that address. Check the spelling and your internet connection.");
      if (attempt === 3) throw new Error("Could not connect. Ask whoever runs your DevVault site for the correct address.");
      url = "";
    }

    setSetting("apiUrl", url);

    // ---- Step 2: account ----
    step(2, "Sign in or create your account");
    const hasAccount = /^y/i.test((await ask("Do you already have a DevVault account? (y = sign in, n = create one) [y/n]: ")).trim());

    let result;
    let email;

    if (hasAccount) {
      email = (await ask("Your email: ")).trim();
      const password = await askPassword("Your password");

      try {
        result = await apiRequest("POST", "/api/auth/login", { email, password }, { auth: false });
      } catch (error) {
        if (error.code !== "EMAIL_NOT_VERIFIED") throw error;
        console.log("\nYour email isn't verified yet. We'll send a fresh code.");
        await apiRequest("POST", "/api/auth/resend-verification", { email }, { auth: false });
        result = { needsCode: true };
      }
    } else {
      const name = (await ask("Your name: ")).trim();
      email = (await ask("Your email (we'll send a 6-digit code here): ")).trim();

      let password;
      for (;;) {
        password = await askPassword("Choose a password, at least 8 characters");
        if (password.length < 8) { console.log("That's too short. Use at least 8 characters."); continue; }
        if (password === (await askPassword("Type the password again"))) break;
        console.log("The two passwords didn't match. Let's try again.");
      }

      result = await apiRequest("POST", "/api/auth/register", { name, email, password }, { auth: false });
      if (result.verificationRequired) result = { needsCode: true, emailSent: result.emailSent };
    }

    // ---- Step 3: verify ----
    if (result.needsCode) {
      step(3, "Verify your email");
      console.log(result.emailSent === false
        ? `We could not send the email right now. Type "resend" below to try again.`
        : `We sent a 6-digit code to ${email}. Open your inbox (check spam too) and type the code below.`);
      console.log('The code is valid for 60 minutes. Type "resend" if it did not arrive.');
      await completeVerification(email);
    } else {
      startSession(result.user, result.token);
      console.log(`\n✔ Signed in as ${result.user.email}.`);
    }

    cheatSheet(url, process.env.DEVVAULT_VAULT_DIR);
  } catch (error) {
    console.error(`\nSetup stopped: ${error.message}`);
    if (!(error instanceof ApiError)) console.error("You can run `devvault start` again at any time.");
    process.exitCode = 1;
  }
};

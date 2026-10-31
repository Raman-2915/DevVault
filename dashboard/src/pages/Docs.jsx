import { CodeBlock } from "../components.jsx";

const origin = window.location.origin;

const COMMANDS = [
  ["devvault note \"text\"", "Save a quick note for the project you are in (--tags, --type decision|tip|todo)"],
  ["devvault notes [--all]", "List recent notes for this project, or for every project"],
  ["devvault run -- <command>", "Run any command; if it fails, see how you solved similar errors before"],
  ["devvault fix \"<error text>\"", "Search all your past projects for the solution to an error"],
  ["devvault capture-error --last --solution \"...\"", "Save the fix for the error you just hit"],
  ["devvault analyze <folder>", "Teach DevVault about a finished project: stack, databases, data models, routes"],
  ["devvault explain <folder>", "Plain-English tour of any project: what it does, structure, request flow, how to run it"],
  ["devvault ask \"question\"", "AI answers from your own notes and projects, with sources"],
  ["devvault digest", "Auto-write a work log from your recent git commits"],
  ["devvault sync", "Back up now (normally automatic)"],
  ["devvault doctor", "Check your setup and tell you how to fix problems"],
  ["devvault logout / login", "Sign out of / into this device"]
];

function Section({ id, title, children }) {
  return (
    <section className="card doc-section" id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function Docs() {
  return (
    <div className="docs">
      <h1>Get started with DevVault</h1>
      <p className="lead">DevVault is a command-line tool plus this website. The CLI runs on your computer next to your code; this site shows your notes and answers questions about all your projects. You do not need to clone any repository.</p>

      <Section id="install" title="1. Install the command-line tool">
        <p>You need <strong>Node.js 18 or newer</strong> (get it from <a href="https://nodejs.org" target="_blank" rel="noreferrer">nodejs.org</a>; check with <code>node -v</code>). Then open a terminal (PowerShell, Terminal, or any shell) and run:</p>
        <CodeBlock title="Install">{`npm install -g ${origin}/downloads/devvault-cli.tgz`}</CodeBlock>
        <p>Check that it worked:</p>
        <CodeBlock>{"devvault --version"}</CodeBlock>
        <details>
          <summary>“devvault is not recognized” / “command not found”</summary>
          <p>Close the terminal and open a new one. If it still fails, npm's global folder is not on your PATH: run <code>npm config get prefix</code>, and add that folder (on Windows it is usually <code>%APPDATA%\npm</code>) to your PATH. On macOS/Linux with permission errors, use a Node version manager (nvm) instead of <code>sudo</code>.</p>
        </details>
        <p className="muted small">To update later, run the same install command again.</p>
      </Section>

      <Section id="setup" title="2. First-time setup (one minute)">
        <p>Run the guided setup. It tells you what to type at each step:</p>
        <CodeBlock>{`devvault start --api-url ${origin}`}</CodeBlock>
        <ol className="steps-list">
          <li><strong>Connects</strong> to this website (it may take up to a minute if the free server was asleep).</li>
          <li><strong>Asks if you already have an account.</strong> Type <code>n</code> to create one: your name, email, and a password (8+ characters; typing is hidden, that is normal).</li>
          <li><strong>Verifies your email.</strong> We email a 6-digit code. Type it into the terminal (or type <code>resend</code> if it did not arrive; check spam). You can also verify on this website.</li>
          <li><strong>Done.</strong> Your personal vault is created on your computer and linked to your account.</li>
        </ol>
        <p>You <strong>stay signed in on that computer</strong>: no need to log in again when you move between projects. On a <em>new</em> computer, install the CLI and run <code>devvault login</code> (or <code>devvault start</code>) with the same account.</p>
        <p className="muted small">Until you sign in, DevVault commands are locked, so everything you save always lands in the right account and appears in this dashboard.</p>
      </Section>

      <Section id="daily" title="3. Use it while you work">
        <p>DevVault works out which project you are in from the folder (the nearest <code>.git</code> or <code>package.json</code>), so notes land in the right place automatically.</p>
        <CodeBlock title="Save what you learn">{`cd my-project
devvault note "Use cursor pagination, offset gets slow on big tables" --tags db,perf
devvault note "Decided: JWT in an httpOnly cookie, not localStorage" --type decision`}</CodeBlock>
        <CodeBlock title="Stuck on an error? Check your own history first">{`devvault run -- npm test        # if it fails, DevVault shows how you fixed similar errors before
devvault fix "MongooseServerSelectionError: connection timed out"
devvault capture-error --last --solution "Allowed my IP in Atlas"   # save the fix for next time`}</CodeBlock>
        <CodeBlock title="Teach it about your finished projects, then ask questions">{`devvault analyze ../my-old-project     # detects languages, frameworks, databases (e.g. PostgreSQL via Prisma), data models
devvault ask "Which databases have I used across my projects?"
devvault explain ../my-old-project      # plain-English overview of any project`}</CodeBlock>
        <p>Everything syncs to your account automatically, so it shows up on the <a href="#/overview">Overview</a>, <a href="#/knowledge">Knowledge</a> and <a href="#/ask">Ask AI</a> pages here.</p>
      </Section>

      <Section id="commands" title="Command cheat sheet">
        <div className="cmd-table-wrap">
          <table className="cmd-table">
            <tbody>
              {COMMANDS.map(([cmd, what]) => (
                <tr key={cmd}><td><code>{cmd}</code></td><td>{what}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="privacy" title="What leaves your computer">
        <ul>
          <li><strong>Never:</strong> your source code, file contents, absolute paths, <code>.env</code> files or secrets. Only variable <em>names</em> and database <em>types</em> are recorded.</li>
          <li><strong>Synced to your account:</strong> your notes and short facts DevVault extracted (frameworks, databases, data-model names, routes), with secrets redacted.</li>
          <li><strong>Sent to the AI provider</strong> only when you ask a question or sync: those short notes and facts, never your code.</li>
          <li>You can delete any entry here, or delete your whole account with <code>devvault account delete</code>.</li>
        </ul>
      </Section>

      <Section id="help" title="Troubleshooting">
        <details><summary>I did not get the verification email</summary><p>Check spam, then run <code>devvault verify --resend</code> (one request per minute). You can also use the “Resend code” button on the sign-in page.</p></details>
        <details><summary>“Session expired” or asked to sign in again</summary><p>Sessions renew while you use DevVault and last months, but a password reset or a very long break ends them. Just run <code>devvault login</code>.</p></details>
        <details><summary>The first command is slow</summary><p>Free servers sleep when idle and need up to a minute to wake. Local commands (<code>note</code>, <code>run</code>, <code>fix</code>) still work instantly offline.</p></details>
        <details><summary>Something else is wrong</summary><p>Run <code>devvault doctor</code>. It checks your Node version, sign-in, server connection and project detection, and tells you how to fix each problem.</p></details>
      </Section>
    </div>
  );
}

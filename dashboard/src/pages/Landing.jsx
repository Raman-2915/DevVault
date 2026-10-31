import { CodeBlock } from "../components.jsx";

const FEATURES = [
  ["Notes that follow your project", "Run devvault note inside any project folder. DevVault knows which project you are in and files it there."],
  ["Never solve a bug twice", "devvault run wraps your commands. When one fails it searches everything you've fixed before and shows the solution."],
  ["Understand any project", "devvault explain gives a plain-English tour: what it does, how it is organized, how a request flows, the data models."],
  ["Ask your whole history", "“Which databases have I used?” DevVault reads schemas and config (Prisma, Mongoose, Django…) and answers from your own work."],
  ["Private by design", "Source code and secrets never leave your computer. Only short, redacted facts and your notes are synced."],
  ["Free to run", "Works with free-tier AI and hosting. One account, every device."]
];

const origin = window.location.origin;

export default function Landing() {
  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-text">
          <h1>Your developer memory, <span>right in the terminal.</span></h1>
          <p className="lead">Keep notes while you code, never solve the same bug twice, and understand any project in plain English. Everything you save appears on this dashboard.</p>
          <div className="hero-cta">
            <a className="btn primary big" href="#/docs">Install &amp; get started</a>
            <a className="btn big" href="#/register">Create account</a>
            <a className="link" href="#/login">I already have an account</a>
          </div>
        </div>

        <div className="terminal" aria-label="Example terminal session">
          <div className="terminal-bar"><i /><i /><i /></div>
          <pre>{`$ devvault run -- npm test
✘ \`npm test\` failed with exit code 1.
  Checking your vault…

You may have solved this before:
1. MongooseServerSelectionError… (shop-api)
   ✔ Solution: Allow-list 0.0.0.0/0 in
     Atlas → Network Access

$ devvault ask "which databases have I used?"
FindIt: PostgreSQL via Prisma [1]
Shortify, Wanderlust: MongoDB via Mongoose [2][3]`}</pre>
        </div>
      </section>

      <section className="features">
        {FEATURES.map(([title, text]) => (
          <article className="card feature" key={title}>
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="card quick">
        <h2>Up and running in three steps</h2>
        <ol className="steps-list">
          <li><strong>Install</strong> (needs <a href="https://nodejs.org" target="_blank" rel="noreferrer">Node.js 18+</a>; no cloning needed):</li>
        </ol>
        <CodeBlock>{`npm install -g ${origin}/downloads/devvault-cli.tgz`}</CodeBlock>
        <ol className="steps-list" start={2}>
          <li><strong>Set up once</strong>: it guides you through sign-up and email verification:</li>
        </ol>
        <CodeBlock>{`devvault start --api-url ${origin}`}</CodeBlock>
        <ol className="steps-list" start={3}>
          <li><strong>Use it</strong> in any project folder:</li>
        </ol>
        <CodeBlock>{`devvault note "what I just learned"
devvault run -- npm test
devvault analyze .`}</CodeBlock>
        <p><a href="#/docs">Read the full guide →</a></p>
      </section>
    </div>
  );
}

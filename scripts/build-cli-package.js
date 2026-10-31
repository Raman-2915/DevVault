// Packs the CLI into dashboard/public/downloads/devvault-cli.tgz so the website can serve it:
//   npm install -g https://<your-site>/downloads/devvault-cli.tgz
// The site's own address is baked into the package (when known at build time), so `devvault start` needs no typing.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dashboard", "public", "downloads");
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "devvault-pack-"));

const siteUrl = String(process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");

try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  pkg.devvault = { ...(pkg.devvault || {}), defaultApiUrl: siteUrl || pkg.devvault?.defaultApiUrl || "" };
  // Dev-only scripts mean nothing to people who install the CLI.
  delete pkg.devDependencies;
  delete pkg.scripts;

  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify(pkg, null, 2));
  fs.cpSync(path.join(root, "src"), path.join(stage, "src"), { recursive: true });
  for (const extra of ["README.md", "LICENSE"]) {
    if (fs.existsSync(path.join(root, extra))) fs.copyFileSync(path.join(root, extra), path.join(stage, extra));
  }

  fs.mkdirSync(outDir, { recursive: true });
  const output = execFileSync("npm", ["pack", "--pack-destination", outDir, "--silent"], {
    cwd: stage,
    encoding: "utf8",
    shell: process.platform === "win32"
  }).trim().split("\n").pop();

  const target = path.join(outDir, "devvault-cli.tgz");
  fs.renameSync(path.join(outDir, output), target);
  fs.writeFileSync(path.join(outDir, "version.json"), JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString(), defaultApiUrl: pkg.devvault.defaultApiUrl }, null, 2));

  console.log(`CLI package built: ${path.relative(root, target)} (v${pkg.version}, ${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);
  console.log(pkg.devvault.defaultApiUrl ? `Default server baked in: ${pkg.devvault.defaultApiUrl}` : "No site URL known at build time; users will use `devvault start --api-url <site>`.");
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

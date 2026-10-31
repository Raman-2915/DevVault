import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the website's CLI download is a valid package with the site address baked in and no dev-only fields", () => {
  execFileSync(process.execPath, [path.join(root, "scripts", "build-cli-package.js")], {
    cwd: root,
    env: { ...process.env, APP_URL: "https://vault.example.org/" },
    stdio: "pipe"
  });

  const tarball = path.join(root, "dashboard", "public", "downloads", "devvault-cli.tgz");
  assert.ok(fs.existsSync(tarball));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dv-tgz-"));
  execFileSync("tar", ["xzf", tarball, "-C", dir]);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package", "package.json"), "utf8"));

  assert.equal(pkg.name, "devvault");
  assert.deepEqual(pkg.bin, { devvault: "src/index.js" });
  assert.equal(pkg.devvault.defaultApiUrl, "https://vault.example.org");
  assert.equal(pkg.scripts, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.ok(pkg.dependencies.yargs);
  assert.ok(fs.readFileSync(path.join(dir, "package", "src", "index.js"), "utf8").startsWith("#!/usr/bin/env node"));
  assert.ok(!fs.existsSync(path.join(dir, "package", "backend")), "the server must not be shipped to CLI users");
  assert.ok(!fs.existsSync(path.join(dir, "package", "tests")));

  const info = JSON.parse(fs.readFileSync(path.join(root, "dashboard", "public", "downloads", "version.json"), "utf8"));
  assert.equal(info.version, pkg.version);
  fs.rmSync(dir, { recursive: true, force: true });
});

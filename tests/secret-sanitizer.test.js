
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeSensitiveText } from "../src/analyzer/secretSanitizer.js";

test("redacts common credential assignments", () => {
  const input = [
    "API_KEY=example-secret-value",
    "password: example-password",
    "MONGODB_URI=mongodb+srv://user:pass@example.invalid/db",
    "Normal documentation remains visible."
  ].join("\n");

  const result = sanitizeSensitiveText(input);

  assert.doesNotMatch(result, /example-secret-value/);
  assert.doesNotMatch(result, /example-password/);
  assert.doesNotMatch(result, /user:pass@/);
  assert.match(result, /Normal documentation remains visible/);
});

test("redacts recognized token patterns", () => {
  const input = [
    "Token: sk-abcdefghijklmnop",
    "GitHub: ghp_abcdefghijklmnopqrstuv",
    "AWS: AKIA1234567890ABCDEF",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"
  ].join("\n");

  const result = sanitizeSensitiveText(input);

  assert.doesNotMatch(result, /sk-abcdefghijklmnop/);
  assert.doesNotMatch(result, /ghp_abcdefghijklmnopqrstuv/);
  assert.doesNotMatch(result, /AKIA1234567890ABCDEF/);
  assert.doesNotMatch(result, /Bearer abcdefghijklmnopqrstuvwxyz123456/);
});

test("preserves ordinary text and handles empty input", () => {
  assert.equal(
    sanitizeSensitiveText("Express routes and MongoDB models"),
    "Express routes and MongoDB models"
  );
  assert.equal(sanitizeSensitiveText(""), "");
  assert.equal(sanitizeSensitiveText(null), "");
});

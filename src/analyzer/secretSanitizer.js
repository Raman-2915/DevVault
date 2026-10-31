
const SENSITIVE_ASSIGNMENT =
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth(?:orization)?|password|passwd|secret|private[_ -]?key|client[_ -]?secret|mongodb(?:\+srv)?[_ -]?(?:uri|url)|database[_ -]?url|connection[_ -]?string)\b\s*[:=]\s*/i;

const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{12,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/gi
];

function redactLine(line) {
  // Remove a complete line when it appears to assign a credential.
  if (SENSITIVE_ASSIGNMENT.test(line)) {
    return "[REDACTED: sensitive assignment]";
  }

  let result = line;

  // Hide credentials embedded in URLs, e.g. user:password@host.
  result = result.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
    "$1[REDACTED]@"
  );

  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }

  return result;
}

export function sanitizeSensitiveText(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map(redactLine)
    .join("\n");
}

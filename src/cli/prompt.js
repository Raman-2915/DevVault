import readline from "node:readline";
import { Writable } from "node:stream";

export function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    let muted = false;

    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stdout.write(chunk);
        callback();
      }
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output,
      terminal: Boolean(process.stdin.isTTY)
    });

    process.stdout.write(question);
    muted = hidden;

    rl.question("", (answer) => {
      if (hidden) process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

export async function confirm(question) {
  const answer = (await ask(`${question} [y/N] `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

export function readAllStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

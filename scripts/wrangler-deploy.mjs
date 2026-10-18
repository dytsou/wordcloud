#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveWranglerCli() {
  const require = createRequire(import.meta.url);
  // Resolve via package.json — wrangler does not export bin/ in package exports.
  return resolve(
    dirname(require.resolve("wrangler/package.json")),
    "bin/wrangler.js",
  );
}

/** Redact workers.dev URLs and Version IDs from Wrangler deploy logs. */
export function redactDeployOutput(text) {
  return text
    .replaceAll(/https:\/\/\S+\.workers\.dev/gi, "[workers.dev URL redacted]")
    .replaceAll(
      /Current Version ID:\s*\S+/gi,
      "Current Version ID: [redacted]",
    );
}

function pipeRedacted(stream, write) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    write(redactDeployOutput(chunk));
  });
}

function main() {
  // Spawn Node + resolved Wrangler entry (no PATH lookup for the executable).
  const child = spawn(
    process.execPath,
    [resolveWranglerCli(), "deploy", ...process.argv.slice(2)],
    {
      cwd: root,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    },
  );

  pipeRedacted(child.stdout, (text) => process.stdout.write(text));
  pipeRedacted(child.stderr, (text) => process.stderr.write(text));

  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main();
}

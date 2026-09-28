#!/usr/bin/env node

/* global console, setTimeout */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLOUDFLARE_SECRET_NAMES = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
];
const EXTERNAL_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;
const args = process.argv.slice(2);
const options = {
  configureGithub: args.includes("--configure-github"),
  github: args.includes("--github"),
  help: args.includes("--help") || args.includes("-h"),
};

const unknownArgs = args.filter(
  (argument) =>
    !["--configure-github", "--github", "--help", "-h"].includes(argument),
);

function printHelp() {
  console.log(
    [
      "Wordcloud Studio deployment helper",
      "",
      "Usage:",
      "  pnpm run deploy:release",
      "  pnpm run deploy:release -- --github",
      "  pnpm run deploy:release -- --github --configure-github",
      "",
      "Default mode builds, validates, and deploys the current checkout with Wrangler.",
      "--github dispatches the protected deploy.yml workflow on main and waits for it.",
      "--configure-github stores CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN",
      "as GitHub Actions secrets using gh secret set over stdin.",
      "",
      "When a Cloudflare variable is missing, the local TTY asks for it interactively.",
      "The API token is hidden while typing; non-interactive runs must set both variables.",
    ].join("\n"),
  );
}

function commandLabel(command, commandArgs) {
  return [command, ...commandArgs].join(" ");
}

function childEnv(includeCloudflareCredentials = false) {
  const env = { ...process.env };
  if (!includeCloudflareCredentials) {
    for (const secretName of CLOUDFLARE_SECRET_NAMES) {
      delete env[secretName];
    }
  }
  return env;
}

function run(
  command,
  commandArgs,
  {
    input,
    includeCloudflareCredentials = false,
    timeoutMs = EXTERNAL_COMMAND_TIMEOUT_MS,
  } = {},
) {
  const label = commandLabel(command, commandArgs);
  console.log("\n$ " + label);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    env: childEnv(includeCloudflareCredentials),
    input,
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    timeout: timeoutMs,
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(label + " timed out.");
    }
    throw new Error(label + ": " + result.error.message);
  }
  if (result.status !== 0) {
    throw new Error(
      label + " exited with code " + String(result.status ?? "unknown"),
    );
  }
  return result;
}

function capture(
  command,
  commandArgs,
  {
    includeCloudflareCredentials = false,
    timeoutMs = EXTERNAL_COMMAND_TIMEOUT_MS,
  } = {},
) {
  const label = commandLabel(command, commandArgs);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    env: childEnv(includeCloudflareCredentials),
    timeout: timeoutMs,
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(label + " timed out.");
    }
    throw new Error(label + ": " + result.error.message);
  }
  if (result.status !== 0) {
    const details = result.stderr?.trim();
    throw new Error(
      label +
        " exited with code " +
        String(result.status ?? "unknown") +
        (details ? ": " + details : ""),
    );
  }
  return result.stdout.trim();
}

function hasCommand(command) {
  const result = spawnSync(command, ["--version"], {
    cwd: root,
    env: childEnv(),
    stdio: "ignore",
    timeout: 30_000,
  });
  return !result.error && result.status === 0;
}

function requireCommand(command, installHint) {
  if (!hasCommand(command)) {
    throw new Error(
      "Could not find " + command + ". Install it first: " + installHint,
    );
  }
}

function requireFile(path, description) {
  if (!existsSync(resolve(root, path))) {
    throw new Error("Could not find " + description + ": " + path);
  }
}

function requireCloudflareAuth() {
  try {
    run("pnpm", ["exec", "wrangler", "whoami"], {
      includeCloudflareCredentials: true,
    });
  } catch {
    throw new Error(
      "Cloudflare credentials are invalid. Check the Account ID and API token.",
    );
  }
}

function requireGithubAuth() {
  try {
    run("gh", ["auth", "status"]);
  } catch {
    throw new Error(
      "GitHub CLI is not authenticated. Run gh auth login first.",
    );
  }
}

async function askVisible(prompt) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await readline.question(prompt)).trim();
  } finally {
    readline.close();
  }
}

function askHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(
      new Error(
        "An interactive terminal is required. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, then try again.",
      ),
    );
  }

  return new Promise((resolvePrompt, rejectPrompt) => {
    const stdin = process.stdin;
    let value = "";
    const wasRaw = stdin.isRaw;

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode?.(wasRaw ?? false);
      stdin.pause();
    };

    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          rejectPrompt(new Error("Input was cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolvePrompt(value.trim());
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
          }
          continue;
        }
        value += character;
      }
    };

    process.stdout.write(prompt);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function ensureCloudflareCredentials() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (accountId) {
    process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
  }
  if (apiToken) {
    process.env.CLOUDFLARE_API_TOKEN = apiToken;
  }
  if (accountId && apiToken) {
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Cloudflare credentials are missing. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for non-interactive use.",
    );
  }

  console.log(
    "\n本地部署需要 Cloudflare credentials；已設定的環境變數會直接沿用。",
  );
  if (!accountId) {
    const enteredAccountId = await askVisible("Cloudflare Account ID: ");
    if (!enteredAccountId) {
      throw new Error("CLOUDFLARE_ACCOUNT_ID must not be blank.");
    }
    process.env.CLOUDFLARE_ACCOUNT_ID = enteredAccountId;
  }
  if (!apiToken) {
    const enteredApiToken = await askHidden("Cloudflare API Token: ");
    if (!enteredApiToken) {
      throw new Error("CLOUDFLARE_API_TOKEN must not be blank.");
    }
    process.env.CLOUDFLARE_API_TOKEN = enteredApiToken;
  }
}

function githubRepository() {
  try {
    return capture("gh", [
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "--jq",
      ".nameWithOwner",
    ]);
  } catch {
    throw new Error(
      "Could not determine the GitHub repository. Check that the current directory has an origin remote and that gh is authenticated.",
    );
  }
}

function configureGithubSecrets(repository) {
  for (const secretName of CLOUDFLARE_SECRET_NAMES) {
    const value = process.env[secretName];
    if (!value) {
      throw new Error("Missing required GitHub secret: " + secretName + ".");
    }
    run("gh", ["secret", "set", secretName, "--repo", repository], {
      input: value + "\n",
    });
  }
}

function requireGithubSecrets(repository) {
  const configured = new Set(
    capture("gh", [
      "secret",
      "list",
      "--repo",
      repository,
      "--json",
      "name",
      "--jq",
      ".[].name",
    ])
      .split("\n")
      .filter(Boolean),
  );
  const missing = CLOUDFLARE_SECRET_NAMES.filter(
    (secretName) => !configured.has(secretName),
  );
  if (missing.length > 0) {
    throw new Error(
      "GitHub Actions is missing required secrets: " +
        missing.join(", ") +
        ". Run --configure-github to set them.",
    );
  }
}

function requireCleanMainBranch(repository) {
  const branch = capture("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    throw new Error(
      "--github deploys only from main; the current branch is " +
        branch +
        ". Switch to main first.",
    );
  }
  if (capture("git", ["status", "--porcelain"])) {
    throw new Error(
      "--github requires a clean working tree. Commit your changes first.",
    );
  }
  const localHead = capture("git", ["rev-parse", "HEAD"]);
  const remoteHead = capture("gh", [
    "api",
    "repos/" + repository + "/git/ref/heads/main",
    "--jq",
    ".object.sha",
  ]);
  if (localHead !== remoteHead) {
    throw new Error(
      "Local HEAD does not match GitHub main. Sync main before running --github.",
    );
  }
  return localHead;
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}

async function waitForGithubDeployment(
  repository,
  startedAt,
  revisionSha,
  deploymentNonce,
) {
  const timeoutAt = Date.now() + 5 * 60 * 1000;
  while (Date.now() < timeoutAt) {
    const runs = JSON.parse(
      capture("gh", [
        "run",
        "list",
        "--workflow",
        "deploy.yml",
        "--repo",
        repository,
        "--limit",
        "20",
        "--json",
        "databaseId,event,headBranch,headSha,createdAt,displayTitle,url",
      ]),
    );
    const workflowRun = runs.find(
      (candidate) =>
        candidate.event === "workflow_dispatch" &&
        candidate.headBranch === "main" &&
        candidate.headSha === revisionSha &&
        candidate.displayTitle === "Deploy " + deploymentNonce &&
        Date.parse(candidate.createdAt) >= startedAt - 5_000,
    );
    if (workflowRun) {
      run("gh", [
        "run",
        "watch",
        String(workflowRun.databaseId),
        "--repo",
        repository,
        "--exit-status",
      ]);
      console.log(
        "\nGitHub deployment completed: " +
          (workflowRun.url ??
            "https://github.com/" +
              repository +
              "/actions/runs/" +
              workflowRun.databaseId),
      );
      return;
    }
    await sleep(3_000);
  }
  throw new Error(
    "Timed out waiting for the GitHub deploy workflow. Check its status with gh run list.",
  );
}

async function main() {
  if (options.help) {
    printHelp();
    return;
  }
  if (unknownArgs.length > 0) {
    throw new Error(
      "Unknown arguments: " + unknownArgs.join(", ") + ". Use --help.",
    );
  }

  requireFile("package.json", "package.json");
  requireFile("wrangler.toml", "Wrangler 設定");
  requireCommand("pnpm", "https://pnpm.io/installation");
  requireCommand("git", "https://git-scm.com/downloads");
  requireCommand("gh", "https://cli.github.com/");

  requireGithubAuth();
  const repository = githubRepository();
  let revisionSha;
  if (options.github) {
    revisionSha = requireCleanMainBranch(repository);
  }
  run("pnpm", ["install", "--frozen-lockfile"]);

  if (!options.github || options.configureGithub) {
    await ensureCloudflareCredentials();
  }
  if (!options.github) {
    requireCloudflareAuth();
  }

  if (options.configureGithub) {
    configureGithubSecrets(repository);
  }
  if (options.github) {
    requireGithubSecrets(repository);
  }

  run("pnpm", ["run", "build:all"]);
  run("pnpm", ["run", "wrangler:dry-run"]);

  if (options.github) {
    const startedAt = Date.now();
    const deploymentNonce = randomUUID();
    run("gh", [
      "workflow",
      "run",
      "deploy.yml",
      "--repo",
      repository,
      "--ref",
      "main",
      "--field",
      "revision=" + revisionSha,
      "--field",
      "deployment_nonce=" + deploymentNonce,
    ]);
    await waitForGithubDeployment(
      repository,
      startedAt,
      revisionSha,
      deploymentNonce,
    );
    return;
  }

  run("pnpm", ["exec", "wrangler", "deploy"], {
    includeCloudflareCredentials: true,
  });
  console.log(
    "\nCloudflare deployment completed. Use the URL printed by Wrangler to open the Worker.",
  );
}

try {
  await main();
} catch (error) {
  console.error("\nDeployment stopped: " + error.message);
  process.exitCode = 1;
}

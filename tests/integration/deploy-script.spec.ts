import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as { scripts?: Record<string, string> };

describe("Deployment helper", () => {
  it("exposes local and GitHub deployment entry points", () => {
    expect(packageJson.scripts).toMatchObject({
      "deploy:release": "node scripts/deploy.mjs",
      "deploy:github": "node scripts/deploy.mjs --github",
    });
  });

  it("provides a safe help path without invoking deployment commands", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(root, "scripts/deploy.mjs"), "--help"],
      { cwd: root, encoding: "utf8" },
    );
    expect(output).toContain("pnpm run deploy:release");
    expect(output).toContain("--configure-github");
    expect(output).toContain("gh secret set");
    expect(output).toContain("interactively");
    expect(output).toContain("API token");
  });

  it("does not pass Cloudflare credentials to build or GitHub commands", () => {
    const temporaryDirectory = mkdtempSync(
      resolve(tmpdir(), "wordcloud-deploy-test-"),
    );
    const fakeBin = resolve(temporaryDirectory, "bin");
    const logPath = resolve(temporaryDirectory, "commands.ndjson");
    const fakeCommand = resolve(temporaryDirectory, "fake-cli.mjs");
    const fakeCommandSource = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const command = process.env.DEPLOY_TEST_COMMAND;
const args = process.argv.slice(2);
appendFileSync(
  process.env.DEPLOY_TEST_LOG,
  JSON.stringify({
    command,
    args,
    account: process.env.CLOUDFLARE_ACCOUNT_ID ?? null,
    token: process.env.CLOUDFLARE_API_TOKEN ?? null,
  }) + "\\n",
);
if (command === "gh" && args[0] === "repo" && args[1] === "view") {
  process.stdout.write("example/wordcloud\\n");
}
`;

    try {
      writeFileSync(fakeCommand, fakeCommandSource, "utf8");
      chmodSync(fakeCommand, 0o755);
      mkdirSync(fakeBin);
      writeFileSync(resolve(fakeBin, ".keep"), "", "utf8");
      for (const command of ["gh", "git", "pnpm"]) {
        const commandPath = resolve(fakeBin, command);
        writeFileSync(
          commandPath,
          `#!/bin/sh\nexport DEPLOY_TEST_COMMAND=${command}\nexec node '${fakeCommand}' "$@"\n`,
        );
        chmodSync(commandPath, 0o755);
      }

      execFileSync(process.execPath, [resolve(root, "scripts/deploy.mjs")], {
        cwd: root,
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: "account-id",
          CLOUDFLARE_API_TOKEN: "api-token",
          DEPLOY_TEST_LOG: logPath,
          PATH: fakeBin + ":" + process.env.PATH,
        },
        encoding: "utf8",
      });

      const records = readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              command: string;
              args: string[];
              account: string | null;
              token: string | null;
            },
        );
      const pnpmRecords = records.filter((record) => record.command === "pnpm");
      const ghRecords = records.filter((record) => record.command === "gh");
      expect(
        pnpmRecords
          .filter(
            (record) =>
              !record.args.includes("whoami") &&
              !record.args.includes("deploy"),
          )
          .every((record) => record.account === null && record.token === null),
      ).toBe(true);
      expect(
        pnpmRecords.some(
          (record) =>
            record.args.includes("whoami") &&
            record.account === "account-id" &&
            record.token === "api-token",
        ),
      ).toBe(true);
      expect(
        pnpmRecords.some(
          (record) =>
            record.args.includes("deploy") &&
            record.account === "account-id" &&
            record.token === "api-token",
        ),
      ).toBe(true);
      expect(
        ghRecords.every(
          (record) => record.account === null && record.token === null,
        ),
      ).toBe(true);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

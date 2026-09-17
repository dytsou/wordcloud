import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const nodeProcess = globalThis.process;
const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(rootDirectory, "dist", "client", "api");
const require = createRequire(import.meta.url);

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: rootDirectory,
      stdio: "inherit",
    });

    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

await mkdir(outputDirectory, { recursive: true });

const pnpmCommand = nodeProcess.platform === "win32" ? "pnpm.cmd" : "pnpm";
await run(pnpmCommand, [
  "exec",
  "redocly",
  "bundle",
  "openapi.yaml",
  "--output",
  "dist/client/api/openapi.yaml",
]);

const swaggerUiDirectory = dirname(require.resolve("swagger-ui-dist"));
const swaggerUiAssets = [
  "favicon-16x16.png",
  "favicon-32x32.png",
  "swagger-ui-bundle.js",
  "swagger-ui-standalone-preset.js",
  "swagger-ui.css",
];

await Promise.all(
  swaggerUiAssets.map((asset) =>
    copyFile(join(swaggerUiDirectory, asset), join(outputDirectory, asset)),
  ),
);

await writeFile(
  resolve(outputDirectory, "index.html"),
  `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Wordcloud MCP API</title>
    <link rel="icon" type="image/png" sizes="32x32" href="./favicon-32x32.png" />
    <link rel="stylesheet" href="./swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="./swagger-ui-bundle.js"></script>
    <script src="./swagger-ui-standalone-preset.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: "./openapi.yaml",
          dom_id: "#swagger-ui",
          deepLinking: true,
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset,
          ],
          plugins: [SwaggerUIBundle.plugins.DownloadUrl],
          layout: "StandaloneLayout",
        });
      };
    </script>
  </body>
</html>
`,
  "utf8",
);

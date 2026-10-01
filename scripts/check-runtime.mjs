import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { resolve } from "node:path";

// Exercise emitted JavaScript without tsx/Vite masking Node's module resolution.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../.runtime-check/", import.meta.url);
const outputPath = fileURLToPath(output);
assert.equal(resolve(outputPath), resolve(root, ".runtime-check"));
let server;
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "-p",
      "tsconfig.server.json",
      "--noEmit",
      "false",
      "--allowImportingTsExtensions",
      "false",
      "--outDir",
      ".runtime-check",
    ],
    { cwd: root, stdio: "inherit" },
  );
  delete process.env.DATABASE_URL;
  delete process.env.AUTH_DATABASE_URL;
  const { default: domain } = await import(new URL("api/recicla.js", output));
  const { default: authentication } = await import(
    new URL("api/auth.js", output)
  );
  server = createServer((request, response) => {
    void (request.url.startsWith("/api/auth") ? authentication : domain)(
      request,
      response,
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = await fetch(`${base}/api/recicla?action=status`);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { configured: false });
  const session = await fetch(`${base}/api/recicla?action=session`);
  assert.equal(session.status, 503);
  assert.equal((await session.json()).code, "NOT_CONFIGURED");
  const signin = await fetch(`${base}/api/auth?__authPath=sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(signin.status, 503);
  assert.equal((await signin.json()).code, "NOT_CONFIGURED");
  console.log(
    "APIs compiladas carregam no Node e respondem com JSON sem credenciais.",
  );
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(outputPath, { recursive: true, force: true });
}

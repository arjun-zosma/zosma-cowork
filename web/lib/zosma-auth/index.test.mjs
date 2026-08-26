import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { startZosmaAuth, ZOSMA_CLIENT_ID } = await jiti.import("./index.ts");
const stateModule = await jiti.import("./state.ts");

async function withPiDir(run) {
  return async () => {
    const dir = await mkdtemp(join(tmpdir(), "zosma-index-"));
    try {
      await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

function stubFetch(handler) {
  return async (url, init) => handler(String(url), init);
}

function fileExists(path) {
  return readFile(path, "utf-8").then(() => true, () => false);
}

test("startZosmaAuth returns the server authorization_url", withPiDir(async (dir) => {
  const fetch = stubFetch(async () =>
    Response.json({ authorization_url: "https://router.zosma.ai/authorize?x=1" }),
  );
  const res = await startZosmaAuth(dir, { fetch });
  assert.equal(res.authorizationUrl, "https://router.zosma.ai/authorize?x=1");
}));

test("startZosmaAuth persists pending tx + device id before the network call", withPiDir(async (dir) => {
  const calls = [];
  const fetch = stubFetch(async (url) => {
    calls.push(url);
    // Read state mid-flight: pending file must already exist.
    const pending = JSON.parse(await readFile(join(dir, "zosma-auth-pending.json"), "utf-8"));
    assert.ok(pending.state);
    assert.ok(pending.codeVerifier);
    assert.ok(pending.deviceId);
    return Response.json({ authorization_url: "https://x/authorize" });
  });
  await startZosmaAuth(dir, { fetch });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/router\.zosma\.ai\/v1\/cowork\/authorizations$/);
  const deviceId = (await readFile(join(dir, "zosma-device-id.txt"), "utf-8")).trim();
  assert.match(deviceId, /^cowork-[0-9a-f]{32}$/);
}));

test("startZosmaAuth sends frozen client_id, PKCE fields and device id", withPiDir(async (dir) => {
  let body;
  const fetch = stubFetch(async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({ authorization_url: "https://x/authorize" });
  });
  await startZosmaAuth(dir, { fetch });
  assert.equal(body.client_id, ZOSMA_CLIENT_ID);
  assert.match(body.state, /^[0-9a-f]{64}$/);
  assert.match(body.code_challenge, /^[A-Za-z0-9_-]+$/);
  assert.equal(body.code_challenge_method, "S256");
  assert.match(body.device_id, /^cowork-/);
}));

test("startZosmaAuth reuses an existing device id across calls", withPiDir(async (dir) => {
  const fetch = stubFetch(async () => Response.json({ authorization_url: "https://x/authorize" }));
  await startZosmaAuth(dir, { fetch });
  const first = await readFile(join(dir, "zosma-device-id.txt"), "utf-8");
  await startZosmaAuth(dir, { fetch });
  assert.equal(await readFile(join(dir, "zosma-device-id.txt"), "utf-8"), first);
}));

test("startZosmaAuth throws and clears pending tx when the auth server errors", withPiDir(async (dir) => {
  const fetch = stubFetch(async () => new Response("nope", { status: 500 }));
  await assert.rejects(() => startZosmaAuth(dir, { fetch }), /Auth server returned 500/);
  assert.equal(await fileExists(join(dir, "zosma-auth-pending.json")), false);
}));

test("startZosmaAuth throws when authorization_url is missing", withPiDir(async (dir) => {
  const fetch = stubFetch(async () => Response.json({}));
  await assert.rejects(() => startZosmaAuth(dir, { fetch }), /missing authorization_url/);
}));

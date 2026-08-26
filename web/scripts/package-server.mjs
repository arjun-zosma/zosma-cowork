#!/usr/bin/env node
// Packages the standalone Next.js output into web/dist-server/ — the resource
// layout the Tauri shell spawns (`node dist-server/bin/pi-web.js --port 30141`).
//
// Run after `npm run build`. Refuses to run while a dev server answers on
// 127.0.0.1:30141 (repo rule: never build/repackage while `next dev` runs —
// it pollutes .next/ and breaks the dev server).
//
// External packages (from `serverExternalPackages` in next.config.ts) stay
// out of the bundle, so dist-server needs the real package dirs. Next's
// output tracing usually copies them already; this script only fills gaps.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const root = join(dirname(fileURLToPath(import.meta.url)), ".."); // web/
const PORT = 30141;

function portOpen() {
  return new Promise((resolve) => {
    const s = net.createConnection(PORT, "127.0.0.1");
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(500);
    s.on("connect", () => done(true));
    s.on("timeout", () => done(false));
    s.on("error", () => done(false));
  });
}

if (await portOpen()) {
  console.error(`refusing: 127.0.0.1:${PORT} already answers (stop the dev server / running pi-web first)`);
  process.exit(1);
}

const config = readFileSync(join(root, "next.config.ts"), "utf8");
const match = config.match(/serverExternalPackages\s*:\s*\[([^\]]*)\]/);
if (!match) {
  console.error("serverExternalPackages not found in next.config.ts");
  process.exit(1);
}
const external = match[1]
  .split(",")
  .map((s) => s.trim().replace(/^["']|["']$/g, ""))
  .filter(Boolean);

const standalone = join(root, ".next/standalone");
if (!existsSync(standalone)) {
  console.error(".next/standalone missing — run `npm run build` first (next.config.ts must keep output: \"standalone\")");
  process.exit(1);
}

const dist = join(root, "dist-server");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. Standalone server: server.js, pinned package.json, trimmed node_modules, .next/server
cpSync(standalone, dist, { recursive: true });

// 2. Next standalone layout extras (not part of the standalone dir)
cpSync(join(root, ".next/static"), join(dist, ".next/static"), { recursive: true });
cpSync(join(root, "public"), join(dist, "public"), { recursive: true });

// 3. Launcher (bin/ is not traced by the server bundle)
cpSync(join(root, "bin"), join(dist, "bin"), { recursive: true });

// 4. Fill any external packages the output trace missed
let filled = 0;
for (const pkg of external) {
  const target = join(dist, "node_modules", pkg);
  const source = join(root, "node_modules", pkg);
  if (!existsSync(target) && existsSync(source)) {
    cpSync(source, target, { recursive: true });
    filled += 1;
  }
}

if (!existsSync(join(dist, "server.js"))) {
  console.error("packaging failed: dist-server/server.js missing");
  process.exit(1);
}
console.log(`dist-server ready (external packages filled: ${filled}/${external.length})`);
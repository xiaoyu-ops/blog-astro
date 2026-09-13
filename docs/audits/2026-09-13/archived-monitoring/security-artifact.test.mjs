import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import test from "node:test";

test("built inline modules are covered by the deployed CSP", async () => {
  let html;
  try { html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8"); }
  catch { return; }
  const config = await readFile(new URL("../vercel.json", import.meta.url), "utf8");
  for (const body of html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)) {
    const hash = `'sha256-${crypto.createHash("sha256").update(body[1]).digest("base64")}'`;
    assert.match(config, new RegExp(hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing CSP hash ${hash}`);
  }
});

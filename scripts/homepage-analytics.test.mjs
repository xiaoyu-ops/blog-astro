import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homepagePath = new URL("../src/pages/index.astro", import.meta.url);
const layoutPath = new URL("../src/layouts/Layout.astro", import.meta.url);

test("keeps homepage visit counters and visitor map wired up", async () => {
  const [homepage, layout] = await Promise.all([
    readFile(homepagePath, "utf8"),
    readFile(layoutPath, "utf8"),
  ]);

  assert.match(homepage, /id="view-total"/);
  assert.match(homepage, /id="view-today"/);
  assert.match(homepage, /id="_waubmap"/);
  assert.match(homepage, /blogxiaoyu66/);
  assert.match(homepage, /https:\/\/waust\.at\/m\.js/);
  assert.match(layout, /fetch\(['"]\/api\/views\/track['"]/);
  assert.match(layout, /JSON\.stringify\(\{ path: location\.pathname \}\)/);
});

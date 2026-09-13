import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homepagePath = new URL("../src/pages/index.astro", import.meta.url);
const analyticsPath = new URL("../public/scripts/analytics.js", import.meta.url);

test("keeps homepage visit counters wired to the first-party analytics worker", async () => {
  const [homepage, analytics] = await Promise.all([
    readFile(homepagePath, "utf8"),
    readFile(analyticsPath, "utf8"),
  ]);

  assert.match(homepage, /id="view-total"/);
  assert.match(homepage, /id="view-today"/);
  assert.doesNotMatch(homepage, /waust\.at|_waubmap/);
  assert.match(
    analytics,
    /lab2-public-status\.wuzhuoyang252\.workers\.dev\/api\/views\/track/,
  );
  assert.match(analytics, /JSON\.stringify\(\{ path: location\.pathname \}\)/);
});

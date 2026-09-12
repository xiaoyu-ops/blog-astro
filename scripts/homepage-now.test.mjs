import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps current-work data commands independent from the homepage", async () => {
  const [homepage, items, packageJson, contentReadme, script] = await Promise.all([
    readFile(new URL("src/pages/index.astro", root), "utf8"),
    readFile(new URL("src/data/now.json", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("src/content/README.md", root), "utf8"),
    readFile(new URL("scripts/now.mjs", root), "utf8"),
  ]);

  const parsedItems = JSON.parse(items);
  assert.equal(parsedItems.length, 3);
  assert.ok(parsedItems.every((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.startedAt)));
  assert.doesNotMatch(homepage, /<aside id="now"|now-widget|data-now-|<LabStatusRow|nowItems/);
  assert.match(contentReadme, /首页不再显示 NOW 卡片/);

  const scripts = JSON.parse(packageJson).scripts;
  assert.equal(scripts["now:add"], "node scripts/now.mjs add");
  assert.equal(scripts["now:update"], "node scripts/now.mjs update");
  assert.equal(scripts["now:complete"], "node scripts/now.mjs complete");
  assert.match(contentReadme, /pnpm now:add/);
  assert.match(contentReadme, /pnpm now:update/);
  assert.match(contentReadme, /pnpm now:complete/);
  assert.match(script, /startedAt: requireDate\(flags\.get\("start"\) \?\? today\(\), "start"\)/);
});

test("local now command records start date when an item is added", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "blog-now-"));
  await mkdir(path.join(temporaryRoot, "src", "data"), { recursive: true });
  await writeFile(path.join(temporaryRoot, "src", "data", "now.json"), "[]\n");

  const result = spawnSync(
    process.execPath,
    [
      new URL("scripts/now.mjs", root).pathname,
      "add",
      "test-item",
      "--title",
      "测试事项",
      "--title-en",
      "Test item",
      "--deadline",
      "2099-12-31",
    ],
    { cwd: temporaryRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const [item] = JSON.parse(await readFile(path.join(temporaryRoot, "src", "data", "now.json"), "utf8"));
  assert.match(item.startedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(item.deadline, "2099-12-31");
});

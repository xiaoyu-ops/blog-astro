import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps homepage writing categories, local history scroll, and contact icons wired up", async () => {
  const [homepage, contentConfig, newPostScript, packageJson, contentReadme] = await Promise.all([
    readFile(new URL("src/pages/index.astro", root), "utf8"),
    readFile(new URL("src/content.config.ts", root), "utf8"),
    readFile(new URL("scripts/new-post.mjs", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("src/content/README.md", root), "utf8"),
  ]);

  assert.match(contentConfig, /z\.enum\(\["notes", "technical"\]\)\.default\("notes"\)/);
  assert.match(newPostScript, /--category notes\|technical/);
  assert.match(newPostScript, /category: "\$\{category\}"/);
  assert.equal(JSON.parse(packageJson).scripts["new:post"], "node scripts/new-post.mjs");
  assert.match(newPostScript, /Usage: pnpm new:post/);
  assert.match(contentReadme, /pnpm new:post/);
  assert.match(contentReadme, /--category notes/);
  assert.match(contentReadme, /--category technical/);
  assert.match(contentReadme, /--publish/);

  assert.match(homepage, /role="tablist"/);
  assert.match(homepage, /data-writing-tab=\{category\.id\}/);
  assert.match(homepage, /data-writing-panel=\{category\.id\}/);
  assert.match(homepage, /height: 15rem/);
  assert.match(homepage, /panel\.scrollHeight > panel\.clientHeight/);
  assert.match(homepage, /event\.key === "ArrowRight"/);

  assert.match(homepage, /data-contact-icon="github"/);
  assert.match(homepage, /data-contact-icon="email"/);
  assert.match(homepage, /data-contact-icon="wechat"/);
});

test("assigns every existing blog post to a writing category", async () => {
  const blogDir = new URL("src/content/blog/", root);
  const files = (await readdir(blogDir)).filter((file) => /\.mdx?$/.test(file));
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, blogDir), "utf8")));

  assert.ok(files.length > 0);
  for (const source of sources) {
    assert.match(source, /^category: "(notes|technical)"$/m);
  }
});

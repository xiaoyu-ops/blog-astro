import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("keeps the global language switch, persistence, and localized homepage wired up", async () => {
  const [
    layout,
    header,
    homepage,
    globalStyles,
    contentConfig,
    blogPage,
    projectPage,
    newPostScript,
    publishPostScript,
    contentReadme,
  ] =
    await Promise.all([
      readFile(new URL("src/layouts/Layout.astro", root), "utf8"),
      readFile(new URL("src/components/Header.astro", root), "utf8"),
      readFile(new URL("src/pages/index.astro", root), "utf8"),
      readFile(new URL("src/styles/global.css", root), "utf8"),
      readFile(new URL("src/content.config.ts", root), "utf8"),
      readFile(new URL("src/pages/blog/[slug].astro", root), "utf8"),
      readFile(new URL("src/pages/projects/[slug].astro", root), "utf8"),
      readFile(new URL("scripts/new-post.mjs", root), "utf8"),
      readFile(new URL("scripts/publish-post.mjs", root), "utf8"),
      readFile(new URL("src/content/README.md", root), "utf8"),
    ]);

  assert.match(layout, /localStorage\.getItem\(['"]language['"]\)/);
  assert.match(layout, /navigator\.language/);
  assert.match(layout, /document\.documentElement\.dataset\.lang/);

  assert.match(header, /id="language-toggle"/);
  assert.match(header, /localStorage\.setItem\(['"]language['"]/);
  assert.match(header, /document\.documentElement\.lang/);
  assert.match(header, /data-language-aria-zh/);

  assert.match(globalStyles, /html\[data-lang="zh"\] \[data-lang="en"\]/);
  assert.match(globalStyles, /html\[data-lang="en"\] \[data-lang="zh"\]/);

  assert.match(contentConfig, /titleEn: z\.string\(\)\.min\(1\)\.optional\(\)/);
  assert.match(contentConfig, /descriptionEn: z\.string\(\)\.min\(1\)\.optional\(\)/);
  assert.match(contentConfig, /tagsEn: z\.array\(z\.string\(\)\)\.optional\(\)/);

  assert.match(homepage, /My work centers on/);
  assert.match(homepage, />AI agents</);
  assert.match(homepage, /Do work<br \/>that matters/);
  assert.match(homepage, /project\.data\.titleEn/);
  assert.match(homepage, /post\.data\.titleEn/);
  assert.match(homepage, /data-language-alt-en/);

  assert.match(blogPage, /post\.data\.titleEn/);
  assert.match(blogPage, /This essay is currently available in Chinese/);
  assert.match(projectPage, /project\.data\.titleEn/);
  assert.match(projectPage, /This project write-up is currently available in Chinese/);

  assert.match(newPostScript, /--title-en/);
  assert.match(newPostScript, /--description-en/);
  assert.match(newPostScript, /titleEn: \$\{JSON\.stringify\(titleEn\)\}/);
  assert.match(newPostScript, /descriptionEn: \$\{JSON\.stringify\(descriptionEn\)\}/);
  assert.match(publishPostScript, /English title/);
  assert.match(publishPostScript, /English description/);
  assert.match(contentReadme, /--title-en/);
  assert.match(contentReadme, /--description-en/);
});

test("every existing card has natural English metadata", async () => {
  for (const collection of ["blog", "projects"]) {
    const directory = new URL(`src/content/${collection}/`, root);
    const files = (await readdir(directory)).filter((file) => /\.mdx?$/.test(file));
    const sources = await Promise.all(files.map((file) => readFile(new URL(file, directory), "utf8")));

    assert.ok(files.length > 0);
    for (const source of sources) {
      assert.match(source, /^titleEn: ".+"$/m);
      assert.match(source, /^descriptionEn: ".+"$/m);
      if (collection === "projects") {
        assert.match(source, /^tagsEn:$/m);
      }
    }
  }
});

import assert from "node:assert/strict";
import { access, mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { preparePostImages } from "./post-images.mjs";

test("fixes backticks and an image extension that does not match its content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "blog-images-"));
  const postDir = path.join(root, "src", "content", "blog");
  const imageDir = path.join(postDir, "images", "example");
  const wrongPath = path.join(imageDir, "score.webp");
  await mkdir(imageDir, { recursive: true });
  await sharp({
    create: { width: 4, height: 4, channels: 3, background: "white" },
  })
    .png()
    .toFile(wrongPath);

  const source = "`![Score](./images/example/score.webp)`";
  const result = await preparePostImages(source, path.join(postDir, "example.md"), {
    log() {},
  });

  assert.equal(result.source, "![Score](./images/example/score.png)");
  assert.equal(result.fixedMarkdown, 1);
  assert.equal(result.fixedExtensions, 1);
  await access(path.join(imageDir, "score.png"));
  await assert.rejects(access(wrongPath));
});

test("reports a missing local image before the build starts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "blog-images-"));
  const postPath = path.join(root, "post.md");

  await assert.rejects(
    preparePostImages("![Missing](./missing.png)", postPath, { log() {} }),
    /Image not found/,
  );
});

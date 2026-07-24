import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const homepagePath = new URL("../src/pages/index.astro", import.meta.url);
const stickerPath = new URL("../public/images/automail-sticker.png", import.meta.url);
const vendorPath = new URL("../src/vendor/sticker-forge.es.js", import.meta.url);
const noticesPath = new URL("../THIRD_PARTY_NOTICES.md", import.meta.url);

test("keeps the homepage sticker progressive and self-contained", async () => {
  const [homepage, stickerMetadata, vendorStats, notices] = await Promise.all([
    readFile(homepagePath, "utf8"),
    sharp(fileURLToPath(stickerPath)).metadata(),
    stat(vendorPath),
    readFile(noticesPath, "utf8"),
  ]);

  assert.equal(stickerMetadata.hasAlpha, true);
  assert.equal(stickerMetadata.width, 768);
  assert.equal(stickerMetadata.height, 768);
  assert.ok(vendorStats.size > 100_000);

  assert.match(homepage, /data-hero-sticker/);
  assert.match(homepage, /\/images\/automail-sticker\.png/);
  assert.match(homepage, /import\("\.\.\/vendor\/sticker-forge\.es\.js"\)/);
  assert.match(homepage, /prefers-reduced-motion: reduce/);
  assert.match(homepage, /connection\?\.saveData/);
  assert.match(homepage, /sound: \{ enabled: false, volume: 0 \}/);
  assert.match(notices, /Copyright \(c\) 2026 CatsJuice/);
});

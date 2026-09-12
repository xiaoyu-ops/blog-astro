import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const homepagePath = path.join(rootDir, "src/pages/index.astro");
const componentPath = path.join(rootDir, "src/components/HomeMascot.astro");
const assetDir = path.join(rootDir, "public/images/pet-mascot");
const poses = ["idle", "talking", "working", "confirm", "thinking"];

test("homepage mounts the approved mascot without replacing the hero sticker", async () => {
  const [homepage, component] = await Promise.all([
    readFile(homepagePath, "utf8"),
    readFile(componentPath, "utf8"),
  ]);

  assert.match(homepage, /import HomeMascot from "\.\.\/components\/HomeMascot\.astro"/);
  assert.match(homepage, /<HomeMascot\s*\/>/);
  assert.match(homepage, /data-hero-sticker/);
  assert.match(homepage, /\/images\/automail-sticker\.png/);
  assert.match(component, /data-home-mascot/);
  assert.match(component, /data-mascot-button/);
  assert.match(component, /home-mascot-bob/);
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.match(component, /setPose\(pose\)/);
  assert.match(component, /2600/);

  assert.match(component, /const poses = \["idle", "talking", "working", "confirm", "thinking"\]/);
  assert.match(component, /src=\{`\/images\/pet-mascot\/\$\{pose\}\.webp`\}/);
});

test("mascot frames are aligned RGBA assets with transparent corners", async () => {
  const metadata = await Promise.all(
    poses.map((pose) => sharp(path.join(assetDir, `${pose}.webp`)).metadata()),
  );

  for (const [index, item] of metadata.entries()) {
    assert.equal(item.format, "webp", poses[index]);
    assert.equal(item.width, 444, poses[index]);
    assert.equal(item.height, 542, poses[index]);
    assert.equal(item.hasAlpha, true, poses[index]);
  }

  const { data, info } = await sharp(path.join(assetDir, "idle.webp"))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.equal(data[3], 0, "idle top-left must be transparent");
  assert.equal(data[(info.width - 1) * 4 + 3], 0, "idle top-right must be transparent");
  assert.equal(data[((info.height - 1) * info.width + info.width - 1) * 4 + 3], 0, "idle bottom-right must be transparent");
});

#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const inputPath = path.resolve(process.argv[2] ?? "/private/tmp/pet-approved-masked.png");
const outputDir = path.resolve(
  process.argv[3] ?? path.join(rootDir, "public/images/pet-mascot"),
);

const states = ["idle", "talking", "working", "confirm", "thinking"];
const ALPHA_THRESHOLD = 8;
const MIN_COLUMN_HITS = 4;
const MERGE_GAP = 18;
const PAD_X = 14;
const PAD_TOP = 10;
const PAD_BOTTOM = 10;

const isNearWhite = (data, index) => {
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return red >= 238 && green >= 238 && blue >= 238 && max - min <= 18;
};

function removeConnectedWhiteFringe(data, width, height, channels) {
  const visited = new Uint8Array(width * height);
  const queue = [];

  const canTraverse = (pixelIndex) => {
    const dataIndex = pixelIndex * channels;
    return data[dataIndex + 3] < ALPHA_THRESHOLD || isNearWhite(data, dataIndex);
  };

  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixelIndex = y * width + x;
    if (visited[pixelIndex] || !canTraverse(pixelIndex)) return;
    visited[pixelIndex] = 1;
    queue.push(pixelIndex);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixelIndex = queue[cursor];
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const dataIndex = pixelIndex * channels;
    if (data[dataIndex + 3] >= ALPHA_THRESHOLD && isNearWhite(data, dataIndex)) {
      data[dataIndex + 3] = 0;
    }
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
    enqueue(x - 1, y - 1);
    enqueue(x + 1, y - 1);
    enqueue(x - 1, y + 1);
    enqueue(x + 1, y + 1);
  }

  for (let index = 0; index < data.length; index += channels) {
    if (data[index + 3] < ALPHA_THRESHOLD) data[index + 3] = 0;
  }
}

function findPoseSpans(data, width, height, channels) {
  const spans = [];
  let start = null;

  for (let x = 0; x <= width; x += 1) {
    let hits = 0;
    if (x < width) {
      for (let y = 0; y < height; y += 1) {
        if (data[(y * width + x) * channels + 3] >= ALPHA_THRESHOLD) hits += 1;
      }
    }

    if (hits >= MIN_COLUMN_HITS && start === null) {
      start = x;
    } else if (hits < MIN_COLUMN_HITS && start !== null) {
      spans.push([start, x - 1]);
      start = null;
    }
  }

  const merged = [];
  for (const span of spans) {
    if (merged.length > 0 && span[0] - merged.at(-1)[1] <= MERGE_GAP) {
      merged[merged.length - 1][1] = span[1];
    } else {
      merged.push([...span]);
    }
  }
  return merged;
}

function findContentBox(data, width, height, channels) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] < ALPHA_THRESHOLD) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) throw new Error("抠图结果为空");
  return { left, top, right, bottom };
}

function extractPose(data, sheetWidth, sheetHeight, channels, span) {
  const spanWidth = span[1] - span[0] + 1;
  const cropped = Buffer.alloc(spanWidth * sheetHeight * channels);

  for (let y = 0; y < sheetHeight; y += 1) {
    const sourceStart = (y * sheetWidth + span[0]) * channels;
    const targetStart = y * spanWidth * channels;
    data.copy(cropped, targetStart, sourceStart, sourceStart + spanWidth * channels);
  }

  const box = findContentBox(cropped, spanWidth, sheetHeight, channels);
  const contentWidth = box.right - box.left + 1;
  const contentHeight = box.bottom - box.top + 1;
  const content = Buffer.alloc(contentWidth * contentHeight * channels);

  for (let y = 0; y < contentHeight; y += 1) {
    const sourceStart = ((box.top + y) * spanWidth + box.left) * channels;
    const targetStart = y * contentWidth * channels;
    cropped.copy(content, targetStart, sourceStart, sourceStart + contentWidth * channels);
  }

  return { content, width: contentWidth, height: contentHeight };
}

function placePose(pose, canvasWidth, canvasHeight) {
  const canvas = Buffer.alloc(canvasWidth * canvasHeight * 4);
  const x = Math.floor((canvasWidth - pose.width) / 2);
  const y = canvasHeight - PAD_BOTTOM - pose.height;

  for (let row = 0; row < pose.height; row += 1) {
    const sourceStart = row * pose.width * 4;
    const targetStart = ((y + row) * canvasWidth + x) * 4;
    pose.content.copy(canvas, targetStart, sourceStart, sourceStart + pose.width * 4);
  }

  return { canvas, width: canvasWidth, height: canvasHeight };
}

async function writeRgbaPng(buffer, width, height, outputPath) {
  await sharp(buffer, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(outputPath);
}

async function writeRgbaWebp(buffer, width, height, outputPath) {
  await sharp(buffer, { raw: { width, height, channels: 4 } })
    .webp({ quality: 88, alphaQuality: 100 })
    .toFile(outputPath);
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const { data: raw, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const data = Buffer.from(raw);
  const channels = info.channels;

  removeConnectedWhiteFringe(data, info.width, info.height, channels);
  const spans = findPoseSpans(data, info.width, info.height, channels);
  if (spans.length !== states.length) {
    throw new Error(`期望 ${states.length} 个姿势，实际定位到 ${spans.length} 个: ${JSON.stringify(spans)}`);
  }

  const poses = spans.map((span) => extractPose(data, info.width, info.height, channels, span));
  const canvasWidth = Math.max(...poses.map((pose) => pose.width)) + PAD_X * 2;
  const canvasHeight = Math.max(...poses.map((pose) => pose.height)) + PAD_TOP + PAD_BOTTOM;
  const frames = poses.map((pose) => placePose(pose, canvasWidth, canvasHeight));

  const sheet = Buffer.alloc(canvasWidth * states.length * canvasHeight * 4);
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    for (let row = 0; row < canvasHeight; row += 1) {
      const sourceStart = row * canvasWidth * 4;
      const targetStart = (row * canvasWidth * states.length + index * canvasWidth) * 4;
      frame.canvas.copy(sheet, targetStart, sourceStart, sourceStart + canvasWidth * 4);
    }
  }

  await writeRgbaPng(
    sheet,
    canvasWidth * states.length,
    canvasHeight,
    path.join(outputDir, "sheet.png"),
  );
  await writeRgbaWebp(
    sheet,
    canvasWidth * states.length,
    canvasHeight,
    path.join(outputDir, "sheet.webp"),
  );
  for (const [index, state] of states.entries()) {
    await writeRgbaPng(frames[index].canvas, canvasWidth, canvasHeight, path.join(outputDir, `${state}.png`));
    await writeRgbaWebp(frames[index].canvas, canvasWidth, canvasHeight, path.join(outputDir, `${state}.webp`));
  }

  console.log(`输入: ${inputPath}`);
  console.log(`姿势区间: ${JSON.stringify(spans)}`);
  console.log(`统一画布: ${canvasWidth}x${canvasHeight}`);
  console.log(`输出: ${outputDir}`);
}

await main();

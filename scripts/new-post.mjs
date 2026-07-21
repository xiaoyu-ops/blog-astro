#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const titleArg = args.shift();

if (!titleArg) {
  console.error('Usage: pnpm post:new "Post title" [slug] [--description "One sentence"] [--publish]');
  process.exit(1);
}

let slugArg;
if (args[0] && !args[0].startsWith("--")) {
  slugArg = args.shift();
}

let description = "TODO: 补充一句话摘要";
let hasDescription = false;
let draft = true;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];

  if (arg === "--description") {
    description = args[i + 1]?.trim();
    hasDescription = true;
    i += 1;
    continue;
  }

  if (arg === "--publish") {
    draft = false;
    continue;
  }

  if (arg === "--draft") {
    draft = true;
    continue;
  }

  console.error(`Unknown option: ${arg}`);
  process.exit(1);
}

if (!description) {
  console.error("Description cannot be empty.");
  process.exit(1);
}

if (!draft && !hasDescription) {
  console.error('Published posts need --description "One sentence".');
  process.exit(1);
}

const now = new Date();
const today = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
].join("-");

const slugify = (value) => {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "post";
};

const title = titleArg.trim();
const slug = slugify(slugArg ?? title);
const postId = `${today}-${slug}`;
const postsDir = path.join(process.cwd(), "src", "content", "blog");
const postPath = path.join(postsDir, `${postId}.md`);
const imagesDir = path.join(postsDir, "images", postId);

if (existsSync(postPath)) {
  console.error(`Post already exists: ${postPath}`);
  process.exit(1);
}

const content = `---
title: ${JSON.stringify(title)}
description: ${JSON.stringify(description)}
date: "${today}"
draft: ${draft}
tags: []
---

# ${title}

`;

await mkdir(postsDir, { recursive: true });
await mkdir(imagesDir, { recursive: true });
await writeFile(postPath, content, "utf8");

console.log(`Created ${path.relative(process.cwd(), postPath)}`);
console.log(`Images  ${path.relative(process.cwd(), imagesDir)}/`);
console.log("");
console.log("Add an image in Markdown:");
console.log(`![图片说明](./images/${postId}/example.webp)`);
console.log("");
console.log(`Preview: pnpm dev, then open /blog/${postId}`);
if (draft) {
  console.log(`Publish: pnpm post:publish ${postId}`);
}
console.log("Guide:   src/content/README.md");

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const query = process.argv[2]?.replace(/\.(md|mdx)$/i, "");

if (!query) {
  console.error("Usage: pnpm post:publish <post-id>");
  process.exit(1);
}

const root = process.cwd();
const postsDir = path.join(root, "src", "content", "blog");
const entries = await readdir(postsDir, { withFileTypes: true });
const posts = entries
  .filter((entry) => entry.isFile() && /\.(md|mdx)$/i.test(entry.name))
  .map((entry) => ({ name: entry.name, id: entry.name.replace(/\.(md|mdx)$/i, "") }));

const exact = posts.find((post) => post.id === query);
const matches = exact ? [exact] : posts.filter((post) => post.id.includes(query));

if (matches.length === 0) {
  console.error(`Post not found: ${query}`);
  process.exit(1);
}

if (matches.length > 1) {
  console.error(`More than one post matches "${query}":`);
  for (const post of matches) console.error(`  ${post.id}`);
  process.exit(1);
}

const post = matches[0];
const postPath = path.join(postsDir, post.name);
let source = await readFile(postPath, "utf8");
const originalSource = source;

if (/^description:\s*["']?TODO/m.test(source)) {
  console.error("Replace the TODO description before publishing.");
  process.exit(1);
}

const wasDraft = /^draft:\s*true\s*$/m.test(source);

if (wasDraft) {
  source = source.replace(/^draft:\s*true\s*$/m, "draft: false");
  await writeFile(postPath, source, "utf8");
  console.log(`Marked ${post.id} as published.`);
} else {
  console.log(`${post.id} is already marked as published.`);
}

console.log("Running production build...");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpm, ["build"], { cwd: root, stdio: "inherit" });

if (result.status !== 0) {
  if (wasDraft) {
    await writeFile(postPath, originalSource, "utf8");
    console.error("Build failed, so the post was restored to draft mode.");
  }
  console.error("Build failed. Fix the error before pushing.");
  process.exit(result.status ?? 1);
}

console.log("");
console.log("Ready to publish:");
console.log("  git add src/content/blog");
console.log(`  git commit -m ${JSON.stringify(`publish: ${post.id}`)}`);
console.log("  git push");

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const dist = path.join(root, "dist");
const config = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
const csp = config.headers?.flatMap((entry) => entry.headers ?? []).find((entry) => entry.key.toLowerCase() === "content-security-policy")?.value ?? "";
if (!csp) throw new Error("build validation: missing Content-Security-Policy");
const htmlFiles = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.name.endsWith(".html")) htmlFiles.push(full);
  }
}
await walk(dist);
if (!htmlFiles.length) throw new Error("build validation: dist contains no HTML");
for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  if (/waust\.at|_waubmap|\/lab-status\/?|\/api\/lab2\/status/.test(html)) throw new Error(`build validation: retired monitoring or third-party reference in ${path.relative(dist, file)}`);
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const hash = `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`;
    if (!csp.includes(hash)) throw new Error(`build validation: inline script hash missing for ${path.relative(dist, file)}`);
  }
}
console.log(`build validation: ${htmlFiles.length} HTML files passed CSP and retired-reference checks`);

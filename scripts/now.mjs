#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dataPath = path.join(process.cwd(), "src", "data", "now.json");
const [command = "list", id, ...rawArgs] = process.argv.slice(2);

const usage = `Usage:
  pnpm now:list
  pnpm now:add <id> --title "中文标题" --title-en "English title" --deadline YYYY-MM-DD [--start YYYY-MM-DD] [--blog /blog/slug]
  pnpm now:update <id> [--title "..."] [--title-en "..."] [--deadline YYYY-MM-DD|none] [--start YYYY-MM-DD] [--blog URL|none]
  pnpm now:complete <id> [--date YYYY-MM-DD] [--blog /blog/slug]
  pnpm now:reopen <id>`;

const today = () => {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
};

const parseFlags = (args) => {
  const flags = new Map();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid option near ${flag ?? "(empty)"}.\n\n${usage}`);
    }
    flags.set(flag.slice(2), value.trim());
  }

  return flags;
};

const isDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

const requireDate = (value, label) => {
  if (!isDate(value)) throw new Error(`${label} must use a valid YYYY-MM-DD date.`);
  return value;
};

const optionalValue = (value) => value === "none" ? null : value;

const loadItems = async () => JSON.parse(await readFile(dataPath, "utf8"));
const saveItems = async (items) => {
  await writeFile(dataPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
};

const validateItem = (item) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) {
    throw new Error(`Invalid id "${item.id}". Use lowercase letters, numbers, and hyphens.`);
  }
  if (!item.titleZh?.trim() || !item.titleEn?.trim()) {
    throw new Error(`${item.id} needs both Chinese and English titles.`);
  }
  requireDate(item.startedAt, `${item.id} startedAt`);
  if (item.deadline) {
    requireDate(item.deadline, `${item.id} deadline`);
    if (item.deadline < item.startedAt) {
      throw new Error(`${item.id} deadline cannot be earlier than startedAt.`);
    }
  }
  if (item.completedAt) requireDate(item.completedAt, `${item.id} completedAt`);
};

try {
  const items = await loadItems();

  if (command === "list") {
    console.table(items.map(({ id: itemId, titleZh, startedAt, deadline, completedAt }) => ({
      id: itemId,
      title: titleZh,
      start: startedAt,
      deadline: deadline ?? "待设置",
      status: completedAt ? `已完成 ${completedAt}` : "进行中",
    })));
    process.exit(0);
  }

  if (!id) throw new Error(usage);
  const flags = parseFlags(rawArgs);
  const itemIndex = items.findIndex((item) => item.id === id);

  if (command === "add") {
    if (itemIndex >= 0) throw new Error(`Item already exists: ${id}`);
    const titleZh = flags.get("title");
    const titleEn = flags.get("title-en");
    const deadline = flags.get("deadline");
    if (!titleZh || !titleEn || !deadline) throw new Error(usage);

    const item = {
      id,
      titleZh,
      titleEn,
      startedAt: requireDate(flags.get("start") ?? today(), "start"),
      deadline: requireDate(deadline, "deadline"),
      completedAt: null,
      blogUrl: optionalValue(flags.get("blog") ?? "none"),
    };
    validateItem(item);
    items.push(item);
  } else {
    if (itemIndex < 0) throw new Error(`Item not found: ${id}`);
    const item = items[itemIndex];

    if (command === "update") {
      if (flags.has("title")) item.titleZh = flags.get("title");
      if (flags.has("title-en")) item.titleEn = flags.get("title-en");
      if (flags.has("start")) item.startedAt = requireDate(flags.get("start"), "start");
      if (flags.has("deadline")) {
        const deadline = optionalValue(flags.get("deadline"));
        item.deadline = deadline ? requireDate(deadline, "deadline") : null;
      }
      if (flags.has("blog")) item.blogUrl = optionalValue(flags.get("blog"));
    } else if (command === "complete") {
      item.completedAt = requireDate(flags.get("date") ?? today(), "date");
      if (flags.has("blog")) item.blogUrl = flags.get("blog");
    } else if (command === "reopen") {
      item.completedAt = null;
    } else {
      throw new Error(usage);
    }

    validateItem(item);
  }

  for (const item of items) validateItem(item);
  await saveItems(items);
  console.log(`Updated ${path.relative(process.cwd(), dataPath)}.`);
  console.log("Preview with pnpm dev, then run pnpm test and pnpm build before pushing.");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

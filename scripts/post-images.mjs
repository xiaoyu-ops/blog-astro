import { access, realpath, rename } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const formatExtensions = {
  avif: ".avif",
  gif: ".gif",
  jpeg: ".jpg",
  png: ".png",
  tiff: ".tiff",
  webp: ".webp",
};

const imagePattern = /!\[[^\]\n]*\]\(([^)\n]+)\)/g;
const inlineCodeImagePattern = /^(\s*)`(!\[[^\]\n]*\]\([^)\n]+\))`\s*$/;

const getImagePath = (destination) => {
  const trimmed = destination.trim();

  if (trimmed.startsWith("<")) {
    const closingBracket = trimmed.indexOf(">");
    return closingBracket === -1 ? trimmed : trimmed.slice(1, closingBracket);
  }

  return trimmed.split(/\s+/)[0];
};

const isLocalImage = (imagePath) =>
  !imagePath.startsWith("/") &&
  !imagePath.startsWith("data:") &&
  !imagePath.startsWith("http://") &&
  !imagePath.startsWith("https://");

export async function preparePostImages(source, postPath, logger = console) {
  const lines = source.split("\n");
  const references = new Set();
  let inCodeFence = false;
  let fixedMarkdown = 0;
  let fixedExtensions = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) continue;

    const inlineCodeMatch = line.match(inlineCodeImagePattern);
    if (inlineCodeMatch) {
      lines[index] = `${inlineCodeMatch[1]}${inlineCodeMatch[2]}`;
      fixedMarkdown += 1;
      logger.log("Fixed an image that was wrapped in backticks.");
    }

    for (const match of lines[index].matchAll(imagePattern)) {
      const imagePath = getImagePath(match[1]);
      if (isLocalImage(imagePath)) references.add(imagePath);
    }
  }

  const postDir = path.dirname(postPath);
  const mediaRoot = await realpath(postDir);
  const isContained = (candidate) =>
    candidate === mediaRoot || candidate.startsWith(`${mediaRoot}${path.sep}`);

  for (const imagePath of references) {
    const absolutePath = path.resolve(postDir, imagePath);

    try {
      await access(absolutePath);
    } catch {
      throw new Error(`Image not found: ${imagePath}`);
    }

    let sourceRealPath;
    try {
      sourceRealPath = await realpath(absolutePath);
    } catch {
      throw new Error(`Image cannot be resolved: ${imagePath}`);
    }
    if (!isContained(sourceRealPath)) {
      throw new Error(`Image path escapes the post media directory: ${imagePath}`);
    }

    let metadata;
    try {
      metadata = await sharp(absolutePath).metadata();
    } catch {
      throw new Error(`Image cannot be read: ${imagePath}`);
    }

    const expectedExtension = formatExtensions[metadata.format];
    if (!expectedExtension) continue;

    const currentExtension = path.extname(absolutePath).toLowerCase();
    if (currentExtension === expectedExtension) continue;

    const correctedPath = currentExtension
      ? `${absolutePath.slice(0, -currentExtension.length)}${expectedExtension}`
      : `${absolutePath}${expectedExtension}`;

    const correctedParent = await realpath(path.dirname(correctedPath));
    if (!isContained(correctedParent)) {
      throw new Error(`Image target escapes the post media directory: ${imagePath}`);
    }

    try {
      await access(correctedPath);
      throw new Error(`Cannot rename image because the target already exists: ${correctedPath}`);
    } catch (error) {
      if (error.message.startsWith("Cannot rename")) throw error;
    }

    await rename(absolutePath, correctedPath);

    let correctedReference = path.relative(postDir, correctedPath).split(path.sep).join("/");
    if (imagePath.startsWith("./")) correctedReference = `./${correctedReference}`;

    for (let index = 0; index < lines.length; index += 1) {
      lines[index] = lines[index].replaceAll(imagePath, correctedReference);
    }

    fixedExtensions += 1;
    logger.log(`Corrected image extension: ${imagePath} -> ${correctedReference}`);
  }

  return {
    source: lines.join("\n"),
    fixedMarkdown,
    fixedExtensions,
  };
}

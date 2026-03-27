/**
 * context.js — helpers for loading and listing context JSON files.
 *
 * A "context" is a named preset that shapes how the image generation prompt
 * is built and which default model parameters are used.  Each context lives
 * in the top-level /contexts directory as a .json file.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the /contexts directory relative to this source file so the code
// works regardless of where the process was started from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contextsDir = path.resolve(__dirname, "../../contexts");

/**
 * Load a single context by name.
 *
 * @param {string} name  The base filename without the .json extension,
 *                       e.g. "default" loads contexts/default.json.
 * @returns {object}     Parsed context object.
 * @throws               If the file doesn't exist or can't be parsed.
 */
export function loadContext(name) {
  const filePath = path.join(contextsDir, `${name}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Context "${name}" not found. ` +
        `Available contexts: ${listContextFileNames().join(", ")}`,
    );
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse context "${name}": ${err.message}`);
  }
}

/**
 * List all available contexts.
 *
 * @returns {{ name: string, description: string }[]}
 */
export function listContexts() {
  return listContextFileNames().map((filename) => {
    const filePath = path.join(contextsDir, filename);
    try {
      const ctx = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return { name: ctx.name ?? filename.replace(".json", ""), description: ctx.description ?? "" };
    } catch {
      // If a file is malformed, surface it with a warning rather than crashing.
      return { name: filename.replace(".json", ""), description: "(could not parse file)" };
    }
  });
}

/**
 * Build a final prompt string by combining a context's style fields with the
 * user-supplied prompt.  Fields that are empty strings are silently skipped so
 * the prompt stays clean when a context doesn't use them.
 *
 * Resulting format (non-empty parts only):
 *   "<styleGuide>  <userPrompt>  Output format: <outputFormat>.  Avoid: <negativePrompt>"
 *
 * @param {string} userPrompt
 * @param {object|null} ctx  Parsed context object, or null to use prompt as-is.
 * @returns {string}
 */
export function buildPrompt(userPrompt, ctx) {
  if (!ctx) return userPrompt;

  const parts = [];

  if (ctx.styleGuide) parts.push(ctx.styleGuide);
  parts.push(userPrompt);
  if (ctx.outputFormat) parts.push(`Output format: ${ctx.outputFormat}.`);
  if (ctx.negativePrompt) parts.push(`Avoid: ${ctx.negativePrompt}`);

  return parts.join("  ");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function listContextFileNames() {
  if (!fs.existsSync(contextsDir)) return [];
  return fs.readdirSync(contextsDir).filter((f) => f.endsWith(".json"));
}

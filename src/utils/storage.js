/**
 * storage.js — saves generated images to disk.
 *
 * All outputs land in the top-level /outputs directory.
 * Filenames follow the pattern:  YYYY-MM-DD_HH-MM-SS_<contextName>.png
 * so they sort chronologically in any file browser.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the /outputs directory relative to this source file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputsDir = path.resolve(__dirname, "../../outputs");

/**
 * Write a Buffer containing raw PNG bytes to disk and return the absolute path.
 *
 * @param {Buffer} imageBuffer    Raw image bytes (decoded from base64).
 * @param {string} [contextName]  Used as a suffix in the filename for easy
 *                                identification.  Defaults to "default".
 * @returns {string}              Absolute path of the saved file.
 */
export function saveImage(imageBuffer, contextName = "default") {
  // Build a timestamp string:  "2025-03-27T14-05-30" → "2025-03-27_14-05-30"
  // We replace colons (invalid in filenames on some OSes) and the T separator.
  const timestamp = new Date()
    .toISOString()          // "2025-03-27T14:05:30.123Z"
    .slice(0, 19)           // "2025-03-27T14:05:30"
    .replace("T", "_")      // "2025-03-27_14:05:30"
    .replaceAll(":", "-");  // "2025-03-27_14-05-30"

  // Sanitise the context name so it's safe to use in a filename.
  const safeName = contextName.replace(/[^a-zA-Z0-9_-]/g, "_");

  const filename = `${timestamp}_${safeName}.png`;
  const filePath = path.join(outputsDir, filename);

  // Ensure the outputs directory exists (idempotent).
  fs.mkdirSync(outputsDir, { recursive: true });

  fs.writeFileSync(filePath, imageBuffer);

  return filePath;
}

/**
 * storage.js — saves generated images to disk.
 *
 * Filenames follow the pattern:  YYYY-MM-DD_HH-MM-SS_<contextName>.webp
 * so they sort chronologically in any file browser.
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

/**
 * Convert a PNG buffer to WebP and write it to disk, returning the absolute path.
 *
 * @param {Buffer} imageBuffer    Raw image bytes (decoded from base64).
 * @param {string} [contextName]  Used as a suffix in the filename for easy
 *                                identification.  Defaults to "default".
 * @param {string} [outputDir]    Directory to save the file.  Defaults to the
 *                                process current working directory.
 * @returns {Promise<string>}     Absolute path of the saved file.
 */
export async function saveImage(imageBuffer, contextName = "default", outputDir = process.cwd()) {
  // Build a timestamp string:  "2025-03-27T14-05-30" → "2025-03-27_14-05-30"
  // We replace colons (invalid in filenames on some OSes) and the T separator.
  const timestamp = new Date()
    .toISOString()          // "2025-03-27T14:05:30.123Z"
    .slice(0, 19)           // "2025-03-27T14:05:30"
    .replace("T", "_")      // "2025-03-27_14:05:30"
    .replaceAll(":", "-");  // "2025-03-27_14-05-30"

  // Sanitise the context name so it's safe to use in a filename.
  const safeName = contextName.replace(/[^a-zA-Z0-9_-]/g, "_");

  const filename = `${timestamp}_${safeName}.webp`;
  const filePath = path.join(outputDir, filename);

  // Ensure the output directory exists (idempotent).
  fs.mkdirSync(outputDir, { recursive: true });

  const webpBuffer = await sharp(imageBuffer).webp({ quality: 85 }).toBuffer();
  fs.writeFileSync(filePath, webpBuffer);

  return filePath;
}

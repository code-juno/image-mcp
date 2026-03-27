/**
 * Unit tests for src/utils/storage.js
 *
 * Tests cover:
 *  - Return value is an absolute .png path
 *  - Filename matches YYYY-MM-DD_HH-MM-SS_<contextName>.png
 *  - File is actually written to disk with the correct contents
 *  - Special characters in contextName are sanitized
 *  - outputs/ directory is auto-created if it does not exist
 *
 * All test files are cleaned up after the suite runs.
 */

import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { saveImage } from "../src/utils/storage.js";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const outputsDir = path.resolve(__dirname, "../outputs");

// Track every file written by tests so we can delete them afterwards.
const writtenFiles = [];

after(() => {
  for (const f of writtenFiles) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
});

const FAKE_BUFFER = Buffer.from("fake-png-bytes-for-testing");

describe("saveImage", () => {
  test("returns an absolute path", () => {
    const result = saveImage(FAKE_BUFFER, "test");
    writtenFiles.push(result);
    assert.ok(path.isAbsolute(result), `expected absolute path, got: ${result}`);
  });

  test("returned path ends with .png", () => {
    const result = saveImage(FAKE_BUFFER, "test");
    writtenFiles.push(result);
    assert.ok(result.endsWith(".png"), `expected .png extension, got: ${result}`);
  });

  test("filename matches YYYY-MM-DD_HH-MM-SS_<name>.png", () => {
    const result = saveImage(FAKE_BUFFER, "mycontext");
    writtenFiles.push(result);
    const basename = path.basename(result);
    assert.match(
      basename,
      /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_mycontext\.png$/,
      `filename did not match expected pattern: ${basename}`,
    );
  });

  test("file is written to disk", () => {
    const result = saveImage(FAKE_BUFFER, "diskcheck");
    writtenFiles.push(result);
    assert.ok(fs.existsSync(result), `expected file to exist at: ${result}`);
  });

  test("file contents exactly match the buffer passed in", () => {
    const buf    = Buffer.from("exact-content-0123456789");
    const result = saveImage(buf, "contentcheck");
    writtenFiles.push(result);
    const written = fs.readFileSync(result);
    assert.deepEqual(written, buf);
  });

  test("file is saved inside the outputs/ directory", () => {
    const result = saveImage(FAKE_BUFFER, "dircheck");
    writtenFiles.push(result);
    assert.equal(path.dirname(result), outputsDir);
  });

  test("sanitizes forward slashes in context name", () => {
    const result = saveImage(FAKE_BUFFER, "my/context");
    writtenFiles.push(result);
    const basename = path.basename(result);
    assert.ok(!basename.includes("/"), `basename should not contain '/': ${basename}`);
    assert.ok(basename.includes("my_context"), `expected 'my_context' in: ${basename}`);
  });

  test("sanitizes colons in context name", () => {
    const result = saveImage(FAKE_BUFFER, "foo:bar");
    writtenFiles.push(result);
    const basename = path.basename(result);
    assert.ok(!basename.includes(":"), `basename should not contain ':': ${basename}`);
  });

  test("sanitizes spaces in context name", () => {
    const result = saveImage(FAKE_BUFFER, "hello world");
    writtenFiles.push(result);
    const basename = path.basename(result);
    assert.ok(!basename.includes(" "), `basename should not contain spaces: ${basename}`);
  });

  test("defaults contextName to 'default' when omitted", () => {
    const result = saveImage(FAKE_BUFFER);
    writtenFiles.push(result);
    const basename = path.basename(result);
    assert.ok(basename.endsWith("_default.png"), `expected '_default.png' suffix, got: ${basename}`);
  });

  test("auto-creates outputs/ directory if it does not exist", () => {
    // Rename the directory away, run saveImage, then restore it.
    const backup = outputsDir + "_bak_" + Date.now();
    if (fs.existsSync(outputsDir)) {
      fs.renameSync(outputsDir, backup);
    }

    let result;
    try {
      result = saveImage(FAKE_BUFFER, "recreate");
      assert.ok(fs.existsSync(result), "file should be created even when outputs/ was absent");
    } finally {
      // Move the newly-created file into the backup, then restore backup as outputs/
      if (result && fs.existsSync(result)) {
        writtenFiles.push(result); // register for later cleanup
        const newOutputsDir = path.dirname(result); // should be the recreated outputs/
        // move every file from the recreated dir into backup
        for (const f of fs.readdirSync(newOutputsDir)) {
          fs.renameSync(path.join(newOutputsDir, f), path.join(backup, f));
        }
        fs.rmdirSync(newOutputsDir);
      }
      if (fs.existsSync(backup)) {
        fs.renameSync(backup, outputsDir);
      }
    }
  });
});

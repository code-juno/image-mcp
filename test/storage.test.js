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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  test("defaults to process.cwd() when no outputDir is given", () => {
    const result = saveImage(FAKE_BUFFER, "dircheck");
    writtenFiles.push(result);
    assert.equal(path.dirname(result), process.cwd());
  });

  test("saves to a custom outputDir when provided", () => {
    const customDir = path.resolve(__dirname, "../outputs/_test_custom_dir");
    const result = saveImage(FAKE_BUFFER, "customdir", customDir);
    assert.equal(path.dirname(result), customDir);
    fs.rmSync(customDir, { recursive: true, force: true });
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

  test("auto-creates outputDir if it does not exist", () => {
    const newDir = path.resolve(__dirname, "../outputs/_test_autocreate_" + Date.now());
    assert.ok(!fs.existsSync(newDir), "precondition: dir should not exist yet");
    const result = saveImage(FAKE_BUFFER, "recreate", newDir);
    writtenFiles.push(result);
    assert.ok(fs.existsSync(result), "file should be created even when outputDir was absent");
    fs.rmSync(newDir, { recursive: true, force: true });
  });
});

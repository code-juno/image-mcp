/**
 * Unit tests for src/utils/context.js
 *
 * Tests cover:
 *  - buildPrompt: all field combinations, empty-field skipping, join order
 *  - loadContext: happy path, missing file, malformed JSON, error message content
 *  - listContexts: normal listing, malformed file handling, name-field fallback
 *
 * Tests that need a temporary context file write it into /contexts with a
 * "_test_" prefix and clean up in after() hooks.
 */

import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPrompt, loadContext, listContexts } from "../src/utils/context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contextsDir = path.resolve(__dirname, "../contexts");

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
  test("returns prompt unchanged when ctx is null", () => {
    assert.equal(buildPrompt("a red barn", null), "a red barn");
  });

  test("returns prompt unchanged when ctx is null and prompt has whitespace", () => {
    assert.equal(buildPrompt("  hello  ", null), "  hello  ");
  });

  test("prepends non-empty styleGuide before the user prompt", () => {
    const ctx = { styleGuide: "Oil painting", outputFormat: "", negativePrompt: "" };
    const result = buildPrompt("a cat", ctx);
    const idx = result.indexOf("Oil painting");
    const idx2 = result.indexOf("a cat");
    assert.ok(idx !== -1, "styleGuide missing from result");
    assert.ok(idx < idx2, "styleGuide should come before the user prompt");
  });

  test("skips empty styleGuide — prompt is first in result", () => {
    const ctx = { styleGuide: "", outputFormat: "PNG", negativePrompt: "" };
    const result = buildPrompt("a cat", ctx);
    assert.ok(result.startsWith("a cat"), `expected result to start with user prompt, got: ${result}`);
  });

  test("appends outputFormat when present", () => {
    const ctx = { styleGuide: "", outputFormat: "PNG", negativePrompt: "" };
    const result = buildPrompt("a cat", ctx);
    assert.ok(result.includes("Output format: PNG."), `expected 'Output format: PNG.' in: ${result}`);
  });

  test("appends negativePrompt when present", () => {
    const ctx = { styleGuide: "", outputFormat: "", negativePrompt: "blurry, dark" };
    const result = buildPrompt("a cat", ctx);
    assert.ok(result.includes("Avoid: blurry, dark"), `expected 'Avoid: blurry, dark' in: ${result}`);
  });

  test("all-empty ctx fields — result is just the user prompt", () => {
    const ctx = { styleGuide: "", outputFormat: "", negativePrompt: "" };
    const result = buildPrompt("a cat", ctx);
    assert.equal(result, "a cat");
  });

  test("all non-empty fields appear in correct order", () => {
    const ctx = {
      styleGuide: "STYLE",
      outputFormat: "FORMAT",
      negativePrompt: "AVOID",
    };
    const result = buildPrompt("PROMPT", ctx);
    const styleIdx  = result.indexOf("STYLE");
    const promptIdx = result.indexOf("PROMPT");
    const formatIdx = result.indexOf("Output format: FORMAT.");
    const avoidIdx  = result.indexOf("Avoid: AVOID");
    assert.ok(styleIdx  < promptIdx, "styleGuide should precede prompt");
    assert.ok(promptIdx < formatIdx, "prompt should precede outputFormat");
    assert.ok(formatIdx < avoidIdx,  "outputFormat should precede negativePrompt");
  });

  test("ctx with only styleGuide set — result contains style + prompt", () => {
    const ctx = { styleGuide: "STYLE", outputFormat: "", negativePrompt: "" };
    const result = buildPrompt("PROMPT", ctx);
    assert.ok(result.includes("STYLE"));
    assert.ok(result.includes("PROMPT"));
    assert.ok(!result.includes("Output format:"));
    assert.ok(!result.includes("Avoid:"));
  });
});

// ---------------------------------------------------------------------------
// loadContext
// ---------------------------------------------------------------------------

describe("loadContext", () => {
  let tempFiles = [];

  after(() => {
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch { /* already gone */ }
    }
  });

  test("loads the real default context successfully", () => {
    const ctx = loadContext("default");
    assert.equal(typeof ctx, "object");
    assert.equal(ctx.name, "default");
    assert.ok("quality" in ctx, "context should have a quality field");
    assert.ok("size"    in ctx, "context should have a size field");
  });

  test("throws for a non-existent context name", () => {
    assert.throws(
      () => loadContext("_does_not_exist_xyz"),
      /Context "_does_not_exist_xyz" not found/,
    );
  });

  test("error message for missing context lists available contexts", () => {
    assert.throws(
      () => loadContext("_does_not_exist_xyz"),
      /Available contexts:/,
    );
  });

  test("error message for missing context includes 'default' in the available list", () => {
    let caught;
    try { loadContext("_does_not_exist_xyz"); } catch (e) { caught = e; }
    assert.ok(caught, "expected an error to be thrown");
    assert.ok(caught.message.includes("default"), `expected 'default' in error: ${caught.message}`);
  });

  test("throws for malformed JSON in a context file", () => {
    const badPath = path.join(contextsDir, "_test_bad_json.json");
    fs.writeFileSync(badPath, "{ this is not valid json }");
    tempFiles.push(badPath);
    assert.throws(
      () => loadContext("_test_bad_json"),
      /Failed to parse context "_test_bad_json"/,
    );
  });

  test("successfully loads a custom context file", () => {
    const customCtx = { name: "_test_custom", description: "test ctx", quality: "low", size: "1024x1024" };
    const customPath = path.join(contextsDir, "_test_custom.json");
    fs.writeFileSync(customPath, JSON.stringify(customCtx));
    tempFiles.push(customPath);
    const loaded = loadContext("_test_custom");
    assert.equal(loaded.name, "_test_custom");
    assert.equal(loaded.quality, "low");
  });
});

// ---------------------------------------------------------------------------
// listContexts
// ---------------------------------------------------------------------------

describe("listContexts", () => {
  let tempFiles = [];

  after(() => {
    for (const f of tempFiles) {
      try { fs.unlinkSync(f); } catch { /* already gone */ }
    }
  });

  test("returns an array", () => {
    assert.ok(Array.isArray(listContexts()));
  });

  test("default context appears in the list", () => {
    const contexts = listContexts();
    assert.ok(contexts.some(c => c.name === "default"), "default context should be in the list");
  });

  test("every entry has name and description fields", () => {
    const contexts = listContexts();
    for (const c of contexts) {
      assert.ok("name"        in c, "entry missing 'name'");
      assert.ok("description" in c, "entry missing 'description'");
    }
  });

  test("malformed JSON file appears in list with warning description", () => {
    const badPath = path.join(contextsDir, "_test_malformed.json");
    fs.writeFileSync(badPath, "not json at all !!!");
    tempFiles.push(badPath);

    const contexts = listContexts();
    const entry = contexts.find(c => c.name === "_test_malformed");
    assert.ok(entry, "malformed file should still appear in list");
    assert.equal(entry.description, "(could not parse file)");
  });

  test("malformed JSON file does not prevent other valid contexts from listing", () => {
    const badPath = path.join(contextsDir, "_test_malformed2.json");
    fs.writeFileSync(badPath, "{ bad }");
    tempFiles.push(badPath);

    const contexts = listContexts();
    assert.ok(contexts.some(c => c.name === "default"), "default should still appear alongside malformed file");
  });

  test("context without a name field falls back to its filename", () => {
    const noNamePath = path.join(contextsDir, "_test_noname.json");
    fs.writeFileSync(noNamePath, JSON.stringify({ description: "no name here" }));
    tempFiles.push(noNamePath);

    const contexts = listContexts();
    const entry = contexts.find(c => c.name === "_test_noname");
    assert.ok(entry, "should appear using filename (without .json) as name");
  });

  test("context without a description field shows empty string", () => {
    const noDescPath = path.join(contextsDir, "_test_nodesc.json");
    fs.writeFileSync(noDescPath, JSON.stringify({ name: "_test_nodesc" }));
    tempFiles.push(noDescPath);

    const contexts = listContexts();
    const entry = contexts.find(c => c.name === "_test_nodesc");
    assert.ok(entry, "context without description should appear");
    assert.equal(entry.description, "");
  });
});

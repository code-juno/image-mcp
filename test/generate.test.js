/**
 * Tool handler tests for src/tools/generate.js
 *
 * The OpenAI client is replaced by a lightweight mock so no API calls are
 * made and no credits are spent.  The McpServer is replaced by a minimal
 * shim that captures the registered handler and lets us invoke it directly.
 *
 * Tests cover:
 *  - Happy path: file is written, path returned
 *  - Context defaults are applied when context param is given
 *  - Explicit args override context defaults
 *  - Bad context name → error text, no file written
 *  - OpenAI throws → error text, no file written
 *  - Missing b64_json in response → error text
 *  - Hard-coded fallback defaults (quality=medium, size=1024x1024, background=opaque)
 *  - Prompt is shaped by context fields (outputFormat present in sent prompt)
 *  - Context with referenceImages → routes to images.edit(), not images.generate()
 *  - Context with referenceImages → reference image files passed to edit call
 *  - Context with missing referenceImages → error text, no file written
 */

import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { registerGenerateTool } from "../src/tools/generate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal 1×1 transparent PNG encoded as base64 — valid enough for Buffer.from.
const FAKE_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// Track files created during tests so we can clean them up afterwards.
const writtenFiles = [];

after(() => {
  for (const f of writtenFiles) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a mock server + a call() helper that invokes a registered handler. */
function makeServer() {
  const handlers = {};
  const server = {
    registerTool: (name, _schema, handler) => { handlers[name] = handler; },
  };
  return { server, call: (name, args) => handlers[name](args) };
}

/** Returns a mock OpenAI client with successful images.generate and images.edit stubs. */
function makeOpenAI(generateFn, editFn) {
  return {
    images: {
      generate: generateFn ?? (async () => ({ data: [{ b64_json: FAKE_B64 }] })),
      edit:     editFn     ?? (async () => ({ data: [{ b64_json: FAKE_B64 }] })),
    },
  };
}

/** Extract the saved path from a successful tool response. */
function parsePath(result) {
  return result.content[0].text.replace("Image saved to: ", "");
}

/** Snapshot the set of files in cwd so we can detect new ones. */
function outputSnapshot() {
  const cwd = process.cwd();
  return new Set(fs.existsSync(cwd) ? fs.readdirSync(cwd) : []);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generate_image tool", () => {
  test("happy path: returns 'Image saved to:' text", async () => {
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI());
    const result = await call("generate_image", { prompt: "a red barn" });
    assert.ok(result.content[0].text.startsWith("Image saved to:"));
  });

  test("happy path: returned path exists on disk", async () => {
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI());
    const result = await call("generate_image", { prompt: "a red barn" });
    const p = parsePath(result);
    writtenFiles.push(p);
    assert.ok(fs.existsSync(p), `expected file at: ${p}`);
  });

  test("uses low quality by default (no context, no explicit args)", async () => {
    let captured;
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    const result = await call("generate_image", { prompt: "a cat" });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.quality,    "low");
    assert.equal(captured.size,       "1024x1024");
    assert.equal(captured.background, "opaque");
  });

  test("uses model gpt-image-1.5", async () => {
    let captured;
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    const result = await call("generate_image", { prompt: "a cat" });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.model, "gpt-image-1.5");
  });

  test("applies context quality and size defaults", async () => {
    let captured;
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    // default context has quality: "low", size: "1024x1024"
    const result = await call("generate_image", { prompt: "a harbour", context: "default" });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.quality, "low");
    assert.equal(captured.size,    "1024x1024");
  });

  test("explicit quality overrides context default", async () => {
    let captured;
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    const result = await call("generate_image", { prompt: "a portrait", context: "default", quality: "high" });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.quality, "high");
  });

  test("explicit size overrides context default", async () => {
    let captured;
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    const result = await call("generate_image", { prompt: "a portrait", context: "default", size: "1024x1536" });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.size, "1024x1536");
  });

  test("explicit background overrides context default", async () => {
    let captured;
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    const result = await call("generate_image", { prompt: "a logo", background: "transparent" });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.background, "transparent");
  });

  test("context outputFormat is included in the prompt sent to OpenAI", async () => {
    let captured;
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    // default context has outputFormat: "PNG, 1024x1024"
    const result = await call("generate_image", { prompt: "a harbour", context: "default" });
    writtenFiles.push(parsePath(result));
    assert.ok(
      captured.prompt.includes("Output format: PNG, 1024x1024"),
      `expected context outputFormat in prompt: ${captured.prompt}`,
    );
  });

  test("invalid context name: response contains 'Context error'", async () => {
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI());
    const result = await call("generate_image", { prompt: "a cat", context: "nonexistent_xyz" });
    assert.ok(result.content[0].text.includes("Context error"));
    assert.ok(result.content[0].text.includes("nonexistent_xyz"));
  });

  test("invalid context name: no file is written", async () => {
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI());
    const before = outputSnapshot();
    await call("generate_image", { prompt: "a cat", context: "nonexistent_xyz" });
    const after = outputSnapshot();
    const newFiles = [...after].filter(f => !before.has(f));
    assert.equal(newFiles.length, 0, `unexpected new files: ${newFiles.join(", ")}`);
  });

  test("OpenAI throws: response contains 'OpenAI API error'", async () => {
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(async () => { throw new Error("401 Incorrect API key"); }));
    const result = await call("generate_image", { prompt: "a cat" });
    assert.ok(result.content[0].text.includes("OpenAI API error"));
    assert.ok(result.content[0].text.includes("401 Incorrect API key"));
  });

  test("OpenAI throws: no file is written", async () => {
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(async () => { throw new Error("API error"); }));
    const before = outputSnapshot();
    await call("generate_image", { prompt: "a cat" });
    const after = outputSnapshot();
    const newFiles = [...after].filter(f => !before.has(f));
    assert.equal(newFiles.length, 0, `unexpected new files: ${newFiles.join(", ")}`);
  });

  test("missing b64_json in response: returns descriptive error text", async () => {
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(async () => ({ data: [{}] })));
    const result = await call("generate_image", { prompt: "a cat" });
    assert.ok(
      result.content[0].text.includes("no b64_json"),
      `expected 'no b64_json' in: ${result.content[0].text}`,
    );
  });

  test("missing b64_json in response: no file is written", async () => {
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(async () => ({ data: [{}] })));
    const before = outputSnapshot();
    await call("generate_image", { prompt: "a cat" });
    const after = outputSnapshot();
    const newFiles = [...after].filter(f => !before.has(f));
    assert.equal(newFiles.length, 0);
  });

  // -------------------------------------------------------------------------
  // referenceImages — context-driven routing to images.edit()
  // -------------------------------------------------------------------------

  test("context without referenceImages uses images.generate()", async () => {
    let generateCalled = false;
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(
      async () => { generateCalled = true; return { data: [{ b64_json: FAKE_B64 }] }; },
    ));
    const result = await call("generate_image", { prompt: "a barn", context: "default" });
    writtenFiles.push(parsePath(result));
    assert.ok(generateCalled, "expected images.generate() to be called");
  });

  test("context with referenceImages routes to images.edit(), not images.generate()", async () => {
    // Write a temp context with one reference image and a temp image file on disk.
    const contextsDir = path.resolve(__dirname, "../contexts");
    const refImagePath = path.join(contextsDir, "references", "_test_ref.webp");
    const refCtxPath   = path.join(contextsDir, "_test_refimages.json");

    fs.writeFileSync(refImagePath, Buffer.from(FAKE_B64, "base64"));
    fs.writeFileSync(refCtxPath, JSON.stringify({
      name: "_test_refimages",
      description: "test ctx with reference images",
      quality: "low",
      size: "1024x1024",
      referenceImages: ["./references/_test_ref.webp"],
    }));
    writtenFiles.push(refImagePath, refCtxPath);

    let generateCalled = false;
    let editCalled     = false;
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(
      async () => { generateCalled = true; return { data: [{ b64_json: FAKE_B64 }] }; },
      async () => { editCalled     = true; return { data: [{ b64_json: FAKE_B64 }] }; },
    ));

    const result = await call("generate_image", { prompt: "a barn", context: "_test_refimages" });
    writtenFiles.push(parsePath(result));

    assert.ok(editCalled,       "expected images.edit() to be called");
    assert.ok(!generateCalled,  "expected images.generate() NOT to be called");
  });

  test("context with referenceImages passes image files to images.edit()", async () => {
    const contextsDir = path.resolve(__dirname, "../contexts");
    const refImagePath = path.join(contextsDir, "references", "_test_ref2.webp");
    const refCtxPath   = path.join(contextsDir, "_test_refimages2.json");

    fs.writeFileSync(refImagePath, Buffer.from(FAKE_B64, "base64"));
    fs.writeFileSync(refCtxPath, JSON.stringify({
      name: "_test_refimages2",
      description: "test ctx",
      quality: "low",
      size: "1024x1024",
      referenceImages: ["./references/_test_ref2.webp"],
    }));
    writtenFiles.push(refImagePath, refCtxPath);

    let capturedEdit;
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(
      null,
      async (args) => { capturedEdit = args; return { data: [{ b64_json: FAKE_B64 }] }; },
    ));

    const result = await call("generate_image", { prompt: "a barn", context: "_test_refimages2" });
    writtenFiles.push(parsePath(result));

    assert.ok(capturedEdit, "edit was not called");
    // image field should be truthy (a single Uploadable or an array)
    assert.ok(capturedEdit.image, "expected image field in edit call");
    assert.equal(capturedEdit.prompt.includes("a barn"), true, "prompt should contain user text");
  });

  test("context with missing referenceImages: response contains error text", async () => {
    const contextsDir = path.resolve(__dirname, "../contexts");
    const refCtxPath  = path.join(contextsDir, "_test_missingref.json");

    fs.writeFileSync(refCtxPath, JSON.stringify({
      name: "_test_missingref",
      description: "test ctx with missing ref",
      quality: "low",
      size: "1024x1024",
      referenceImages: ["./references/_does_not_exist.webp"],
    }));
    writtenFiles.push(refCtxPath);

    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI());

    const result = await call("generate_image", { prompt: "a barn", context: "_test_missingref" });
    assert.ok(
      result.content[0].text.includes("Reference image(s) not found"),
      `expected error text, got: ${result.content[0].text}`,
    );
  });

  test("context with missing referenceImages: no file is written", async () => {
    const contextsDir = path.resolve(__dirname, "../contexts");
    const refCtxPath  = path.join(contextsDir, "_test_missingref2.json");

    fs.writeFileSync(refCtxPath, JSON.stringify({
      name: "_test_missingref2",
      description: "test ctx",
      quality: "low",
      size: "1024x1024",
      referenceImages: ["./references/_does_not_exist_either.webp"],
    }));
    writtenFiles.push(refCtxPath);

    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI());

    const before = outputSnapshot();
    await call("generate_image", { prompt: "a barn", context: "_test_missingref2" });
    const after = outputSnapshot();
    const newFiles = [...after].filter(f => !before.has(f));
    assert.equal(newFiles.length, 0, `unexpected new files: ${newFiles.join(", ")}`);
  });
});

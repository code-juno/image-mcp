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
 */

import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { registerGenerateTool } from "../src/tools/generate.js";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const outputsDir = path.resolve(__dirname, "../outputs");

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

/** Returns a mock OpenAI client with a successful images.generate. */
function makeOpenAI(generateFn) {
  return {
    images: {
      generate: generateFn ?? (async () => ({ data: [{ b64_json: FAKE_B64 }] })),
    },
  };
}

/** Extract the saved path from a successful tool response. */
function parsePath(result) {
  return result.content[0].text.replace("Image saved to: ", "");
}

/** Snapshot the set of files in outputs/ so we can detect new ones. */
function outputSnapshot() {
  return new Set(fs.existsSync(outputsDir) ? fs.readdirSync(outputsDir) : []);
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

  test("uses medium quality by default (no context, no explicit args)", async () => {
    let captured;
    const { server, call } = makeServer();
    registerGenerateTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    const result = await call("generate_image", { prompt: "a cat" });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.quality,    "medium");
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
    // default context has quality: "medium", size: "1024x1024"
    const result = await call("generate_image", { prompt: "a harbour", context: "default" });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.quality, "medium");
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

  test("invalid context name: no file is written to outputs/", async () => {
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

  test("OpenAI throws: no file is written to outputs/", async () => {
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
});

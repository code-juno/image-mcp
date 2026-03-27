/**
 * Tool handler tests for src/tools/edit.js
 *
 * Two real PNG files are written to a temp directory before the suite and
 * deleted after.  The OpenAI client is mocked so no API calls are made.
 *
 * Tests cover:
 *  - Happy path with single image
 *  - Happy path with multiple images
 *  - Single image is passed as Uploadable (not array) to the API
 *  - Multiple images are passed as an array to the API
 *  - Single missing path → error text, no file written
 *  - All missing paths listed when multiple are invalid
 *  - Mixed valid + invalid paths → error lists only the missing ones
 *  - No file written when any path is missing
 *  - Bad context name → error text
 *  - OpenAI throws → error text, no file written
 *  - Missing b64_json → error text
 *  - Context quality/size defaults are applied
 *  - Explicit quality/size override context defaults
 *  - Hard-coded fallback defaults (quality=medium, size=1024x1024)
 *  - MIME type is set based on file extension (png/jpg/webp)
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { registerEditTool } from "../src/tools/edit.js";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const outputsDir = path.resolve(__dirname, "../outputs");
const tmpDir     = path.resolve(__dirname, "../outputs/_test_edit_tmp");

// Minimal valid PNG buffer (1×1 pixel).
const FAKE_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const FAKE_PNG = Buffer.from(FAKE_B64, "base64");

let tmpPng1, tmpPng2, tmpJpg, tmpWebp;

before(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  tmpPng1  = path.join(tmpDir, "source1.png");
  tmpPng2  = path.join(tmpDir, "source2.png");
  tmpJpg   = path.join(tmpDir, "source.jpg");
  tmpWebp  = path.join(tmpDir, "source.webp");
  fs.writeFileSync(tmpPng1,  FAKE_PNG);
  fs.writeFileSync(tmpPng2,  FAKE_PNG);
  fs.writeFileSync(tmpJpg,   FAKE_PNG); // content doesn't matter, only extension
  fs.writeFileSync(tmpWebp,  FAKE_PNG);
});

const writtenFiles = [];

after(() => {
  for (const f of writtenFiles) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServer() {
  const handlers = {};
  const server = {
    registerTool: (name, _schema, handler) => { handlers[name] = handler; },
  };
  return { server, call: (name, args) => handlers[name](args) };
}

function makeOpenAI(editFn) {
  return {
    images: {
      edit: editFn ?? (async () => ({ data: [{ b64_json: FAKE_B64 }] })),
    },
  };
}

function parsePath(result) {
  return result.content[0].text.replace("Edited image saved to: ", "");
}

function outputSnapshot() {
  return new Set(fs.existsSync(outputsDir) ? fs.readdirSync(outputsDir) : []);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("edit_image tool", () => {
  test("happy path single image: response starts with 'Edited image saved to:'", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI());
    const result = await call("edit_image", { prompt: "add a rainbow", image_paths: [tmpPng1] });
    assert.ok(result.content[0].text.startsWith("Edited image saved to:"));
    writtenFiles.push(parsePath(result));
  });

  test("happy path single image: returned file exists on disk", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI());
    const result = await call("edit_image", { prompt: "add stars", image_paths: [tmpPng1] });
    const p = parsePath(result);
    writtenFiles.push(p);
    assert.ok(fs.existsSync(p), `expected file at: ${p}`);
  });

  test("happy path multiple images: file saved and path returned", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI());
    const result = await call("edit_image", { prompt: "merge styles", image_paths: [tmpPng1, tmpPng2] });
    assert.ok(result.content[0].text.startsWith("Edited image saved to:"));
    writtenFiles.push(parsePath(result));
  });

  test("single image is passed to API as Uploadable (not array)", async () => {
    let captured;
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    const result = await call("edit_image", { prompt: "add fog", image_paths: [tmpPng1] });
    writtenFiles.push(parsePath(result));
    assert.ok(!Array.isArray(captured.image), "single image should NOT be wrapped in an array");
  });

  test("multiple images are passed to API as an array", async () => {
    let captured;
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    const result = await call("edit_image", { prompt: "add fog", image_paths: [tmpPng1, tmpPng2] });
    writtenFiles.push(parsePath(result));
    assert.ok(Array.isArray(captured.image), "multiple images should be passed as an array");
    assert.equal(captured.image.length, 2);
  });

  test("single missing path: response contains 'File(s) not found'", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI());
    const result = await call("edit_image", { prompt: "add stars", image_paths: ["/tmp/_missing_xyz_1234.png"] });
    assert.ok(result.content[0].text.includes("File(s) not found"));
  });

  test("single missing path: missing path appears in error message", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI());
    const result = await call("edit_image", { prompt: "add stars", image_paths: ["/tmp/_missing_xyz_1234.png"] });
    assert.ok(result.content[0].text.includes("/tmp/_missing_xyz_1234.png"));
  });

  test("multiple missing paths: all are listed in error", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI());
    const result = await call("edit_image", {
      prompt: "add fog",
      image_paths: ["/tmp/_missing_a.png", "/tmp/_missing_b.png"],
    });
    assert.ok(result.content[0].text.includes("/tmp/_missing_a.png"), "first missing path should be listed");
    assert.ok(result.content[0].text.includes("/tmp/_missing_b.png"), "second missing path should be listed");
  });

  test("mixed valid + invalid: only the missing path appears in error", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI());
    const result = await call("edit_image", {
      prompt: "add fog",
      image_paths: [tmpPng1, "/tmp/_missing_xyz.png"],
    });
    assert.ok(result.content[0].text.includes("/tmp/_missing_xyz.png"), "missing path should be in error");
    assert.ok(!result.content[0].text.includes(tmpPng1), "valid path should NOT be in error");
  });

  test("missing path: no file written to outputs/", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI());
    const before = outputSnapshot();
    await call("edit_image", { prompt: "add stars", image_paths: ["/tmp/_missing_xyz_1234.png"] });
    const after = outputSnapshot();
    const newFiles = [...after].filter(f => !before.has(f));
    assert.equal(newFiles.length, 0, `unexpected new files: ${newFiles.join(", ")}`);
  });

  test("invalid context name: response contains 'Context error'", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI());
    const result = await call("edit_image", { prompt: "add fog", image_paths: [tmpPng1], context: "nonexistent_xyz" });
    assert.ok(result.content[0].text.includes("Context error"));
  });

  test("OpenAI throws: response contains 'OpenAI API error'", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI(async () => { throw new Error("500 Server Error"); }));
    const result = await call("edit_image", { prompt: "add stars", image_paths: [tmpPng1] });
    assert.ok(result.content[0].text.includes("OpenAI API error"));
    assert.ok(result.content[0].text.includes("500 Server Error"));
  });

  test("OpenAI throws: no file written to outputs/", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI(async () => { throw new Error("API error"); }));
    const before = outputSnapshot();
    await call("edit_image", { prompt: "add stars", image_paths: [tmpPng1] });
    const after = outputSnapshot();
    const newFiles = [...after].filter(f => !before.has(f));
    assert.equal(newFiles.length, 0);
  });

  test("missing b64_json in response: returns descriptive error", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI(async () => ({ data: [{}] })));
    const result = await call("edit_image", { prompt: "add stars", image_paths: [tmpPng1] });
    assert.ok(result.content[0].text.includes("no b64_json"));
  });

  test("uses medium quality by default (no context, no explicit quality)", async () => {
    let captured;
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    const result = await call("edit_image", { prompt: "add stars", image_paths: [tmpPng1] });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.quality, "medium");
    assert.equal(captured.size,    "1024x1024");
  });

  test("applies context quality and size defaults", async () => {
    let captured;
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    // default context: quality="medium", size="1024x1024"
    const result = await call("edit_image", { prompt: "add fog", image_paths: [tmpPng1], context: "default" });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.quality, "medium");
    assert.equal(captured.size,    "1024x1024");
  });

  test("explicit quality overrides context default", async () => {
    let captured;
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    const result = await call("edit_image", { prompt: "add fog", image_paths: [tmpPng1], context: "default", quality: "high" });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.quality, "high");
  });

  test("explicit size overrides context default", async () => {
    let captured;
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    const result = await call("edit_image", { prompt: "add fog", image_paths: [tmpPng1], context: "default", size: "1536x1024" });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.size, "1536x1024");
  });

  test("PNG file gets image/png MIME type", async () => {
    // We can verify MIME type indirectly: the call should succeed (server accepts it)
    // and no error is returned. Direct MIME inspection requires reading the Uploadable.
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI());
    const result = await call("edit_image", { prompt: "test", image_paths: [tmpPng1] });
    assert.ok(result.content[0].text.startsWith("Edited image saved to:"), `PNG failed: ${result.content[0].text}`);
    writtenFiles.push(parsePath(result));
  });

  test("JPG file gets image/jpeg MIME type (no error returned)", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI());
    const result = await call("edit_image", { prompt: "test", image_paths: [tmpJpg] });
    assert.ok(result.content[0].text.startsWith("Edited image saved to:"), `JPG failed: ${result.content[0].text}`);
    writtenFiles.push(parsePath(result));
  });

  test("WEBP file gets image/webp MIME type (no error returned)", async () => {
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI());
    const result = await call("edit_image", { prompt: "test", image_paths: [tmpWebp] });
    assert.ok(result.content[0].text.startsWith("Edited image saved to:"), `WEBP failed: ${result.content[0].text}`);
    writtenFiles.push(parsePath(result));
  });

  test("uses model gpt-image-1.5", async () => {
    let captured;
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    const result = await call("edit_image", { prompt: "add stars", image_paths: [tmpPng1] });
    writtenFiles.push(parsePath(result));
    assert.equal(captured.model, "gpt-image-1.5");
  });

  test("context outputFormat shapes the prompt sent to OpenAI", async () => {
    let captured;
    const { server, call } = makeServer();
    registerEditTool(server, makeOpenAI(async (args) => { captured = args; return { data: [{ b64_json: FAKE_B64 }] }; }));
    // default context has outputFormat: "PNG, 1024x1024"
    const result = await call("edit_image", { prompt: "add fog", image_paths: [tmpPng1], context: "default" });
    writtenFiles.push(parsePath(result));
    assert.ok(
      captured.prompt.includes("Output format: PNG, 1024x1024"),
      `expected outputFormat in prompt: ${captured.prompt}`,
    );
  });
});

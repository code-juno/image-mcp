# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                        # run all tests (Node built-in runner, no extra deps)
node --test test/generate.test.js   # run a single test file
npm start                       # start the MCP server (blocks on stdin)
OPENAI_API_KEY="" node src/index.js  # smoke-test: should print error and exit 1
```

## Architecture

This is a **stdio MCP server** that exposes three tools to Claude: `generate_image`, `edit_image`, and `list_contexts`. The server process is launched by Claude as a subprocess and communicates over stdin/stdout using JSON-RPC (MCP protocol). All logging must go to **stderr** to avoid corrupting the MCP stream.

### Request flow

```
Claude → stdin → src/index.js → registerGenerateTool / registerEditTool
                                        ↓
                              src/utils/context.js   (loads contexts/*.json, builds prompt)
                                        ↓
                              openai.images.generate() or .edit()
                                        ↓
                              src/utils/storage.js   (converts to WebP via sharp, saves to disk)
                                        ↓
                              returns file path → stdout → Claude
```

### Key design decisions

**Context presets** (`contexts/*.json`) bundle style text and default parameters. `buildPrompt()` in `context.js` assembles the final prompt as: `styleGuide + userPrompt + "Output format: ..." + "Avoid: ..."`. Fields that are empty strings are silently skipped.

**`referenceImages` in context JSON** — when a context includes this array of file paths, `generate_image` automatically routes to `openai.images.edit()` instead of `openai.images.generate()`, passing the images as visual style context. Paths are relative to the `contexts/` directory. Without `referenceImages`, `generate_image` uses `images.generate()` (text-only).

**Output** — all images are saved as WebP (quality 85, via `sharp`) with filenames `YYYY-MM-DD_HH-MM-SS_<contextName>.webp`. Files land in the caller's cwd by default; `output_dir` overrides this. The directory is auto-created if missing.

**`background: "opaque"`** is the default for `generate_image`. Only pass `"transparent"` when explicitly requested.

**`quality: "low"`** is the default for `generate_image`. Do not upgrade quality on the user's behalf.

### Tool registration pattern

Each tool lives in `src/tools/<name>.js` and exports a `register*Tool(server, openai)` function. Tools receive the shared OpenAI client from `index.js`. The MCP SDK's `inputSchema` expects a **raw Zod shape** (plain object of Zod schemas) — do not wrap it in `z.object({...})`.

### Tests

Tests use Node's built-in `node:test` runner with no extra dependencies. The OpenAI client is replaced by a lightweight mock — no API key or credits needed. Temp files written during tests use a `_test_` prefix and are cleaned up in `after()` hooks. The `makeServer()` helper captures registered handlers so they can be invoked directly without starting the full MCP server.

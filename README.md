# image-mcp

A personal MCP (Model Context Protocol) server that lets Claude Desktop generate
and edit images via the OpenAI **gpt-image-1.5** API.

---

## Project layout

```
image-mcp/
├── .env.example          ← copy to .env and add your API key
├── .gitignore
├── package.json
├── README.md
├── TESTING.md            ← manual end-to-end testing guide
├── contexts/             ← style presets (JSON)
│   └── default.json
├── outputs/              ← generated PNGs land here
│   └── .gitkeep
├── test/                 ← automated unit + integration tests
│   ├── context.test.js   ← tests for src/utils/context.js
│   ├── storage.test.js   ← tests for src/utils/storage.js
│   ├── generate.test.js  ← tests for generate_image tool handler
│   └── edit.test.js      ← tests for edit_image tool handler
└── src/
    ├── index.js          ← server bootstrap
    ├── tools/
    │   ├── generate.js   ← generate_image tool
    │   └── edit.js       ← edit_image tool
    └── utils/
        ├── context.js    ← context loading helpers
        └── storage.js    ← image saving helper
```

---

## Installation

```bash
# 1. Clone / download the project
cd image-mcp

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
```

---

## Configuration — Claude Code

Run this command to add the server globally (available in all projects):

```bash
claude mcp add image-mcp --scope user --transport stdio --env OPENAI_API_KEY=your-key-here -- node /Users/codejuno/mcp/image-mcp/src/index.js
```

Replace `your-key-here` with your OpenAI API key and update the path if needed.

---

## Configuration — Claude Desktop

Add the server to `~/Library/Application Support/Claude/claude_desktop_config.json`
(create the file if it doesn't exist):

```json
{
  "mcpServers": {
    "image-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/image-mcp/src/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/image-mcp` with the real path on your machine.
Restart Claude Desktop after saving.

---

## Tools

### `generate_image`

Generate a new image from a text prompt.

| Parameter    | Type   | Required | Default    | Description |
|-------------|--------|----------|------------|-------------|
| `prompt`    | string | Yes      | —          | What to generate |
| `context`   | string | No       | —          | Context preset name (e.g. `"default"`) |
| `quality`   | enum   | No       | `"medium"` | `"low"` / `"medium"` / `"high"` |
| `size`      | enum   | No       | `"1024x1024"` | `"1024x1024"` / `"1536x1024"` (landscape) / `"1024x1536"` (portrait) |
| `background`| enum   | No       | `"opaque"` | `"opaque"` / `"transparent"` |

Returns the absolute path of the saved PNG.

---

### `edit_image`

Edit an existing image using a text prompt.

| Parameter    | Type   | Required | Default    | Description |
|-------------|--------|----------|------------|-------------|
| `prompt`    | string | Yes      | —          | Description of the edits to apply |
| `image_paths`| array | Yes      | —          | Array of 1–16 paths to source images (PNG/WEBP/JPG, < 50 MB each) |
| `context`   | string | No       | —          | Context preset name |
| `quality`   | enum   | No       | `"medium"` | `"low"` / `"medium"` / `"high"` |
| `size`      | enum   | No       | `"1024x1024"` | Same options as generate_image |

Returns the absolute path of the saved PNG.

---

### `list_contexts`

List all available context presets. No parameters required.

Returns a formatted list of context names and descriptions.

---

## Contexts

A context is a JSON file in `/contexts` that bundles style defaults for a
particular use-case.  You can create as many as you like.

**Field reference:**

| Field           | Type   | Description |
|----------------|--------|-------------|
| `name`         | string | Identifier used when calling tools (`context: "my-preset"`) |
| `description`  | string | Shown by `list_contexts` |
| `styleGuide`   | string | Prepended to the user prompt (e.g. `"Photorealistic, high detail"`) |
| `outputFormat` | string | Appended as `Output format: <value>` (informational for the model) |
| `negativePrompt`| string | Appended as `Avoid: <value>` |
| `model`        | string | Reserved — currently always `"gpt-image-1.5"` |
| `quality`      | string | Default quality for this context (`"low"` / `"medium"` / `"high"`) |
| `size`         | string | Default size (`"1024x1024"` / `"1536x1024"` / `"1024x1536"`) |
| `background`   | string | Default background (`"opaque"` / `"transparent"`) |

**Example — adding a "photo" context:**

```json
// contexts/photo.json
{
  "name": "photo",
  "description": "Photorealistic photography style",
  "styleGuide": "Photorealistic DSLR photograph, natural lighting, sharp focus",
  "outputFormat": "PNG, 1024x1024",
  "negativePrompt": "illustration, cartoon, painting, CGI, text, watermark",
  "model": "gpt-image-1.5",
  "quality": "high",
  "size": "1024x1024",
  "background": "opaque"
}
```

Then in Claude Desktop: *"Generate an image of a red barn at sunset using the photo context"*

---

## Output files

All generated images are saved to `/outputs` with the naming pattern:

```
YYYY-MM-DD_HH-MM-SS_<contextName>.png
```

For example: `2025-03-27_14-05-30_default.png`

The `/outputs` directory is git-ignored (only `.gitkeep` is tracked) so your
generated images never end up in version control.

---

## Testing

The automated test suite uses Node's built-in test runner — no extra dependencies required.

```bash
npm test
```

71 tests run in well under a second.  The OpenAI API is fully mocked, so no
key or credits are needed.

**What is covered:**

| File | What it tests |
|------|--------------|
| `test/context.test.js` | `buildPrompt` field ordering and empty-field skipping; `loadContext` happy path, missing file, malformed JSON; `listContexts` normal listing, malformed-file resilience, name fallback |
| `test/storage.test.js` | `saveImage` return value, filename format, file written to disk, buffer contents, context-name sanitization, `outputs/` auto-creation |
| `test/generate.test.js` | `generate_image` happy path, context defaults, explicit-arg overrides, bad context, OpenAI error, missing `b64_json`, hard-coded fallbacks, prompt shaping |
| `test/edit.test.js` | `edit_image` single/multi image, Uploadable vs. array routing, missing paths (all reported), mixed valid/invalid, bad context, OpenAI error, missing `b64_json`, MIME types per extension, parameter overrides |

For manual end-to-end testing through Claude Desktop, see **TESTING.md**.

---

## Running manually

```bash
node src/index.js
```

The process will block waiting for MCP messages on stdin — this is normal.
If the API key is missing it will print an error to stderr and exit immediately.

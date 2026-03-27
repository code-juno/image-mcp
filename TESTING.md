# Manual Testing Guide — image-mcp

This document walks through every tool and edge case you should exercise before
trusting the server in daily use.  All tests are run through Claude Code
unless noted otherwise.

---

## Prerequisites

1. `npm install` is done and `node_modules/` exists.
2. `.env` exists with a valid `OPENAI_API_KEY`.
3. The server is registered via:
   ```bash
   claude mcp add image-mcp --scope user --transport stdio --env OPENAI_API_KEY=your-key-here -- node /path/to/image-mcp/src/index.js
   ```
4. Run `claude mcp list` and confirm **image-mcp** appears.

---

## 0 — Smoke test (no API call)

**Goal:** confirm the process starts and exits cleanly on bad config.

```bash
# Should print the error and exit 1 — never hangs
OPENAI_API_KEY="" node src/index.js
# Expected: [image-mcp] ERROR: OPENAI_API_KEY is not set.

# Should start and block (waiting for MCP stdin) — Ctrl-C to stop
node src/index.js
# Expected: no output, process stays alive
```

---

## 1 — `list_contexts`

**In Claude Code:** *"List all available image contexts"*

**Expected output:**
```
Available contexts:
• default: General purpose — no specific style applied
```

**Then:** add a second context file to `/contexts/photo.json` (any valid JSON
matching the context schema) and repeat — it should now appear in the list.

---

## 2 — `generate_image` — basic

**Prompt:** *"Generate an image of a red barn at sunset"*

**Expected:**
- Claude calls `generate_image` with just `prompt`.
- A file named like `2026-03-27_14-05-30_default.png` is saved in the **current working directory** (wherever Claude Code is running from).
- Claude reports the absolute path.
- Open the file — it should be a valid PNG.

---

## 3 — `generate_image` — explicit parameters

**Prompt:** *"Generate a portrait of an astronaut, quality high, size 1024x1536"*

**Expected:**
- `quality: "high"` and `size: "1024x1536"` are passed to the API.
- Output file is a tall portrait-orientation image.

---

## 3b — `generate_image` — custom output directory

**Prompt:** *"Generate an image of a mountain lake, save it to ~/Desktop"*

**Expected:**
- `output_dir` is set to `~/Desktop` (or its absolute equivalent).
- The file appears on the Desktop, not in the working directory.
- Directory is created automatically if it does not exist.

---

## 4 — `generate_image` — transparent background

**Prompt:** *"Generate a logo of a geometric fox, transparent background"*

**Expected:**
- `background: "transparent"` is passed.
- Open the PNG in a viewer that shows transparency (e.g. Preview on Mac) —
  the background should be a checkerboard pattern, not white.

---

## 5 — `generate_image` — with context

First make sure `contexts/default.json` has non-empty `styleGuide` or
`negativePrompt` so the prompt-building logic is exercised.  Temporarily edit
it, e.g.:

```json
{
  "styleGuide": "Impressionist oil painting style",
  "negativePrompt": "photorealistic, photograph"
}
```

**Prompt:** *"Generate an image of a harbour using the default context"*

**Expected:**
- The final prompt sent to OpenAI should contain the style guide text.
- The output image should reflect the impressionist style instruction.
- Restore `default.json` to its original values after testing.

---

## 6 — `generate_image` — bad context name

**Prompt:** *"Generate an image of a cat using context 'nonexistent'"*

**Expected:**
- Claude returns: `Context error: Context "nonexistent" not found. Available contexts: default`
- No file is written to `outputs/`.

---

## 7 — `edit_image` — single image

Use one of the PNGs generated in test 2 or 3.

**Prompt:** *"Edit the image at `<path>` — add a rainbow in the sky"*
(paste the actual path Claude reported)

**Expected:**
- A new file appears in `outputs/`.
- The new image is a modified version of the original with a rainbow added.

---

## 8 — `edit_image` — multiple images as context

Generate two different images first (tests 2 and 3), then:

**Prompt:** *"Edit these images: `['<path1>', '<path2>']` — combine the style of both into a single new landscape"*

Or more naturally: *"Use edit_image with image_paths set to [path1, path2] and prompt 'merge the colour palette of both images into a new forest scene'"*

**Expected:**
- Both files are read without error.
- A single output image is produced that reflects input from both source images.
- Output path is returned.

---

## 9 — `edit_image` — one missing path

**Prompt:** *"Edit the image at `/tmp/does_not_exist.png` — add stars"*

**Expected:**
- Returns: `File(s) not found: • /tmp/does_not_exist.png`
- No file written to `outputs/`.

---

## 10 — `edit_image` — mixed valid/invalid paths

**Prompt:** *"Edit these images: ['/tmp/missing.png', '<valid-path>'] — add fog"*

**Expected:**
- Both missing files are listed in the error, not just the first one.
- No API call is made.

---

## 11 — Output file naming

After running a few generate/edit tests, inspect the directory where files were saved
(your cwd, or the `output_dir` you specified):

```bash
ls <output-directory>/
```

**Check:**
- Files are named `YYYY-MM-DD_HH-MM-SS_<context>.png`.
- Timestamps sort chronologically.
- No duplicate filenames (timestamps differ by at least one second between calls).

---

## 12 — Bad API key

Remove the server and re-add it with a wrong key:

```bash
claude mcp remove image-mcp
claude mcp add image-mcp --scope user --transport stdio --env OPENAI_API_KEY=bad-key -- node /path/to/image-mcp/src/index.js
```

Then try generating an image.

**Expected:**
- Claude returns: `OpenAI API error: ...` with a meaningful message (e.g. `401 Incorrect API key`).
- No file is written.
- The server does not crash — subsequent tool calls should still work after
  you restore the correct key and re-add the server.

---

## 13 — Custom output directory auto-creation

Pass a directory that does not yet exist as `output_dir`, then generate an image.

**Prompt:** *"Generate an image of a sunset, save to /tmp/image-mcp-test"*

**Expected:**
- `saveImage()` creates `/tmp/image-mcp-test` automatically (`mkdirSync` with `recursive: true`).
- The file is saved successfully inside that directory.

---

## Checklist summary

| # | Tool | Scenario | Pass? |
|---|------|----------|-------|
| 0 | — | Missing API key → clean exit | |
| 1 | list_contexts | Lists default context | |
| 2 | generate_image | Basic prompt — file saved to cwd | |
| 3 | generate_image | Explicit quality + size | |
| 3b | generate_image | Custom `output_dir` — file saved there | |
| 4 | generate_image | Transparent background | |
| 5 | generate_image | Context shapes the prompt | |
| 6 | generate_image | Invalid context name | |
| 7 | edit_image | Single image | |
| 8 | edit_image | Multiple images as context | |
| 9 | edit_image | Single missing path | |
| 10 | edit_image | Mixed valid/invalid paths | |
| 11 | — | Output filenames correct | |
| 12 | — | Bad API key → graceful error | |
| 13 | — | Missing output dir → auto-created | |

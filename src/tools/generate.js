/**
 * generate.js — MCP tool: generate_image
 *
 * Calls the OpenAI images.generate() endpoint with gpt-image-1.5,
 * optionally shapes the prompt using a context preset, saves the result
 * as a PNG in /outputs, and returns the file path.
 *
 * When a context preset includes a `referenceImages` array, the tool
 * automatically switches to images.edit() so the model can use those
 * images as visual style references alongside the prompt.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toFile } from "openai";
import { z } from "zod";
import { loadContext, buildPrompt } from "../utils/context.js";
import { saveImage } from "../utils/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contextsDir = path.resolve(__dirname, "../../contexts");

const MIME_TYPES = {
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "image/png";
}

/**
 * Resolve a reference image path from a context file.
 * Paths starting with "." are resolved relative to the /contexts directory.
 * Absolute paths are used as-is.
 */
function resolveRefPath(refPath) {
  return path.isAbsolute(refPath)
    ? refPath
    : path.resolve(contextsDir, refPath);
}

/**
 * Register the generate_image tool on the given McpServer instance.
 *
 * We receive the pre-built OpenAI client from index.js so all tools share
 * the same instance (and the same API key / configuration).
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {import("openai").OpenAI} openai
 */
export function registerGenerateTool(server, openai) {
  server.registerTool(
    "generate_image",
    {
      title: "Generate Image",
      description:
        "Generate an image from a text prompt using OpenAI gpt-image-1.5. " +
        "Optionally load a context preset to apply a style guide and default parameters. " +
        "The output is saved to disk and the file path is returned.",

      // inputSchema is a raw Zod shape — an object whose values are Zod schemas.
      // The MCP SDK wraps this internally; do NOT pass z.object({...}) here.
      inputSchema: {
        prompt: z
          .string()
          .describe("Text description of the image to generate."),

        context: z
          .string()
          .optional()
          .describe(
            "Name of a context preset from the /contexts directory (e.g. \"default\"). " +
              "When provided, its styleGuide, outputFormat, and negativePrompt are " +
              "prepended/appended to the prompt, and its quality/size/background values " +
              "are used as defaults (overridable by the other parameters).",
          ),

        quality: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe(
            "Render quality. ALWAYS default to \"low\" unless the user explicitly requests higher quality. " +
              "Do NOT upgrade quality on the user's behalf. \"low\" is fast and sufficient for most tasks.",
          ),

        size: z
          .enum(["1024x1024", "1536x1024", "1024x1536"])
          .optional()
          .describe(
            "Output dimensions. ALWAYS default to \"1024x1024\" unless the user explicitly requests landscape or portrait. " +
              "Do NOT change the size on the user's behalf. 1536x1024 is landscape, 1024x1536 is portrait.",
          ),

        background: z
          .enum(["transparent", "opaque"])
          .optional()
          .describe(
            "Whether the image background should be transparent (PNG alpha channel) or opaque. " +
              "ALWAYS default to \"opaque\" unless the user explicitly requests a transparent background. " +
              "Do NOT use transparent on the user's behalf.",
          ),

        output_dir: z
          .string()
          .optional()
          .describe(
            "Directory where the output PNG will be saved. " +
              "Defaults to the caller's current working directory.",
          ),
      },
    },

    async ({ prompt, context, quality, size, background, output_dir }) => {
      // ------------------------------------------------------------------
      // 1. Load context preset (if requested) and resolve final parameters.
      //    Explicit tool arguments always win over context defaults.
      // ------------------------------------------------------------------
      let ctx = null;
      let contextName = "default";

      if (context) {
        try {
          ctx = loadContext(context);
          contextName = ctx.name ?? context;
        } catch (err) {
          // Return a clear error message rather than crashing the server.
          return { content: [{ type: "text", text: `Context error: ${err.message}` }] };
        }
      }

      // Merge: explicit arg → context default → hard-coded fallback
      const finalQuality    = quality    ?? ctx?.quality    ?? "low";
      const finalSize       = size       ?? ctx?.size       ?? "1024x1024";
      const finalBackground = background ?? ctx?.background ?? "opaque";

      // ------------------------------------------------------------------
      // 2. Build the final prompt string.
      // ------------------------------------------------------------------
      const finalPrompt = buildPrompt(prompt, ctx);

      // ------------------------------------------------------------------
      // 3. Call the OpenAI image API.
      //
      //    If the context includes referenceImages, resolve and upload them
      //    via images.edit() so the model uses them as visual style context.
      //    Otherwise fall back to the standard images.generate() text-only call.
      //
      //    gpt-image-1.5 always returns base64 JSON — no response_format needed.
      // ------------------------------------------------------------------
      const refPaths = (ctx?.referenceImages ?? []).map(resolveRefPath);
      const missing  = refPaths.filter((p) => !fs.existsSync(p));

      if (missing.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Reference image(s) not found:\n${missing.map((p) => `  • ${p}`).join("\n")}`,
            },
          ],
        };
      }

      let response;
      try {
        if (refPaths.length > 0) {
          // images.edit() accepts reference images as visual context.
          const imageFiles = await Promise.all(
            refPaths.map((p) =>
              toFile(fs.createReadStream(p), path.basename(p), { type: getMimeType(p) }),
            ),
          );

          response = await openai.images.edit({
            model: "gpt-image-1.5",
            image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
            prompt: finalPrompt,
            quality: finalQuality,
            size: finalSize,
          });
        } else {
          response = await openai.images.generate({
            model: "gpt-image-1.5",
            prompt: finalPrompt,
            quality: finalQuality,
            size: finalSize,
            background: finalBackground,
          });
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `OpenAI API error: ${err.message ?? String(err)}`,
            },
          ],
        };
      }

      // ------------------------------------------------------------------
      // 4. Decode the base64 image and save it to /outputs.
      // ------------------------------------------------------------------
      const b64 = response.data?.[0]?.b64_json;
      if (!b64) {
        return {
          content: [
            {
              type: "text",
              text: "Unexpected response from OpenAI: no b64_json data returned.",
            },
          ],
        };
      }

      const imageBuffer = Buffer.from(b64, "base64");
      const outputPath  = await saveImage(imageBuffer, contextName, output_dir);

      // ------------------------------------------------------------------
      // 5. Return the saved file path to Claude Desktop.
      //    We return text (the path) rather than the raw image bytes because
      //    Claude Desktop has a ~1 MB inline content limit.
      // ------------------------------------------------------------------
      return {
        content: [
          {
            type: "text",
            text: `Image saved to: ${outputPath}`,
          },
        ],
      };
    },
  );
}

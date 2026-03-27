/**
 * edit.js — MCP tool: edit_image
 *
 * Reads one or more existing images from disk, calls the OpenAI images.edit()
 * endpoint with gpt-image-1.5, saves the result as a PNG in /outputs, and
 * returns the file path.
 *
 * Multiple input images: gpt-image-1.5 accepts up to 16 source images in a
 * single edit call.  Pass them via image_paths (array of file paths).  When
 * more than one image is provided the model uses all of them as visual context
 * — useful for style transfer, compositing, or maintaining consistency across
 * a set of reference images.
 *
 * The OpenAI edit endpoint expects each image as an "Uploadable".  In Node.js
 * we use the toFile() helper from the openai package to wrap each ReadStream
 * so the SDK can attach the correct filename and MIME type to the multipart
 * upload.
 */

import fs from "node:fs";
import path from "node:path";
import { toFile } from "openai";
import { z } from "zod";
import { loadContext, buildPrompt } from "../utils/context.js";
import { saveImage } from "../utils/storage.js";

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
 * Register the edit_image tool on the given McpServer instance.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {import("openai").OpenAI} openai
 */
export function registerEditTool(server, openai) {
  server.registerTool(
    "edit_image",
    {
      title: "Edit Image",
      description:
        "Edit or extend one or more existing images using OpenAI gpt-image-1.5. " +
        "Provide 1–16 source image paths and a prompt describing the desired changes. " +
        "When multiple images are supplied the model uses all of them as visual context. " +
        "The edited image is saved to disk and the file path is returned.",

      inputSchema: {
        prompt: z
          .string()
          .describe("Text description of the edits to apply to the image(s)."),

        image_paths: z
          .array(z.string())
          .min(1)
          .max(16)
          .describe(
            "Array of absolute (or project-root-relative) paths to source image files. " +
              "Each must be a PNG, WEBP, or JPG file under 50 MB. " +
              "Provide 1–16 images; when multiple are given the model treats them all " +
              "as visual context for the edit.",
          ),

        context: z
          .string()
          .optional()
          .describe(
            "Name of a context preset from the /contexts directory. " +
              "When provided, its styleGuide, outputFormat, and negativePrompt are " +
              "merged into the prompt, and its quality/size values are used as defaults.",
          ),

        quality: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("Render quality. Defaults to context quality or \"medium\"."),

        size: z
          .enum(["1024x1024", "1536x1024", "1024x1536"])
          .optional()
          .describe("Output dimensions. Defaults to context size or \"1024x1024\"."),

        output_dir: z
          .string()
          .optional()
          .describe(
            "Directory where the output PNG will be saved. " +
              "Defaults to the caller's current working directory.",
          ),
      },
    },

    async ({ prompt, image_paths, context, quality, size, output_dir }) => {
      // ------------------------------------------------------------------
      // 1. Validate that every source image path exists on disk.
      //    We check all of them up-front so the user gets one consolidated
      //    error instead of failing partway through.
      // ------------------------------------------------------------------
      const resolvedPaths = image_paths.map((p) => path.resolve(p));
      const missing = resolvedPaths.filter((p) => !fs.existsSync(p));

      if (missing.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `File(s) not found:\n${missing.map((p) => `  • ${p}`).join("\n")}`,
            },
          ],
        };
      }

      // ------------------------------------------------------------------
      // 2. Load context preset and resolve final parameters.
      // ------------------------------------------------------------------
      let ctx = null;
      let contextName = "default";

      if (context) {
        try {
          ctx = loadContext(context);
          contextName = ctx.name ?? context;
        } catch (err) {
          return { content: [{ type: "text", text: `Context error: ${err.message}` }] };
        }
      }

      const finalQuality = quality ?? ctx?.quality ?? "medium";
      const finalSize    = size    ?? ctx?.size    ?? "1024x1024";

      // ------------------------------------------------------------------
      // 3. Build the final prompt string.
      // ------------------------------------------------------------------
      const finalPrompt = buildPrompt(prompt, ctx);

      // ------------------------------------------------------------------
      // 4. Wrap each source image in a toFile() Uploadable.
      //
      //    The OpenAI SDK's edit endpoint requires "Uploadable" objects —
      //    File-like values with a name and MIME type.  toFile() wraps a
      //    Node.js ReadStream into that shape.
      //
      //    We run all conversions in parallel with Promise.all() since each
      //    one is independent I/O.
      // ------------------------------------------------------------------
      let imageFiles;
      try {
        imageFiles = await Promise.all(
          resolvedPaths.map((p) =>
            toFile(
              fs.createReadStream(p),
              path.basename(p),  // filename sent to the API
              { type: getMimeType(p) },
            ),
          ),
        );
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to read image file(s): ${err.message}`,
            },
          ],
        };
      }

      // ------------------------------------------------------------------
      // 5. Call the OpenAI image editing API.
      //    Pass a single Uploadable when there is only one image, or the
      //    full array when there are multiple — both are valid per the API.
      // ------------------------------------------------------------------
      let response;
      try {
        response = await openai.images.edit({
          model: "gpt-image-1.5",
          image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
          prompt: finalPrompt,
          quality: finalQuality,
          size: finalSize,
        });
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
      // 6. Decode and save the result.
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
      const outputPath  = saveImage(imageBuffer, contextName, output_dir);

      return {
        content: [
          {
            type: "text",
            text: `Edited image saved to: ${outputPath}`,
          },
        ],
      };
    },
  );
}

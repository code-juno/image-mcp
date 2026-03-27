/**
 * edit.js — MCP tool: edit_image
 *
 * Reads an existing image from disk, calls the OpenAI images.edit() endpoint
 * with gpt-image-1.5, saves the result as a PNG in /outputs, and returns
 * the file path.
 *
 * The OpenAI edit endpoint expects the image as an "Uploadable".  In Node.js
 * we use the toFile() helper from the openai package to wrap a ReadStream so
 * the SDK can attach the correct filename and MIME type to the multipart upload.
 */

import fs from "node:fs";
import path from "node:path";
import { toFile } from "openai";
import { z } from "zod";
import { loadContext, buildPrompt } from "../utils/context.js";
import { saveImage } from "../utils/storage.js";

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
        "Edit or extend an existing image using OpenAI gpt-image-1.5. " +
        "Provide the path to a source image and a prompt describing the desired changes. " +
        "The edited image is saved to disk and the file path is returned.",

      inputSchema: {
        prompt: z
          .string()
          .describe("Text description of the edits to apply to the image."),

        image_path: z
          .string()
          .describe(
            "Absolute (or relative to the project root) path to the source image file. " +
              "Must be a PNG, WEBP, or JPG file under 50 MB.",
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
      },
    },

    async ({ prompt, image_path, context, quality, size }) => {
      // ------------------------------------------------------------------
      // 1. Validate the source image path.
      // ------------------------------------------------------------------
      const resolvedPath = path.resolve(image_path);
      if (!fs.existsSync(resolvedPath)) {
        return {
          content: [
            {
              type: "text",
              text: `File not found: ${resolvedPath}`,
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
      // 4. Wrap the source image in a toFile() Uploadable.
      //
      //    The OpenAI SDK's edit endpoint requires an "Uploadable" — this is
      //    its term for a File-like object with a name and MIME type.
      //    toFile() handles that wrapping for us from a Node.js ReadStream.
      // ------------------------------------------------------------------
      let imageFile;
      try {
        imageFile = await toFile(
          fs.createReadStream(resolvedPath),
          path.basename(resolvedPath), // filename sent to the API
          { type: "image/png" },       // MIME type — treat all inputs as PNG
        );
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to read image file: ${err.message}`,
            },
          ],
        };
      }

      // ------------------------------------------------------------------
      // 5. Call the OpenAI image editing API.
      // ------------------------------------------------------------------
      let response;
      try {
        response = await openai.images.edit({
          model: "gpt-image-1.5",
          image: imageFile,
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
      const outputPath  = saveImage(imageBuffer, contextName);

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

/**
 * generate.js — MCP tool: generate_image
 *
 * Calls the OpenAI images.generate() endpoint with gpt-image-1.5,
 * optionally shapes the prompt using a context preset, saves the result
 * as a PNG in /outputs, and returns the file path.
 */

import { z } from "zod";
import { loadContext, buildPrompt } from "../utils/context.js";
import { saveImage } from "../utils/storage.js";

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
            "Render quality. \"low\" is fastest and cheapest; \"high\" is most detailed. " +
              "Defaults to the context's quality field, or \"medium\" if no context.",
          ),

        size: z
          .enum(["1024x1024", "1536x1024", "1024x1536"])
          .optional()
          .describe(
            "Output dimensions. 1536x1024 is landscape, 1024x1536 is portrait. " +
              "Defaults to the context's size field, or \"1024x1024\".",
          ),

        background: z
          .enum(["transparent", "opaque"])
          .optional()
          .describe(
            "Whether the image background should be transparent (PNG alpha channel) " +
              "or opaque. Defaults to the context's background field, or \"opaque\".",
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
      const finalQuality    = quality    ?? ctx?.quality    ?? "medium";
      const finalSize       = size       ?? ctx?.size       ?? "1024x1024";
      const finalBackground = background ?? ctx?.background ?? "opaque";

      // ------------------------------------------------------------------
      // 2. Build the final prompt string.
      // ------------------------------------------------------------------
      const finalPrompt = buildPrompt(prompt, ctx);

      // ------------------------------------------------------------------
      // 3. Call the OpenAI image generation API.
      //
      //    gpt-image-1.5 always returns base64 JSON data — there is no
      //    URL option for this model, so we don't set response_format.
      // ------------------------------------------------------------------
      let response;
      try {
        response = await openai.images.generate({
          model: "gpt-image-1.5",
          prompt: finalPrompt,
          quality: finalQuality,
          size: finalSize,
          background: finalBackground,
          // n defaults to 1; we always generate a single image per call.
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
      const outputPath  = saveImage(imageBuffer, contextName, output_dir);

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

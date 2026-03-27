/**
 * index.js — MCP server entry point for image-mcp.
 *
 * This file is responsible for:
 *  1. Loading the .env file so OPENAI_API_KEY is available in process.env.
 *  2. Validating that the key is present — we exit early with a clear message
 *     if it isn't, rather than letting a confusing network error surface later.
 *  3. Creating a single OpenAI client and MCP server instance.
 *  4. Registering all three tools (generate_image, edit_image, list_contexts).
 *  5. Connecting the server to Claude Desktop via stdio transport.
 *
 * To run manually (for smoke-testing):
 *   node src/index.js
 * The process will block waiting for MCP messages on stdin.  You can confirm
 * it started successfully because it won't print any error and won't exit.
 */

// dotenv/config is a side-effect import — it reads .env and populates
// process.env before any other module sees the environment.
import "dotenv/config";

import OpenAI from "openai";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { registerGenerateTool } from "./tools/generate.js";
import { registerEditTool } from "./tools/edit.js";
import { listContexts } from "./utils/context.js";

// ---------------------------------------------------------------------------
// 1. Validate required environment variable
// ---------------------------------------------------------------------------
if (!process.env.OPENAI_API_KEY) {
  // Write to stderr so the message appears in Claude Desktop's MCP logs.
  console.error(
    "[image-mcp] ERROR: OPENAI_API_KEY is not set.\n" +
      "Copy .env.example to .env and add your OpenAI API key.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Create the OpenAI client.
//    The OpenAI constructor automatically reads OPENAI_API_KEY from the
//    environment, so no manual key passing is required.
// ---------------------------------------------------------------------------
const openai = new OpenAI();

// ---------------------------------------------------------------------------
// 3. Create the MCP server.
//    name and version are reported to the client (Claude Desktop) during the
//    initial handshake.
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "image-mcp",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// 4. Register tools
// ---------------------------------------------------------------------------

// generate_image — text → image
registerGenerateTool(server, openai);

// edit_image — image + text → image
registerEditTool(server, openai);

// list_contexts — returns names and descriptions of all context presets.
// This tool has no parameters, so inputSchema is an empty object.
server.registerTool(
  "list_contexts",
  {
    title: "List Contexts",
    description:
      "List all available context presets from the /contexts directory. " +
      "Each context defines default style, quality, size, and prompt modifiers " +
      "for generate_image and edit_image.",
    inputSchema: {},  // no parameters
  },
  async () => {
    try {
      const contexts = listContexts();

      if (contexts.length === 0) {
        return {
          content: [{ type: "text", text: "No contexts found in /contexts directory." }],
        };
      }

      // Format as a simple readable list.
      const lines = contexts.map(
        ({ name, description }) => `• ${name}: ${description || "(no description)"}`,
      );

      return {
        content: [
          {
            type: "text",
            text: `Available contexts:\n${lines.join("\n")}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error listing contexts: ${err.message}` }],
      };
    }
  },
);

// ---------------------------------------------------------------------------
// 5. Connect to Claude Desktop via stdio transport.
//    StdioServerTransport reads MCP JSON-RPC messages from stdin and writes
//    responses to stdout.  This is the standard transport for local MCP
//    servers launched by Claude Desktop as a subprocess.
// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);

// The process now stays alive, waiting for MCP messages.  All logging should
// go to stderr (not stdout) to avoid corrupting the MCP message stream.

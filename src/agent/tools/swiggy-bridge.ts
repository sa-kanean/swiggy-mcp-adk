import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FunctionTool } from "@google/adk";
import type { Schema } from "@google/genai";
import { SERVICE_URLS } from "../../auth/swiggy-oauth.js";
import { currentContext } from "./context.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

// ─────────────────────────────────────────────────────────────
// Per-room MCP client + ADK FunctionTool wrappers
//
// Bypasses ADK's MCPToolset because it doesn't pass auth headers
// to StreamableHTTPClientTransport. We use the MCP SDK directly.
// ─────────────────────────────────────────────────────────────

interface RoomMCP {
  client: Client;
  transport: StreamableHTTPClientTransport;
  tools: FunctionTool[];
}

const roomClients = new Map<string, RoomMCP>();

/**
 * Connect to a Swiggy MCP endpoint for a room, discover tools,
 * and create ADK FunctionTool wrappers.
 */
export async function connectMCP(
  roomId: string,
  service: "delivery" | "dineout" | "cook",
  tokens: OAuthTokens
): Promise<FunctionTool[]> {
  // Clean up any prior connection for this room
  await disconnectMCP(roomId);

  const url = SERVICE_URLS[service];
  if (!url) throw new Error(`Unknown service: ${service}`);

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    },
  });

  const client = new Client(
    { name: "swiggy-valentine", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log(`[MCP Bridge] Connected to ${url} for room ${roomId}`);

  // Discover available tools
  const { tools: mcpTools } = await client.listTools();
  console.log(
    `[MCP Bridge] Discovered ${mcpTools.length} tools for room ${roomId}: ${mcpTools.map((t) => t.name).join(", ")}`
  );

  // Create ADK FunctionTool wrappers
  const adkTools = mcpTools.map((mcpTool) => {
    // Convert JSON Schema to Gemini Schema format
    const parameters = convertToGeminiSchema(mcpTool.inputSchema);

    return new FunctionTool({
      name: mcpTool.name,
      description: mcpTool.description || `Swiggy MCP tool: ${mcpTool.name}`,
      parameters,
      execute: async (args: unknown) => {
        // Look up the MCP client for the current room
        const roomMcp = roomClients.get(currentContext.roomId);
        if (!roomMcp) {
          return { error: "MCP client not connected for this room" };
        }

        try {
          const result = await roomMcp.client.callTool({
            name: mcpTool.name,
            arguments: (args as Record<string, unknown>) ?? {},
          });
          return result;
        } catch (err: any) {
          console.error(
            `[MCP Bridge] Tool ${mcpTool.name} failed:`,
            err.message
          );
          return { error: `Tool call failed: ${err.message}` };
        }
      },
    });
  });

  roomClients.set(roomId, { client, transport, tools: adkTools });
  return adkTools;
}

/**
 * Get the MCP tools for a room (empty array if not connected).
 */
export function getMCPTools(roomId: string): FunctionTool[] {
  return roomClients.get(roomId)?.tools ?? [];
}

/**
 * Disconnect and clean up MCP client for a room.
 */
export async function disconnectMCP(roomId: string): Promise<void> {
  const entry = roomClients.get(roomId);
  if (!entry) return;

  try {
    await entry.client.close();
  } catch {
    // Ignore close errors
  }
  roomClients.delete(roomId);
  console.log(`[MCP Bridge] Disconnected room ${roomId}`);
}

/**
 * Convert a JSON Schema object to a Gemini-compatible Schema.
 * The Gemini API accepts a subset of JSON Schema.
 *
 * Handles edge cases like:
 * - type as array: ["string", "null"] → "STRING" (nullable)
 * - missing type (e.g. allOf/anyOf/oneOf compositions)
 * - nested properties and items
 */
function convertToGeminiSchema(
  jsonSchema: Record<string, unknown> | undefined
): Schema | undefined {
  if (!jsonSchema) return undefined;

  const schema: Record<string, unknown> = {};

  // Handle type — may be string, array, or missing
  if (jsonSchema.type) {
    if (typeof jsonSchema.type === "string") {
      schema.type = jsonSchema.type.toUpperCase();
    } else if (Array.isArray(jsonSchema.type)) {
      // e.g. ["string", "null"] → pick the first non-null type
      const nonNull = jsonSchema.type.filter(
        (t: string) => t !== "null"
      );
      schema.type = nonNull.length > 0
        ? (nonNull[0] as string).toUpperCase()
        : "STRING";
      // Mark as nullable if "null" was in the array
      if (jsonSchema.type.includes("null")) {
        schema.nullable = true;
      }
    }
  }

  if (jsonSchema.properties) {
    schema.properties = {};
    const props = jsonSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    for (const [key, value] of Object.entries(props)) {
      const converted = convertToGeminiSchema(value);
      if (converted) {
        (schema.properties as Record<string, unknown>)[key] = converted;
      }
    }
  }

  if (jsonSchema.required) {
    schema.required = jsonSchema.required;
  }

  if (jsonSchema.description) {
    schema.description = jsonSchema.description;
  }

  if (jsonSchema.items) {
    schema.items = convertToGeminiSchema(
      jsonSchema.items as Record<string, unknown>
    );
  }

  if (jsonSchema.enum) {
    schema.enum = jsonSchema.enum;
  }

  // Default to OBJECT if there are properties but no explicit type
  if (!schema.type && schema.properties) {
    schema.type = "OBJECT";
  }

  return schema as Schema;
}

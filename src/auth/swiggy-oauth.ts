import {
  startAuthorization,
  exchangeAuthorization,
  registerClient as mcpRegisterClient,
  discoverOAuthMetadata,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

// ─────────────────────────────────────────────────────────────
// Swiggy OAuth2 + PKCE management
//
// Endpoints (confirmed via probing):
//   Metadata:      https://mcp.swiggy.com/.well-known/oauth-authorization-server
//   Authorization: https://mcp.swiggy.com/auth/authorize
//   Token:         https://mcp.swiggy.com/auth/token
//   Registration:  https://mcp.swiggy.com/auth/register  (RFC 7591)
//   PKCE: S256 required | Client auth: none (public client)
// ─────────────────────────────────────────────────────────────

const SWIGGY_AUTH_SERVER = "https://mcp.swiggy.com";
const REDIRECT_URI = "http://localhost:3000/auth/callback";
const SCOPE = "mcp:tools";

// Endpoint → MCP URL mapping
export const SERVICE_URLS: Record<string, string> = {
  delivery: "https://mcp.swiggy.com/food",
  dineout: "https://mcp.swiggy.com/dineout",
  cook: "https://mcp.swiggy.com/im",
};

// ── Stores ──

interface RoomAuth {
  tokens: OAuthTokens;
  codeVerifier: string;
}

// Per-room token + verifier store
const roomAuthStore = new Map<string, RoomAuth>();

// Pending PKCE verifiers (before code exchange)
const pendingVerifiers = new Map<string, string>();

// Client registration info (singleton)
let clientInfo: OAuthClientInformationFull | null = null;

// Cached server metadata
let serverMetadata: OAuthMetadata | undefined;

// ── Public API ──

/**
 * Dynamically register this app as an OAuth client with Swiggy's MCP auth server.
 * Call once at startup. Non-fatal if it fails.
 */
export async function registerOAuthClient(): Promise<void> {
  try {
    // Discover metadata first
    serverMetadata =
      (await discoverOAuthMetadata(SWIGGY_AUTH_SERVER)) ?? undefined;

    clientInfo = await mcpRegisterClient(SWIGGY_AUTH_SERVER, {
      metadata: serverMetadata,
      clientMetadata: {
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: "Swiggy Valentine Agent",
        scope: SCOPE,
      },
    });

    console.log(
      `[OAuth] Client registered: ${clientInfo.client_id}`
    );
  } catch (err: any) {
    console.warn(
      `[OAuth] Dynamic registration failed (${err.message}). Auth flow may still work if client_id is pre-configured.`
    );
    // Fall back to known client_id from discovery
    clientInfo = {
      client_id: "swiggy-mcp",
      redirect_uris: [REDIRECT_URI],
    } as OAuthClientInformationFull;
  }
}

/**
 * Generate an authorization URL for a given room.
 * Returns the URL the frontend should open.
 */
export async function getAuthorizationUrl(
  roomId: string
): Promise<string> {
  if (!clientInfo) {
    throw new Error("OAuth client not registered. Call registerOAuthClient() first.");
  }

  const { authorizationUrl, codeVerifier } = await startAuthorization(
    SWIGGY_AUTH_SERVER,
    {
      metadata: serverMetadata,
      clientInformation: clientInfo,
      redirectUrl: REDIRECT_URI,
      scope: SCOPE,
      state: roomId,
    }
  );

  // Store the verifier so we can use it when the callback arrives
  pendingVerifiers.set(roomId, codeVerifier);

  return authorizationUrl.toString();
}

/**
 * Exchange an authorization code for tokens.
 * Called from the /auth/callback route.
 */
export async function exchangeCode(
  code: string,
  roomId: string
): Promise<OAuthTokens> {
  if (!clientInfo) {
    throw new Error("OAuth client not registered.");
  }

  const codeVerifier = pendingVerifiers.get(roomId);
  if (!codeVerifier) {
    throw new Error(`No PKCE verifier found for room ${roomId}`);
  }

  const tokens = await exchangeAuthorization(SWIGGY_AUTH_SERVER, {
    metadata: serverMetadata,
    clientInformation: clientInfo,
    authorizationCode: code,
    codeVerifier,
    redirectUri: REDIRECT_URI,
  });

  // Store tokens for the room and clean up the verifier
  roomAuthStore.set(roomId, { tokens, codeVerifier });
  pendingVerifiers.delete(roomId);

  console.log(`[OAuth] Tokens acquired for room ${roomId}`);
  return tokens;
}

/**
 * Retrieve stored tokens for a room.
 */
export function getTokens(roomId: string): OAuthTokens | undefined {
  return roomAuthStore.get(roomId)?.tokens;
}

/**
 * Check if a room has valid tokens.
 */
export function hasTokens(roomId: string): boolean {
  return roomAuthStore.has(roomId);
}

/**
 * Clean up auth state for a room.
 */
export function clearRoomAuth(roomId: string): void {
  roomAuthStore.delete(roomId);
  pendingVerifiers.delete(roomId);
}

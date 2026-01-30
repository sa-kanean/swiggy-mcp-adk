# Swiggy Cupid — Valentine's Taste Match Agent

A working prototype of a **couple food-matching experience** powered by Google ADK (Agent Development Kit) for JavaScript, Gemini 3 Flash, and Swiggy's MCP (Model Context Protocol) endpoints.

Two partners join a room, upload selfies, take a 6-question food quiz, get a Taste Compatibility score with a **cartoon couple portrait** (generated via Gemini), pick an action (Order In / Dine Out / Cook Together), authenticate with Swiggy via OAuth2+PKCE, and then the AI agent uses **real Swiggy MCP tools** (search restaurants, browse menus, build carts, etc.) to help them plan their meal.

---

## Table of Contents

- [Demo Flow](#demo-flow)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Setup & Run](#setup--run)
- [Environment Variables](#environment-variables)
- [How It Works — Step by Step](#how-it-works--step-by-step)
  - [Phase 1: Quiz](#phase-1-quiz)
  - [Phase 2: Match Result](#phase-2-match-result)
  - [Phase 3: Swiggy OAuth](#phase-3-swiggy-oauth)
  - [Phase 4: MCP Tools](#phase-4-mcp-tools)
- [OAuth Integration Details](#oauth-integration-details)
- [MCP Bridge — Why We Bypass ADK's MCPToolset](#mcp-bridge--why-we-bypass-adks-mcptoolset)
- [Swiggy MCP Tools Available](#swiggy-mcp-tools-available)
- [API Reference](#api-reference)
- [WebSocket Protocol](#websocket-protocol)
- [Key Design Decisions](#key-design-decisions)
- [Known Limitations & Next Steps](#known-limitations--next-steps)
- [File-by-File Reference](#file-by-file-reference)

---

## Demo Flow

```
Partner A creates room → gets room code → shares with Partner B
                                ↓
Both partners join → WebSocket connects → Agent greets each privately
                                ↓
     Agent asks each partner to upload a selfie (camera button)
                                ↓
        6 food questions each (cuisine, spice, diet, budget, mood, dish)
                                ↓
    Both photos uploaded → Cartoon couple portrait generates in background
                                ↓
   Both quizzes complete → Match score calculated → Compatibility card
         shown with cartoon portrait + score + action buttons
                                ↓
     Either partner taps "Order In" / "Dine Out" / "Cook Together"
                                ↓
         "Connect Swiggy" button appears → OAuth popup opens
                                ↓
    User logs in with phone+OTP → Swiggy redirects back with auth code
                                ↓
   Server exchanges code for tokens → Connects to Swiggy MCP endpoint
                                ↓
      Agent now has 12 real Swiggy tools → Helps plan the meal
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (SPA)                               │
│  index.html — mobile-first UI, WebSocket client, OAuth popup        │
└───────────────┬─────────────────────────────────┬───────────────────┘
                │ WebSocket                       │ OAuth popup
                ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Node.js / Express Server                        │
│                                                                     │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐                │
│  │  Routes   │  │  WebSocket   │  │  Auth Callback │                │
│  │ REST API  │  │  Handler     │  │  /auth/callback│                │
│  └──────────┘  └──────┬───────┘  └───────┬────────┘                │
│                        │                  │                          │
│  ┌─────────────────────▼──────────────────▼────────────────────┐   │
│  │              Google ADK Runner                               │   │
│  │  ┌─────────────────────────────────────────────────────┐    │   │
│  │  │  LlmAgent "swiggy_cupid" (Gemini 3 Flash)            │    │   │
│  │  │                                                      │    │   │
│  │  │  Tools:                                              │    │   │
│  │  │  ├─ start_quiz, submit_answer, get_quiz_status       │    │   │
│  │  │  ├─ calculate_match, get_recipe                      │    │   │
│  │  │  ├─ get_photo_status                                 │    │   │
│  │  │  └─ [MCP tools injected after OAuth]                 │    │   │
│  │  └─────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐                        │
│  │  swiggy-oauth.ts │  │  swiggy-bridge.ts│                        │
│  │  OAuth2 + PKCE   │  │  MCP Client +    │                        │
│  │  Token Store     │  │  Tool Wrappers   │                        │
│  └────────┬─────────┘  └────────┬─────────┘                        │
└───────────┼──────────────────────┼──────────────────────────────────┘
            │                      │
            ▼                      ▼
┌───────────────────────────────────────────────────────┐
│           Swiggy MCP Server (mcp.swiggy.com)          │
│                                                       │
│  /food     — Food delivery (12 tools)                 │
│  /dineout  — Restaurant booking                       │
│  /im       — Instamart grocery delivery               │
│                                                       │
│  Auth: OAuth2 + PKCE (S256)                           │
│  Protocol: MCP over Streamable HTTP                   │
└───────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **AI Agent** | [Google ADK for JavaScript](https://github.com/google/adk-node) (`@google/adk`) |
| **LLM** | Gemini 3 Flash Preview via Gemini API |
| **Image Generation** | Gemini 3 Pro Image Preview (cartoon couple portraits) |
| **MCP Client** | [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) (StreamableHTTPClientTransport) |
| **Backend** | Node.js, Express, WebSocket (`ws`) |
| **Frontend** | Vanilla HTML/CSS/JS (single-page app) |
| **Auth** | OAuth 2.0 + PKCE (S256), RFC 7591 dynamic client registration |
| **Language** | TypeScript (ES2022, NodeNext modules) |

---

## Project Structure

```
src/
├── index.ts                          # Express server (10mb body limit), ADK Runner, startup
├── models/
│   └── types.ts                      # TypeScript interfaces, quiz questions, WS message types
├── server/
│   ├── middleware.ts                  # CORS, request validation
│   ├── routes.ts                     # REST API + photo upload + OAuth callback endpoint
│   └── websocket.ts                  # WebSocket handler, message routing, auth flow, cartoon + match orchestration
├── services/
│   ├── room.ts                       # Room CRUD (in-memory), partner photo storage
│   ├── quiz.ts                       # Quiz logic (next question, submit, completion)
│   └── cartoon.ts                    # Gemini 3 Pro image generation for cartoon couple portraits
├── auth/
│   └── swiggy-oauth.ts              # OAuth2+PKCE: registration, auth URL, code exchange, token store
├── agent/
│   ├── agent.ts                      # LlmAgent creation (Gemini 3 Flash Preview)
│   ├── instructions.ts               # System prompt loader
│   ├── prompts/
│   │   └── valentine.ts              # Full system prompt (with selfie + photo status instructions)
│   └── tools/
│       ├── context.ts                # AsyncLocalStorage for per-request roomId/userId
│       ├── quiz.ts                   # FunctionTools: start_quiz, submit_answer, get_quiz_status
│       ├── matching.ts               # FunctionTools: calculate_match, get_recipe
│       ├── photo.ts                  # FunctionTool: get_photo_status (check if both partners uploaded)
│       └── swiggy-bridge.ts          # Per-room MCP client, tool discovery, ADK FunctionTool wrappers
└── public/
    └── index.html                    # Full SPA frontend (5 screens, camera upload, WebSocket, OAuth popup)
```

---

## Setup & Run

### Prerequisites

- Node.js >= 18
- npm

### Install

```bash
git clone <this-repo>
cd swiggy-mcp
npm install
```

### Configure

Create a `.env` file:

```env
GOOGLE_GENAI_API_KEY=your_gemini_api_key_here
PORT=3000
```

You need a [Google AI Studio](https://aistudio.google.com/) API key with access to Gemini 3 Flash Preview and Gemini 3 Pro Image Preview.

### Run (development)

```bash
npm run dev
```

This uses `tsx` for on-the-fly TypeScript execution. The server starts at `http://localhost:3000`.

### Build & Run (production)

```bash
npm run build
npm start
```

### What happens on startup

1. OAuth client dynamically registers with `mcp.swiggy.com` (non-blocking — warns if it fails)
2. ADK agent created with quiz + matching tools (no MCP tools yet — those come after user auth)
3. Express server starts with REST API, WebSocket, and OAuth callback
4. Ready to accept connections

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_GENAI_API_KEY` | Yes | Gemini API key from Google AI Studio |
| `PORT` | No | Server port (default: `3000`) |

---

## How It Works — Step by Step

### Phase 1: Selfie Upload & Quiz

Each partner connects via WebSocket and gets their own private ADK session (`session_{roomId}_{userId}`). The agent:

1. Greets the partner and asks them to **upload a selfie** via the camera button
2. Guides them through 6 food questions using `FunctionTool` calls:
   - `start_quiz` — initializes, returns Question 1
   - `submit_answer(question_id, answer)` — records answer, returns next question
   - After Q6, partner's quiz is marked complete
3. Uses `get_photo_status` to check/remind about selfie uploads

Both partners can take the quiz simultaneously — no waiting. AsyncLocalStorage ensures each tool call sees the correct roomId/userId.

**Photo upload flow:** User taps camera button → selects/takes photo → uploaded via `POST /api/rooms/:roomId/photo` → preview shown in chat → WebSocket notification broadcast.

### Phase 1.5: Cartoon Generation (Background)

As soon as **both partners upload their selfies**, the server kicks off cartoon generation in the background:

1. Calls `generateCartoonCouple()` with both photos + names
2. Uses `gemini-3-pro-image-preview` with `responseModalities: ["IMAGE", "TEXT"]`
3. Generates an animated cartoon-style couple portrait (Valentine's themed)
4. Stores the result on the room object, ready for the match reveal

This runs in parallel with the quiz — by the time both quizzes complete, the cartoon is often already done.

### Phase 2: Match Result

When both partners complete the quiz:
1. Server calls `calculate_match` — scores each question (100 = same answer, 60 = compatible, 20 = different)
2. Waits for the pre-generated cartoon if still in flight
3. Broadcasts a `match_result` WebSocket event with compatibility percentage + cartoon image
4. Sends personalized recommendation messages to each partner
5. UI shows a match card with the cartoon portrait, score, and three action buttons: Order In, Dine Out, Cook Together

### Phase 3: Swiggy OAuth

When either partner taps an action button (e.g., "Order In"):

1. Server checks if the room has Swiggy tokens
2. If not, generates an OAuth2+PKCE authorization URL:
   - PKCE code verifier + challenge (S256) generated
   - State parameter = roomId (for routing the callback)
   - Redirect URI = `http://localhost:3000/auth/callback`
3. Sends `swiggy_auth_required` WebSocket event with the auth URL
4. Frontend shows "Connect Swiggy" button
5. User clicks → popup opens → Swiggy login (phone + OTP)
6. Swiggy redirects to `/auth/callback?code=X&state=ROOM_ID`
7. Server exchanges code for access + refresh tokens
8. Popup shows success, signals opener via `postMessage`, closes itself

### Phase 4: MCP Tools

After tokens are acquired:

1. Server creates an MCP `Client` + `StreamableHTTPClientTransport` with `Authorization: Bearer <token>`
2. Connects to the relevant endpoint:
   - "Order In" → `https://mcp.swiggy.com/food`
   - "Dine Out" → `https://mcp.swiggy.com/dineout`
   - "Cook Together" → `https://mcp.swiggy.com/im`
3. Calls `client.listTools()` — discovers available tools (e.g., 12 tools for Food)
4. Wraps each MCP tool as an ADK `FunctionTool` (converts JSON Schema → Gemini Schema)
5. Pushes tools into the agent's tools array
6. Broadcasts `swiggy_auth_complete` to all clients
7. Resumes the deferred action message — agent now has real Swiggy tools and can help

---

## OAuth Integration Details

### Endpoints (confirmed via probing)

| Endpoint | URL |
|----------|-----|
| Discovery | `https://mcp.swiggy.com/.well-known/oauth-authorization-server` |
| Authorization | `https://mcp.swiggy.com/auth/authorize` |
| Token | `https://mcp.swiggy.com/auth/token` |
| Registration | `https://mcp.swiggy.com/auth/register` (RFC 7591) |

### Configuration

| Parameter | Value |
|-----------|-------|
| PKCE | S256 (required) |
| Client auth | `none` (public client) |
| Scopes | `mcp:tools` |
| Grants | `authorization_code`, `refresh_token` |
| Whitelisted redirects | `http://localhost`, `http://localhost/callback` |
| Registered client_id | `swiggy-mcp` (from dynamic registration) |

### Token Storage

Tokens are stored in-memory per room (`Map<roomId, { tokens, codeVerifier }>`). In production, this should be replaced with a persistent store (Redis, database, etc.).

---

## MCP Bridge — Why We Bypass ADK's MCPToolset

The Google ADK's `MCPToolset` uses `MCPSessionManager.createSession()` internally, which creates a `StreamableHTTPClientTransport` **without passing auth headers**:

```js
// ADK source — no options object passed
await client.connect(new StreamableHTTPClientTransport(new URL(this.connectionParams.url)));
```

But the MCP SDK's `StreamableHTTPClientTransport` supports a `requestInit` option for custom headers:

```typescript
new StreamableHTTPClientTransport(new URL(url), {
  requestInit: {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  },
});
```

So `swiggy-bridge.ts` uses the MCP SDK directly to create an authenticated client, then wraps discovered tools as ADK `FunctionTool` instances. This gives us full control over the auth header while staying compatible with ADK's agent/runner system.

---

## Swiggy MCP Tools Available

After OAuth, the Food endpoint (`/food`) exposes these 12 tools:

| Tool | Description |
|------|-------------|
| `get_addresses` | Get user's saved delivery addresses |
| `search_restaurants` | Search restaurants by query, cuisine, etc. |
| `search_menu` | Search menu items within a restaurant |
| `get_food_cart` | Get current cart contents |
| `update_food_cart` | Add/remove items from cart |
| `flush_food_cart` | Empty the cart |
| `place_food_order` | Place an order |
| `fetch_food_coupons` | Get available discount coupons |
| `apply_food_coupon` | Apply a coupon to the cart |
| `get_food_orders` | Get order history |
| `get_food_order_details` | Get details of a specific order |
| `track_food_order` | Track a live order |

The Dineout (`/dineout`) and Instamart (`/im`) endpoints expose their own tool sets (restaurant booking, grocery search, etc.).

---

## API Reference

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/rooms` | Create a room. Body: `{ userId, name, phone }` |
| `GET` | `/api/rooms/:roomId` | Get room status, quiz progress, match result |
| `POST` | `/api/rooms/:roomId/join` | Join a room. Body: `{ userId, name, phone }` |
| `POST` | `/api/rooms/:roomId/photo` | Upload selfie. Body: `{ userId, photoData, mimeType }` (base64, max 10mb) |
| `GET` | `/auth/callback` | OAuth redirect handler. Query: `?code=X&state=ROOM_ID` |
| `GET` | `/health` | Health check |

### WebSocket

Connect to: `ws://localhost:3000/ws/{roomId}?userId={userId}`

---

## WebSocket Protocol

### Client → Server

```json
{ "type": "message", "text": "user's message here" }
```

### Server → Client

| Event | Fields | When |
|-------|--------|------|
| `agent_message` | `text` | Agent response (private during quiz, broadcast after action) |
| `partner_joined` | `partner.name` | Other partner connected |
| `quiz_update` | `status.partner1Complete`, `status.partner2Complete` | After each message |
| `photo_uploaded` | `photoUser` | A partner uploaded their selfie |
| `match_result` | `compatibility`, `recommendations[]`, `cartoonImage?` | Both quizzes done |
| `action_chosen` | `action`, `chosenBy` | Partner picks Order In / Dine Out / Cook |
| `swiggy_auth_required` | `authUrl` | OAuth needed before MCP connection |
| `swiggy_auth_complete` | — | OAuth done, MCP tools ready |
| `error` | `error` | Something went wrong |

---

## Key Design Decisions

### 1. Parallel Partner Sessions
Each partner gets an independent ADK session. No queue, no blocking. AsyncLocalStorage isolates context per request so tool calls always see the right roomId/userId.

### 2. Private Quiz, Public Post-Action
During the quiz, agent responses go only to the sender. After an action is chosen, responses broadcast to both partners so they plan the meal together.

### 3. Lazy MCP Connection
MCP tools are NOT loaded at startup. They're connected per-room after OAuth, for the specific endpoint the couple chose. This avoids 401 errors at boot and only authenticates when needed.

### 4. Tool Injection at Runtime (with Deduplication)
After MCP tools are discovered, they're pushed into the agent's shared tools array. Existing tools with the same name are replaced to avoid `"Duplicate function declaration"` errors when multiple rooms connect or reconnect. The LLM sees them in subsequent calls and can use them naturally.

### 5. Schema Conversion
MCP tools use JSON Schema for input definitions. Gemini requires its own Schema format (uppercase types). `convertToGeminiSchema()` handles the conversion, including edge cases like `type: ["string", "null"]` (nullable union types).

### 6. Background Cartoon Generation
Cartoon couple portraits are generated as soon as both selfies are uploaded — not when the quiz finishes. This runs in parallel with the quiz so the image is ready by the time the match result is broadcast. If generation fails, the match result is shown without the cartoon (graceful fallback).

### 7. Post-Action Context Injection
Each partner has a private agent session. When an action is chosen, the other partner's agent doesn't automatically know. To solve this, post-action messages are prefixed with a system context block telling the agent about the match result, chosen action, and available MCP tools. This prevents the agent from re-asking quiz questions or acting confused about the current state.

---

## Known Limitations & Next Steps

### Current Limitations

- **In-memory storage**: Rooms, sessions, and tokens are all in-memory. Server restart loses everything.
- **Single-server**: No horizontal scaling. WebSocket connections are local.
- **Token refresh**: Access token expiry is not handled (no automatic refresh flow yet).
- **Shared tool array**: MCP tools are pushed to a global agent tools array (deduplicated by name). If two rooms pick different actions, the latest tools replace the old. For production, tools should be scoped per-session.
- **Cartoon generation model**: Uses `gemini-3-pro-image-preview` which requires image generation access on the API key. The compatibility score in the cartoon prompt uses a placeholder (100) since the real score isn't known until after the quiz.
- **No HTTPS**: OAuth redirect uses `http://localhost:3000`. Production needs HTTPS.

### Production Recommendations

1. **Persistent storage** — Redis or a database for rooms, sessions, and OAuth tokens
2. **Per-session tool scoping** — Use ADK's session-level tool configuration instead of a global array
3. **Token refresh** — Implement `refreshAuthorization()` when access tokens expire
4. **HTTPS + real domain** — Required for production OAuth redirect URIs
5. **Mobile SDK integration** — The backend API (REST + WebSocket) is ready for mobile clients to consume. Replace the HTML frontend with native app screens.
6. **Rate limiting** — Add rate limits on API and WebSocket messages
7. **Error recovery** — Reconnect logic for MCP client disconnections
8. **Observability** — Structured logging, metrics, distributed tracing

---

## File-by-File Reference

| File | Purpose | Key Exports |
|------|---------|-------------|
| `src/index.ts` | Entry point. Express setup, ADK Runner init, OAuth registration, server start | — |
| `src/models/types.ts` | All TypeScript interfaces (`Partner`, `Room`, `MatchResult`, `WSServerMessage`), quiz questions. Partner includes `photoData`/`photoMimeType`; Room includes `cartoonImageBase64`; WSServerMessage includes `photo_uploaded`, `cartoonImage`, `photoUser` | `Partner`, `Room`, `QUIZ_QUESTIONS`, `WSServerMessage` |
| `src/server/routes.ts` | REST API endpoints + photo upload + OAuth callback | `router`, `authCallbackRouter` |
| `src/server/websocket.ts` | WebSocket lifecycle, message routing, auth flow trigger, background cartoon generation, match broadcasting, post-action context injection, MCP tool deduplication | `setupWebSocket`, `getNotifyAuthComplete`, `getNotifyPhotoUploaded` |
| `src/server/middleware.ts` | CORS headers, input validation for room create/join | `corsMiddleware`, `validateRoomCreate`, `validateRoomJoin` |
| `src/services/room.ts` | Room CRUD operations (in-memory Map), partner photo storage | `roomService` |
| `src/services/quiz.ts` | Quiz progression logic | `quizService` |
| `src/services/cartoon.ts` | Cartoon couple portrait generation via `gemini-3-pro-image-preview` with both partners' selfies | `generateCartoonCouple` |
| `src/auth/swiggy-oauth.ts` | OAuth2+PKCE: client registration, auth URL generation, code-for-token exchange, per-room token store | `registerOAuthClient`, `getAuthorizationUrl`, `exchangeCode`, `getTokens`, `hasTokens` |
| `src/agent/agent.ts` | Creates `LlmAgent` with Gemini 3 Flash Preview, quiz + matching + photo tools | `createValentineAgent`, `agentTools`, `cleanupAgent` |
| `src/agent/instructions.ts` | Loads system prompt for the agent | `getAgentInstructions` |
| `src/agent/prompts/valentine.ts` | Full system prompt (selfie upload instructions, photo status tool, quiz flow, compatibility messages) | `VALENTINE_SYSTEM_PROMPT` |
| `src/agent/tools/context.ts` | AsyncLocalStorage for per-request context isolation | `currentContext`, `runWithContext` |
| `src/agent/tools/quiz.ts` | `start_quiz`, `submit_answer`, `get_quiz_status` FunctionTools | `quizTools` |
| `src/agent/tools/matching.ts` | `calculate_match` (scoring algo), `get_recipe` FunctionTools | `matchingTools`, `calculateMatchTool` |
| `src/agent/tools/photo.ts` | `get_photo_status` FunctionTool — checks if both partners uploaded selfies | `photoTools` |
| `src/agent/tools/swiggy-bridge.ts` | Per-room MCP client creation, tool discovery, JSON Schema → Gemini Schema conversion, ADK FunctionTool wrapping | `connectMCP`, `getMCPTools`, `disconnectMCP` |
| `src/public/index.html` | Complete SPA: 5 screens, camera upload button, photo preview, cartoon in match card, Swiggy brand styling, WebSocket client, OAuth popup handling | — |

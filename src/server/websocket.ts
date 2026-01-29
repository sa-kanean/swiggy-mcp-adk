import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage, Server } from "http";
import { URL } from "url";
import { Runner, InMemorySessionService, isFinalResponse } from "@google/adk";
import type { Content } from "@google/genai";
import { LlmAgent } from "@google/adk";
import { roomService } from "../services/room.js";
import { WSServerMessage, Partner } from "../models/types.js";
import { runWithContext, setCurrentContext } from "../agent/tools/context.js";
import { getAuthorizationUrl, hasTokens, getTokens } from "../auth/swiggy-oauth.js";
import { connectMCP, disconnectMCP } from "../agent/tools/swiggy-bridge.js";
import { agentTools } from "../agent/agent.js";

// ─────────────────────────────────────────────────────────────
// Architecture:
//
// Each partner gets their OWN ADK session so both can chat
// with the agent simultaneously — no sequential queue needed.
//
// Session IDs: session_{roomId}_{userId}
//
// The agent interacts with each partner independently during
// the quiz. After both complete, the match result is broadcast
// to both via WebSocket.
//
// Agent responses go ONLY to the sender (private quiz chat).
// Shared events (partner_joined, quiz_update, match_result)
// are broadcast to both.
// ─────────────────────────────────────────────────────────────

interface RoomConnection {
  userId: string;
  ws: WebSocket;
}

const roomConnections = new Map<string, RoomConnection[]>();

// Track if match result was already sent for a room
const matchSent = new Set<string>();

// Pending action messages — deferred until OAuth completes
interface PendingAction {
  userId: string;
  text: string;
  ws: WebSocket;
}
const pendingActions = new Map<string, PendingAction>();

export function setupWebSocket(
  server: Server,
  agent: LlmAgent,
  sessionService: InMemorySessionService,
  runner: Runner
): WebSocketServer {
  const wss = new WebSocketServer({ server, path: undefined });

  server.removeAllListeners("upgrade");
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (!url.pathname.match(/^\/ws\/.+$/)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  // ── Action choice detection ──
  const ACTION_MAP: Record<string, "delivery" | "dineout" | "cook"> = {
    "Let's order in!": "delivery",
    "Let's dine out!": "dineout",
    "Let's cook together!": "cook",
  };

  const ACTION_LABELS: Record<string, string> = {
    delivery: "Order In",
    dineout: "Dine Out",
    cook: "Cook Together",
  };

  // ── Process a message for one partner ──
  async function processMessage(
    roomId: string,
    userId: string,
    senderWs: WebSocket,
    text: string
  ): Promise<void> {
    const room = roomService.getRoom(roomId);
    if (!room) return;

    const partner = roomService.getPartner(room, userId);
    const senderName = partner?.name ?? userId;

    // ── Intercept action choice messages ──
    const actionType = ACTION_MAP[text];
    if (actionType) {
      if (room.chosenAction) {
        // Already locked — inform the sender and continue to agent
        const label = ACTION_LABELS[room.chosenAction];
        sendToClient(senderWs, {
          type: "agent_message",
          text: `Your partner already chose ${label}! Let's go with that.`,
        });
        return;
      }

      // Lock the action
      room.chosenAction = actionType;
      room.chosenBy = userId;

      // Broadcast action_chosen to both partners
      broadcastToRoom(roomId, {
        type: "action_chosen",
        action: actionType,
        chosenBy: senderName,
      });

      // ── Check if we need OAuth ──
      if (!hasTokens(roomId)) {
        try {
          const authUrl = await getAuthorizationUrl(roomId);
          // Store the pending action so we can resume after auth
          pendingActions.set(roomId, { userId, text, ws: senderWs });
          // Send auth_required event to all clients in the room
          broadcastToRoom(roomId, {
            type: "swiggy_auth_required",
            authUrl,
          });
          console.log(`[WS] Auth required for room ${roomId}, sent auth URL`);
          return;
        } catch (err: any) {
          console.error("[WS] Failed to generate auth URL:", err);
          sendToClient(senderWs, {
            type: "error",
            error: "Failed to start Swiggy authentication. Please try again.",
          });
          return;
        }
      }

      // Already authed — connect MCP and continue
      await connectAndInjectTools(roomId, actionType);
    }

    // Run entire processing inside AsyncLocalStorage context
    // so all tool calls see the correct roomId/userId
    await runWithContext(roomId, userId, senderName, async () => {
      // Each partner has their own session
      const sessionId = `session_${roomId}_${userId}`;

      // Lazily create session
      const existing = await sessionService.getSession({
        appName: runner.appName,
        userId: userId,
        sessionId,
      });
      if (!existing) {
        const otherPartner =
          room.partner1.userId === userId ? room.partner2 : room.partner1;
        await sessionService.createSession({
          appName: runner.appName,
          userId: userId,
          sessionId,
          state: {
            roomId,
            partnerName: senderName,
            otherPartnerName: otherPartner?.name ?? "your partner",
          },
        });
      }

      const userContent: Content = {
        role: "user",
        parts: [{ text }],
      };

      try {
        // Re-read room to get latest chosenAction state
        const currentRoom = roomService.getRoom(roomId);
        const postAction = currentRoom?.chosenAction !== null;

        for await (const event of runner.runAsync({
          userId: userId,
          sessionId,
          newMessage: userContent,
          runConfig: { maxLlmCalls: 15 },
        })) {
          if (!isFinalResponse(event)) continue;
          if (!event.content?.parts) continue;

          const responseText = event.content.parts
            .filter((p: any) => p.text)
            .map((p: any) => p.text)
            .join("");

          if (responseText) {
            if (postAction) {
              // After action chosen: broadcast agent responses to both partners
              broadcastToRoom(roomId, { type: "agent_message", text: responseText });
            } else {
              // Before action chosen: send only to sender (private quiz chat)
              sendToClient(senderWs, { type: "agent_message", text: responseText });
            }
          }
        }

        // After processing, check quiz state and broadcast updates
        const updated = roomService.getRoom(roomId);
        if (!updated) return;

        const p1Complete = updated.partner1.quizComplete;
        const p2Complete = updated.partner2?.quizComplete ?? false;

        broadcastToRoom(roomId, {
          type: "quiz_update",
          status: { partner1Complete: p1Complete, partner2Complete: p2Complete },
        });

        // If both partners just completed the quiz, calculate match
        if (p1Complete && p2Complete && !matchSent.has(roomId)) {
          matchSent.add(roomId);

          const { calculateMatchTool } = await import("../agent/tools/matching.js");
          const matchResult = await calculateMatchTool.runAsync({
            args: {},
            toolContext: {} as any,
          });

          const result = matchResult as any;
          if (result && !result.error) {
            // Broadcast the match_result event (UI card) to both
            broadcastToRoom(roomId, {
              type: "match_result",
              compatibility: result.compatibility,
              recommendations: updated.matchResult?.recommendations ?? [],
            });

            // Send personalized reveal + next-step messages to each partner
            const p1 = updated.partner1;
            const p2 = updated.partner2!;
            const compat = result.compatibility;
            const breakdown: Array<{ category: string; partner1: string; partner2: string; matchScore: number }> =
              result.breakdown ?? [];

            sendPersonalizedReveal(roomId, p1, p2, compat, breakdown);
            sendPersonalizedReveal(roomId, p2, p1, compat, breakdown);
          }
        }
      } catch (err) {
        console.error("[WS] Error processing message:", err);
        sendToClient(senderWs, {
          type: "error",
          error: "Something went wrong. Please try again.",
        });
      }
    });
  }

  /**
   * Connect MCP for the given room+action and inject tools into the agent.
   */
  async function connectAndInjectTools(
    roomId: string,
    actionType: "delivery" | "dineout" | "cook"
  ): Promise<void> {
    const tokens = getTokens(roomId);
    if (!tokens) return;

    try {
      const mcpTools = await connectMCP(roomId, actionType, tokens);
      // Push MCP tools into the shared agent tools array
      // so the LLM can use them in subsequent calls
      for (const tool of mcpTools) {
        agentTools.push(tool);
      }
      console.log(
        `[WS] Injected ${mcpTools.length} MCP tools for room ${roomId}`
      );
    } catch (err: any) {
      console.error(`[WS] Failed to connect MCP for room ${roomId}:`, err);
      broadcastToRoom(roomId, {
        type: "error",
        error: "Failed to connect to Swiggy. The agent will use built-in suggestions instead.",
      });
    }
  }

  /**
   * Called from the auth callback route after tokens are acquired.
   * Resumes the deferred action flow.
   */
  async function notifyAuthCompleteForRoom(roomId: string): Promise<void> {
    // Notify all clients
    broadcastToRoom(roomId, { type: "swiggy_auth_complete" });

    const pending = pendingActions.get(roomId);
    if (!pending) return;
    pendingActions.delete(roomId);

    const room = roomService.getRoom(roomId);
    if (!room || !room.chosenAction) return;

    // Connect MCP with the chosen action
    await connectAndInjectTools(roomId, room.chosenAction);

    // Resume the original message processing
    void processMessage(roomId, pending.userId, pending.ws, pending.text);
  }

  // Expose notifyAuthComplete so the route handler can call it
  (setupWebSocket as any)._notifyAuthComplete = notifyAuthCompleteForRoom;

  // ── Connection handler ──
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const roomId = url.pathname.match(/^\/ws\/(.+)$/)?.[1];
    const userId = url.searchParams.get("userId");

    if (!roomId || !userId) {
      ws.close(4000, "Missing roomId or userId");
      return;
    }

    const room = roomService.getRoom(roomId);
    if (!room) {
      ws.close(4004, "Room not found");
      return;
    }

    if (!roomService.isUserInRoom(room, userId)) {
      ws.close(4003, "User not in this room");
      return;
    }

    if (!roomConnections.has(roomId)) roomConnections.set(roomId, []);
    roomConnections.get(roomId)!.push({ userId, ws });

    console.log(`[WS] ${userId} connected to room ${roomId}`);

    // Notify the OTHER partner
    const partnerInfo = roomService.getPartner(room, userId);
    if (partnerInfo && room.partner2) {
      broadcastToRoomExcept(roomId, userId, {
        type: "partner_joined",
        partner: { name: partnerInfo.name },
      });
    }

    // ── Incoming messages — process directly (no queue needed) ──
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "message" && msg.text) {
          // Fire and forget — each partner has their own session
          void processMessage(roomId, userId, ws, msg.text);
        }
      } catch (err) {
        console.error("[WS] Bad message format:", err);
      }
    });

    ws.on("close", () => {
      console.log(`[WS] ${userId} disconnected from room ${roomId}`);
      const conns = roomConnections.get(roomId);
      if (conns) {
        const idx = conns.findIndex((c) => c.userId === userId && c.ws === ws);
        if (idx >= 0) conns.splice(idx, 1);
        if (conns.length === 0) {
          roomConnections.delete(roomId);
          matchSent.delete(roomId);
          // Clean up MCP connection when room empties
          void disconnectMCP(roomId);
        }
      }
    });

    ws.on("error", (err) => {
      console.error(`[WS] Error for ${userId} in room ${roomId}:`, err);
    });
  });

  return wss;
}

/**
 * Get the notifyAuthComplete function.
 * Must be called after setupWebSocket.
 */
export function getNotifyAuthComplete(): ((roomId: string) => Promise<void>) | undefined {
  return (setupWebSocket as any)._notifyAuthComplete;
}

function broadcastToRoom(roomId: string, message: WSServerMessage): void {
  const conns = roomConnections.get(roomId);
  if (!conns) return;
  const data = JSON.stringify(message);
  for (const c of conns) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }
}

function broadcastToRoomExcept(
  roomId: string,
  excludeUserId: string,
  message: WSServerMessage
): void {
  const conns = roomConnections.get(roomId);
  if (!conns) return;
  const data = JSON.stringify(message);
  for (const c of conns) {
    if (c.userId !== excludeUserId && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(data);
    }
  }
}

function sendToClient(ws: WebSocket, message: WSServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendToUser(roomId: string, userId: string, message: WSServerMessage): void {
  const conns = roomConnections.get(roomId);
  if (!conns) return;
  const data = JSON.stringify(message);
  for (const c of conns) {
    if (c.userId === userId && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(data);
    }
  }
}

interface BreakdownEntry {
  category: string;
  partner1: string;
  partner2: string;
  matchScore: number;
}

function sendPersonalizedReveal(
  roomId: string,
  me: Partner,
  them: Partner,
  compatibility: number,
  breakdown: BreakdownEntry[]
): void {
  // Pull this partner's answers by category for personalized suggestions
  const myAnswers: Record<string, string> = {};
  const theirAnswers: Record<string, string> = {};
  for (const b of breakdown) {
    // breakdown has partner1/partner2 in room order, figure out which is "me"
    const meIsP1 = me.quizAnswers.some(
      (a) => a.answer === b.partner1
    );
    myAnswers[b.category] = meIsP1 ? b.partner1 : b.partner2;
    theirAnswers[b.category] = meIsP1 ? b.partner2 : b.partner1;
  }

  const myCuisine = myAnswers["cuisine"] ?? "your favorite cuisine";
  const theirCuisine = theirAnswers["cuisine"] ?? "their favorite cuisine";
  const myMood = myAnswers["mood"] ?? "";
  const myBudget = myAnswers["budget"] ?? "";
  const myDish = myAnswers["dish_type"] ?? "";
  const theirDish = theirAnswers["dish_type"] ?? "";

  // Compatibility headline
  let headline: string;
  if (compatibility >= 80) {
    headline = `${me.name} & ${them.name}, your Taste Compatibility is ${compatibility}%! You two are a PERFECT food match!`;
  } else if (compatibility >= 50) {
    headline = `${me.name} & ${them.name}, your Taste Compatibility is ${compatibility}%! A wonderful blend of shared favorites and exciting differences!`;
  } else {
    headline = `${me.name} & ${them.name}, your Taste Compatibility is ${compatibility}%! Opposites attract — time to explore each other's food worlds!`;
  }

  // Personalized options based on this partner's mood, cuisine, budget, dish prefs
  const options: string[] = [];

  // Option 1: Order In — tailored to their cuisine + dish preference
  if (myMood === "Cozy & Romantic" || myMood === "Home-cooked") {
    options.push(
      `1. **Order In** — A cozy ${myCuisine} dinner delivered to your door. ` +
      (myDish === theirDish
        ? `You both love ${myDish} — perfect!`
        : `You love ${myDish}, ${them.name} loves ${theirDish} — order both!`)
    );
  } else {
    options.push(
      `1. **Order In** — Get ${myCuisine} delivered via Swiggy. ` +
      (myDish === theirDish
        ? `You're both craving ${myDish}!`
        : `Mix it up: ${myDish} for you, ${theirDish} for ${them.name}.`)
    );
  }

  // Option 2: Dine Out — tailored to mood + budget
  if (myMood === "Fine Dining" || myBudget === "₹1200+" || myBudget === "₹700-1200") {
    options.push(
      `2. **Dine Out** — Book a table at a premium ${myCuisine} restaurant via Swiggy Dineout. ` +
      `${them.name}'s into ${theirCuisine} — find a place that does both!`
    );
  } else if (myMood === "Fun & Casual") {
    options.push(
      `2. **Dine Out** — Hit up a fun, casual ${myCuisine} spot together. ` +
      `Budget-friendly and great vibes!`
    );
  } else {
    options.push(
      `2. **Dine Out** — Find the perfect ${myCuisine} restaurant on Swiggy Dineout. ` +
      `A Valentine's dinner to remember!`
    );
  }

  // Option 3: Cook Together — tailored to dish + diet
  const myDiet = myAnswers["diet"] ?? "";
  const dietNote =
    myDiet === "Veg" || myDiet === "Vegan"
      ? ` (${myDiet.toLowerCase()}-friendly of course!)`
      : "";
  if (myMood === "Home-cooked" || myMood === "Cozy & Romantic") {
    options.push(
      `3. **Cook Together** — Make a homemade ${myDish} feast${dietNote}. ` +
      `Get ingredients from Swiggy Instamart and cook with love!`
    );
  } else {
    options.push(
      `3. **Cook Together** — Try your hand at a ${myCuisine}-inspired ${myDish} dish${dietNote}. ` +
      `Instamart delivers the ingredients, you bring the romance!`
    );
  }

  const text = `The results are in...\n\n${headline}\n\nHere's what I'd suggest for you, ${me.name}:\n\n${options.join("\n\n")}\n\nTalk it over and decide together — Order In, Dine Out, or Cook Together? Either of you can tap to lock in your choice.`;

  sendToUser(roomId, me.userId, { type: "agent_message", text });
}

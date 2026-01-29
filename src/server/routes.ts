import { Router } from "express";
import { roomService } from "../services/room.js";
import { validateRoomCreate, validateRoomJoin } from "./middleware.js";
import { exchangeCode } from "../auth/swiggy-oauth.js";
import { getNotifyAuthComplete, getNotifyPhotoUploaded } from "./websocket.js";

export const router = Router();
export const authCallbackRouter = Router();

// Create a new room
router.post("/rooms", validateRoomCreate, (req, res) => {
  const { userId, name, phone } = req.body;
  const room = roomService.createRoom(userId, name, phone);
  res.status(201).json({
    roomId: room.roomId,
    sessionId: room.sessionId,
    partner1: {
      userId: room.partner1.userId,
      name: room.partner1.name,
    },
    createdAt: room.createdAt,
    wsUrl: `/ws/${room.roomId}`,
  });
});

// Get room status
router.get("/rooms/:roomId", (req, res) => {
  const roomId = req.params.roomId as string;
  const room = roomService.getRoom(roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  res.json({
    roomId: room.roomId,
    partner1: {
      name: room.partner1.name,
      userId: room.partner1.userId,
      quizComplete: room.partner1.quizComplete,
      answeredCount: room.partner1.quizAnswers.length,
    },
    partner2: room.partner2
      ? {
          name: room.partner2.name,
          userId: room.partner2.userId,
          quizComplete: room.partner2.quizComplete,
          answeredCount: room.partner2.quizAnswers.length,
        }
      : null,
    matchResult: room.matchResult,
    createdAt: room.createdAt,
  });
});

// Join a room
router.post("/rooms/:roomId/join", validateRoomJoin, (req, res) => {
  const { userId, name, phone } = req.body;
  const roomId = req.params.roomId as string;
  const { room, error } = roomService.joinRoom(
    roomId,
    userId,
    name,
    phone
  );

  if (!room) {
    res.status(400).json({ error });
    return;
  }

  res.json({
    roomId: room.roomId,
    partner1: { name: room.partner1.name, userId: room.partner1.userId },
    partner2: room.partner2
      ? { name: room.partner2.name, userId: room.partner2.userId }
      : null,
    wsUrl: `/ws/${room.roomId}`,
  });
});

// Upload photo for a partner
router.post("/rooms/:roomId/photo", (req, res) => {
  const roomId = req.params.roomId as string;
  const { userId, photoData, mimeType } = req.body;

  if (!userId || !photoData || !mimeType) {
    res.status(400).json({ error: "Missing userId, photoData, or mimeType" });
    return;
  }

  const room = roomService.getRoom(roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  if (!roomService.isUserInRoom(room, userId)) {
    res.status(403).json({ error: "User not in this room" });
    return;
  }

  const partner = roomService.getPartner(room, userId);
  if (!partner) {
    res.status(404).json({ error: "Partner not found" });
    return;
  }

  partner.photoData = photoData;
  partner.photoMimeType = mimeType;

  // Notify via WebSocket
  const notify = getNotifyPhotoUploaded();
  if (notify) {
    void notify(roomId, userId);
  }

  res.json({ success: true, message: "Photo uploaded" });
});

// OAuth callback from Swiggy — receives ?code=X&state=ROOM_ID
// Mounted at /auth so full path is /auth/callback
authCallbackRouter.get("/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined; // roomId

  if (!code || !state) {
    res.status(400).send(callbackPage("Missing code or state parameter.", false));
    return;
  }

  const roomId = state;

  try {
    await exchangeCode(code, roomId);

    // Notify WebSocket clients that auth is complete
    const notify = getNotifyAuthComplete();
    if (notify) {
      void notify(roomId);
    }

    res.send(callbackPage("Connected to Swiggy! You can close this window.", true));
  } catch (err: any) {
    console.error("[Auth Callback] Token exchange failed:", err);
    res.status(500).send(callbackPage(`Authentication failed: ${err.message}`, false));
  }
});

/**
 * Generate a small HTML page for the OAuth callback popup.
 * On success, it signals the opener window and closes itself.
 */
function callbackPage(message: string, success: boolean): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Swiggy Auth</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0;
      background: ${success ? "#e8f5e9" : "#ffebee"};
      color: #333;
    }
    .card {
      text-align: center; padding: 2rem;
      background: white; border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      max-width: 400px;
    }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h2 { margin: 0 0 0.5rem; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? "&#9989;" : "&#10060;"}</div>
    <h2>${success ? "Success!" : "Error"}</h2>
    <p>${message}</p>
  </div>
  <script>
    ${success ? `
    // Signal the opener window
    if (window.opener) {
      window.opener.postMessage({ type: 'swiggy_auth_complete' }, '*');
      setTimeout(() => window.close(), 1500);
    }
    ` : ""}
  </script>
</body>
</html>`;
}

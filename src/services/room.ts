import { v4 as uuidv4 } from "uuid";
import { Room, Partner } from "../models/types.js";

class RoomService {
  private rooms = new Map<string, Room>();

  createRoom(userId: string, name: string, phone: string): Room {
    const roomId = uuidv4().slice(0, 8);
    const sessionId = `session_${roomId}`;

    const room: Room = {
      roomId,
      partner1: {
        userId,
        name,
        phone,
        quizAnswers: [],
        quizComplete: false,
      },
      partner2: null,
      matchResult: null,
      sessionId,
      createdAt: Date.now(),
      chosenAction: null,
      chosenBy: null,
    };

    this.rooms.set(roomId, room);
    return room;
  }

  joinRoom(
    roomId: string,
    userId: string,
    name: string,
    phone: string
  ): { room: Room | null; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { room: null, error: "Room not found" };
    }
    if (room.partner2) {
      return { room: null, error: "Room is full" };
    }
    if (room.partner1.userId === userId) {
      return { room: null, error: "You are already in this room" };
    }

    room.partner2 = {
      userId,
      name,
      phone,
      quizAnswers: [],
      quizComplete: false,
    };

    return { room };
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getPartner(room: Room, userId: string): Partner | null {
    if (room.partner1.userId === userId) return room.partner1;
    if (room.partner2?.userId === userId) return room.partner2;
    return null;
  }

  isUserInRoom(room: Room, userId: string): boolean {
    return (
      room.partner1.userId === userId || room.partner2?.userId === userId
    );
  }

  listRooms(): Room[] {
    return Array.from(this.rooms.values());
  }
}

export const roomService = new RoomService();

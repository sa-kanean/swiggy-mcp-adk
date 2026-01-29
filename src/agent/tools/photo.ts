import { FunctionTool } from "@google/adk";
import { z } from "zod";
import { roomService } from "../../services/room.js";
import { currentContext } from "./context.js";

export const getPhotoStatusTool = new FunctionTool({
  name: "get_photo_status",
  description:
    "Check if both partners have uploaded their selfie photos. Returns upload status for each partner.",
  parameters: z.object({}),
  execute: async () => {
    const room = roomService.getRoom(currentContext.roomId);
    if (!room) return { error: "Room not found" };

    return {
      partner1: {
        name: room.partner1.name,
        photoUploaded: room.partner1.photoData !== null,
      },
      partner2: room.partner2
        ? {
            name: room.partner2.name,
            photoUploaded: room.partner2.photoData !== null,
          }
        : null,
      bothUploaded:
        room.partner1.photoData !== null &&
        (room.partner2?.photoData !== null && room.partner2 !== null),
    };
  },
});

export const photoTools = [getPhotoStatusTool];

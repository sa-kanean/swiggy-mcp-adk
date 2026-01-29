import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Server-side context for the currently processing message.
 * Uses AsyncLocalStorage so parallel partner sessions each
 * get their own isolated context — no race conditions.
 */

interface MessageContext {
  roomId: string;
  userId: string;
  senderName: string;
}

const contextStorage = new AsyncLocalStorage<MessageContext>();

/**
 * Read the current context. Throws if called outside runWithContext.
 */
export const currentContext: MessageContext = new Proxy(
  {} as MessageContext,
  {
    get(_target, prop: string) {
      const ctx = contextStorage.getStore();
      if (!ctx) throw new Error("currentContext accessed outside of runWithContext");
      return (ctx as any)[prop];
    },
  }
);

/**
 * Run a callback with the given context. All tools executed inside
 * the callback will see this context via `currentContext`.
 */
export function runWithContext(
  roomId: string,
  userId: string,
  senderName: string,
  fn: () => Promise<void>
): Promise<void> {
  return contextStorage.run({ roomId, userId, senderName }, fn);
}

/** @deprecated Use runWithContext instead. Kept for match calculation outside async context. */
export function setCurrentContext(roomId: string, userId: string, senderName: string) {
  // This is only safe when called inside runWithContext (overrides the store value)
  const ctx = contextStorage.getStore();
  if (ctx) {
    ctx.roomId = roomId;
    ctx.userId = userId;
    ctx.senderName = senderName;
  }
}

import { LlmAgent, BaseTool, BaseToolset } from "@google/adk";
import { quizTools } from "./tools/quiz.js";
import { matchingTools } from "./tools/matching.js";
import { getAgentInstructions } from "./instructions.js";

type ToolUnion = BaseTool | BaseToolset;

/**
 * The agent's tools array — starts with quiz + matching only.
 * MCP tools are pushed here per-room after OAuth completes.
 */
export let agentTools: ToolUnion[] = [];

export async function createValentineAgent(): Promise<LlmAgent> {
  agentTools = [...quizTools, ...matchingTools];

  const agent = new LlmAgent({
    name: "swiggy_cupid",
    description:
      "Swiggy Cupid — Valentine's Day food matchmaker that helps couples discover their taste compatibility and plan the perfect meal together.",
    model: "gemini-2.5-pro",
    instruction: getAgentInstructions(),
    tools: agentTools,
  });

  return agent;
}

export async function cleanupAgent(): Promise<void> {
  // MCP connections are cleaned up per-room by swiggy-bridge.ts
  // Nothing to clean up at agent level anymore
}

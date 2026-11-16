/**
 * La chiamata `contextBrief` (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §4.1, §4.3): un passo, un oggetto,
 * nessun tool. Nel prompt entrano solo fatti «Per tutti». Chi chiama ha già controllato l'ok ai sub-responsabili.
 */
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { CLAUDE_MODEL, claudeCallSettings, throwIfRefused } from "../../ai/models.ts";
import { contextBriefSchema } from "./prompt.ts";

/** Scrive le righe di «In breve». `workspaceId` va solo nel contesto del log di un rifiuto. */
export async function generateContextBrief(i: { system: string; prompt: string; abortSignal: AbortSignal; workspaceId: string }): Promise<{ righe: string[] }> {
  const { object } = await throwIfRefused("context/brief", generateObject({
    model: anthropic(CLAUDE_MODEL),
    schema: contextBriefSchema,
    system: i.system,
    prompt: i.prompt,
    abortSignal: i.abortSignal,
    ...claudeCallSettings("contextBrief"),
  }), { workspaceId: i.workspaceId });
  return object;
}

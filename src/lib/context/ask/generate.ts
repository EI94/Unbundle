/**
 * La chiamata `contextAsk` (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §4.1, §4.4): un passo, un oggetto,
 * nessun tool. Chi chiama ha già scelto i brani che chi chiede può vedere e controllato l'ok ai sub-responsabili.
 */
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { CLAUDE_MODEL, claudeCallSettings, throwIfRefused } from "../../ai/models.ts";
import { contextAskSchema } from "./prompt.ts";

/** Risponde a una domanda dai brani. `workspaceId` va solo nel contesto del log di un rifiuto. */
export async function generateContextAsk(i: { system: string; prompt: string; abortSignal: AbortSignal; workspaceId: string }): Promise<{ saputo: boolean; risposta: string; fonti: number[] }> {
  const { object } = await throwIfRefused("context/ask", generateObject({
    model: anthropic(CLAUDE_MODEL),
    schema: contextAskSchema,
    system: i.system,
    prompt: i.prompt,
    abortSignal: i.abortSignal,
    ...claudeCallSettings("contextAsk"),
  }), { workspaceId: i.workspaceId });
  return object;
}

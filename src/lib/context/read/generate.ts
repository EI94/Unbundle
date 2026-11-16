/**
 * La chiamata `contextRead` (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §4.1): un passo, un oggetto, nessun
 * tool. Il modello non può fare niente, solo proporre; ogni proposta passa poi dalle regole di `reconcile.ts` e la
 * conferma una persona. Chi chiama ha già controllato l'ok ai sub-responsabili (`contextAiConsent`).
 */
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { CLAUDE_MODEL, claudeCallSettings, throwIfRefused } from "../../ai/models.ts";
import { contextReadSchema, type ContextReadOutput } from "./schema.ts";

/** Legge una parte di un appunto. `workspaceId` va solo nel contesto del log di un rifiuto. */
export async function generateContextRead(i: { system: string; prompt: string; abortSignal: AbortSignal; workspaceId: string }): Promise<ContextReadOutput> {
  const { object } = await throwIfRefused("context/read", generateObject({
    model: anthropic(CLAUDE_MODEL),
    schema: contextReadSchema,
    system: i.system,
    prompt: i.prompt,
    abortSignal: i.abortSignal,
    ...claudeCallSettings("contextRead"),
  }), { workspaceId: i.workspaceId });
  return object;
}

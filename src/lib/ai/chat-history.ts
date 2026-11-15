/**
 * La storia della chat che arriva dal browser, come la vuole streamText: un messaggio di testo per turno.
 * Modulo puro (lo importano anche i test con Node).
 *
 * Tre regole nate con Claude Sonnet 5.5 (src/lib/ai/models.ts):
 * - un turno senza testo si toglie. Il browser rimanda solo le parti di testo, quindi un turno
 *   dell'assistente rifiutato dal modello, o fatto di soli tool, arriverebbe vuoto: l'API risponde 400
 *   a un blocco di testo vuoto e la chat resterebbe ferma fino al ricaricamento della pagina;
 * - passano solo i ruoli `user` e `assistant`. Questo modello accetta messaggi `system` dentro la
 *   conversazione, con l'autorità delle istruzioni dell'app: dal browser non devono arrivare;
 * - del turno resta solo il testo: le parti di ragionamento (le note tra i tool, con le loro firme) si tolgono
 *   intere. Un blocco di ragionamento vale solo nella conversazione che l'ha prodotto, e toglierli tutti è ammesso;
 *   modificarne uno no. Dentro il giro dei tool di un turno li rimanda l'SDK, uguali.
 */
export type ChatHistoryMessage = { role: "user" | "assistant"; content: string };

function extractContent(msg: Record<string, unknown>): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.parts)) {
    return (msg.parts as Array<{ type?: string; text?: string }>)
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join("");
  }
  return "";
}

export function chatHistory(rawMessages: Array<Record<string, unknown>>): ChatHistoryMessage[] {
  return rawMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as ChatHistoryMessage["role"], content: extractContent(m) }))
    .filter((m) => m.content.trim().length > 0);
}

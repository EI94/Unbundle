import type { UIMessage } from "ai";

/**
 * Che cosa la chat (chat-interface.tsx) mostra di un messaggio e che cosa rimanda alla rotta. Le decisioni stanno
 * qui; il componente le traduce in markup e basta. Modulo puro: lo importano anche i test con Node.
 */

/** I metadati che la rotta della chat mette sulla risposta: perché il modello si è fermato. */
export type ChatMessageMetadata = { finishReason?: string };
export type ChatUIMessage = UIMessage<ChatMessageMetadata>;

type PartLike = { type: string; text?: string; toolName?: unknown; state?: unknown; output?: unknown };
type MessageLike = { role: string; metadata?: unknown; parts?: ReadonlyArray<PartLike> };

/** Al posto di una risposta che il modello ha rifiutato. */
export const CHAT_REFUSAL_NOTICE = "Non posso rispondere a questa richiesta. Prova a riformularla.";

/**
 * Una risposta rifiutata dai classificatori del modello (finishReason «content-filter»): il suo testo parziale non
 * si mostra come una risposta finita e non torna al modello nel turno dopo.
 */
export function isRefusedReply(message: MessageLike): boolean {
  return message.role === "assistant" && (message.metadata as ChatMessageMetadata | undefined)?.finishReason === "content-filter";
}

/** Il testo di un messaggio: le sole parti di testo, unite. */
export function messageText(message: MessageLike): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/**
 * Che cosa il browser rimanda alla rotta: un turno di testo per messaggio, senza le risposte rifiutate e senza le
 * domande che le hanno avute: i turni dell'utente subito prima, che il modello riceve uniti (dopo un turno interrotto
 * sono più d'uno). Una risposta senza testo tra loro non li separa: al modello non arriva (chatHistory, in
 * src/lib/ai/chat-history.ts). Altrimenti la domanda rifiutata tornerebbe al modello unita alla domanda dopo, a ogni
 * turno. A schermo restano tutte, fino al ricaricamento della pagina; la rotta toglie le stesse domande anche dai
 * messaggi salvati.
 */
export function chatRequestMessages(messages: readonly MessageLike[]): Array<{ role: string; content: string }> {
  const kept: MessageLike[] = [];
  const mergedWithRefused = (message: MessageLike) => message.role === "user" || messageText(message).trim() === "";
  for (const message of messages) {
    if (!isRefusedReply(message)) {
      kept.push(message);
      continue;
    }
    while (kept.length > 0 && mergedWithRefused(kept[kept.length - 1])) kept.pop();
  }
  return kept.map((message) => ({ role: message.role, content: messageText(message) }));
}

/**
 * Il corpo della richiesta alla rotta della chat (prepareSendMessagesRequest in chat-interface.tsx): i turni di
 * chatRequestMessages e il contesto della chat, dal corpo della richiesta o, se manca, da quello del componente.
 */
export function chatTransportBody(
  messages: readonly MessageLike[],
  body: Record<string, unknown> | undefined,
  context: { workspaceId: string; conversationType: string; departmentId?: string },
) {
  return {
    messages: chatRequestMessages(messages),
    workspaceId: body?.workspaceId ?? context.workspaceId,
    conversationType: body?.conversationType ?? context.conversationType,
    departmentId: body?.departmentId ?? context.departmentId,
  };
}

/** Il nome del tool di una parte `tool-…` del messaggio. */
export function toolNameOf(part: { type: string; toolName?: unknown }): string {
  if (typeof part.toolName === "string" && part.toolName.length > 0) return part.toolName;
  return part.type.startsWith("tool-") ? part.type.slice(5) : "tool";
}

/** Il testo che l'API mette (in inglese) al posto di una nota interrotta dal limite dei token: non è un avanzamento. */
const INTERRUPTED_UPDATE = "This part of the response was interrupted before it finished.";

/** Una nota di avanzamento o un tool visibile, nell'ordine della risposta. */
export type ProgressItem<P> = { kind: "note"; text: string } | { kind: "tool"; part: P };

/**
 * Le note di avanzamento e i tool visibili di una risposta, nell'ordine in cui sono arrivati. Con Claude Sonnet 5.5
 * (e `display: "updates"`, src/lib/ai/models.ts) la nota che il modello scrive tra un tool e l'altro arriva come
 * parte di ragionamento, subito prima del tool che introduce: qui resta prima di quel tool. Le parti di ragionamento
 * vuote (il ragionamento vero, nascosto) non contano; i tool di `hiddenTools` non si mostrano, le loro note sì.
 */
export function progressItems<P extends { type: string; text?: string; toolName?: unknown }>(
  parts: readonly P[],
  hiddenTools: ReadonlySet<string>,
): ProgressItem<P>[] {
  const items: ProgressItem<P>[] = [];
  for (const part of parts) {
    if (part.type === "reasoning") {
      const text = part.text?.trim() ?? "";
      if (text && text !== INTERRUPTED_UPDATE) items.push({ kind: "note", text });
    } else if (part.type.startsWith("tool-") && !hiddenTools.has(toolNameOf(part))) {
      items.push({ kind: "tool", part });
    }
  }
  return items;
}

/** Le etichette dei tool della chat, mentre lavorano e quando hanno finito; un tool senza etichetta mostra il nome. */
export const TOOL_LABELS: Readonly<Record<string, { active: string; done: string }>> = {
  confirmContributionKind: {
    active: "Imposto tipologia contributo",
    done: "Tipologia impostata",
  },
  classifyContributionIntent: {
    active: "Classifico intent",
    done: "Intent classificato",
  },
  saveCompanyFacts: {
    active: "Salvo i dati dell'azienda",
    done: "Dati dell'azienda salvati",
  },
  saveCompanyValueThesis: {
    active: "Salvo la value thesis",
    done: "Value thesis salvata",
  },
  saveSystemBoundary: {
    active: "Definisco il perimetro",
    done: "Perimetro definito",
  },
  saveUnitTerminology: {
    active: "Salvo la terminologia",
    done: "Terminologia salvata",
  },
  createDepartment: { active: "Creo l'unità", done: "Unità creata" },
  saveStrategicGoal: {
    active: "Salvo l'obiettivo",
    done: "Obiettivo salvato",
  },
  // Fuori dalla mappatura nessuna chat salva un'attività: l'etichetta di sempre resta per la chat generica
  // (chat-interface.tsx, i suoi test la fissano); l'assistente della board mostra quelle di MAPPING_TOOL_LABELS.
  saveActivity: { active: "Salvo l'attività", done: "Attività salvata" },
  updateActivity: { active: "Aggiorno il passo", done: "Passo aggiornato" },
  linkActivityDependency: { active: "Collego i passi", done: "Passi collegati" },
  markDepartmentMapped: { active: "Completo la mappatura", done: "Mappatura completata" },
};

/**
 * Le etichette dei tool della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §7.5), come le mostra l'assistente accanto
 * alla board: un'attività salvata è un passo della board. Sono anche i tool dopo i quali l'assistente rilegge la board.
 */
export const MAPPING_TOOL_LABELS: Readonly<Record<string, { active: string; done: string }>> = {
  saveActivity: { active: "Salvo il passo", done: "Passo salvato" },
  updateActivity: { active: "Aggiorno il passo", done: "Passo aggiornato" },
  linkActivityDependency: { active: "Collego i passi", done: "Passi collegati" },
  markDepartmentMapped: { active: "Completo la mappatura", done: "Mappatura completata" },
};

/** I tool che non si mostrano come etichetta (le loro note di avanzamento sì). */
export const HIDDEN_TOOLS: ReadonlySet<string> = new Set(["webSearch"]);

/** Una riga di avanzamento come si mostra: una nota, o un tool con la sua etichetta, finito o in corso. */
export type ChatProgress = { kind: "note"; text: string } | { kind: "tool"; label: string; done: boolean };

/** Che cosa la chat mostra di una risposta: l'avviso di un rifiuto, o il testo; sotto, le righe di avanzamento. */
export type AssistantView =
  | { kind: "refused"; notice: string; progress: ChatProgress[] }
  | { kind: "answer"; text: string; progress: ChatProgress[] };

/**
 * A che punto è il tool di una risposta (gli stati di AI SDK 6): finito con un risultato (`output-available`), fallito
 * (`output-error`, quando l'esecuzione lancia o il modello passa un input che non rispetta lo schema; `output-denied`;
 * o un risultato che dice `success: false`, come i dati dell'azienda senza il permesso di scriverli), o in corso.
 */
export function toolOutcome(part: PartLike): "done" | "failed" | "running" {
  if (part.state === "output-error" || part.state === "output-denied") return "failed";
  if (part.state !== "output-available") return "running";
  return (part.output as { success?: unknown } | null | undefined)?.success === false ? "failed" : "done";
}

/**
 * Il tool di una risposta come si mostra: finito, con l'etichetta di quando ha finito e la spunta, o in corso. Un tool
 * fallito non si mostra (null): la sua etichetta direbbe fatto quello che non è stato fatto, e il testo del modello dice
 * già che non è riuscito. `labelsOf`: le etichette di chi mostra la chat (l'assistente della board ha le sue); un tool
 * che non vi compare prende quelle di sempre.
 */
export function toolChip(part: PartLike, labelsOf: Readonly<Record<string, { active: string; done: string }>> = TOOL_LABELS): Extract<ChatProgress, { kind: "tool" }> | null {
  const outcome = toolOutcome(part);
  if (outcome === "failed") return null;
  const name = toolNameOf(part);
  const labels = labelsOf[name] ?? TOOL_LABELS[name];
  const done = outcome === "done";
  return { kind: "tool", label: done ? (labels?.done ?? name) : (labels?.active ?? "Elaboro..."), done };
}

/**
 * Che cosa la chat mostra di una risposta dell'assistente. `arriving`: la risposta sta ancora arrivando (l'ultima, mentre
 * la chat aspetta lo stream). Una risposta rifiutata (isRefusedReply) mostra l'avviso al posto del suo testo parziale;
 * le altre il loro testo. Sotto, mentre la risposta arriva, i tool nell'ordine, in corso o finiti, e le note di
 * avanzamento, che indicano proprio questo: si vedono, ognuna prima del tool che introduce, solo finché la risposta non ha
 * testo. Una risposta che non arriva più (finita, rifiutata, o interrotta da un errore o dallo stop) mostra solo i tool
 * che hanno finito con un risultato, così si vede che cosa è stato fatto davvero: un tool in corso non finirà più (quelli
 * del passo rifiutato non partono nemmeno), e le note non indicano più niente; come dopo il ricaricamento, dove resta solo
 * il testo finale salvato. Un tool fallito non si mostra mai (toolChip). `labels`: le etichette dei tool (toolChip).
 */
export function assistantView(
  message: MessageLike,
  hiddenTools: ReadonlySet<string>,
  { arriving, labels = TOOL_LABELS }: { arriving: boolean; labels?: Readonly<Record<string, { active: string; done: string }>> },
): AssistantView {
  const items = progressItems(message.parts ?? [], hiddenTools);
  const chips = (part: PartLike) => {
    const chip = toolChip(part, labels);
    return chip ? [chip] : [];
  };
  const completed = items.flatMap((item) => (item.kind === "tool" && toolOutcome(item.part) === "done" ? chips(item.part) : []));
  if (isRefusedReply(message)) return { kind: "refused", notice: CHAT_REFUSAL_NOTICE, progress: completed };
  const text = messageText(message);
  if (!arriving) return { kind: "answer", text, progress: completed };
  const answered = text.trim().length > 0;
  const progress = items.flatMap<ChatProgress>((item) => (item.kind === "tool" ? chips(item.part) : answered ? [] : [item]));
  return { kind: "answer", text, progress };
}

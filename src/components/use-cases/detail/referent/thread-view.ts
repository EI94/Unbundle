/**
 * (Rilascio 6) «Il filo con il referente» sulla scheda: che cosa si mostra del filo, sotto una domanda e nel
 * blocco «Referente». Poche parole: una riga per messaggio (chi e quando, poi il testo), «Rispondi» su un
 * dubbio del referente, «Fatto» su una sua risposta a una voce, «Chiedi un chiarimento» sotto ogni sua
 * risposta, il suggerimento dell'AI accanto. Modulo puro: lo prova `thread-view.test.ts`.
 *
 * Nessun conteggio o ordinamento per persona (art. 15.4): i messaggi stanno in ordine di tempo.
 */
import type { ClarifyTarget, ThreadMessageView, ThreadSuggestionView, UseCaseReferentPanel } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_THREAD_TEXT, fillText } from "../../../../lib/use-cases/referent/labels.ts";

const T = REFERENT_THREAD_TEXT;

export interface ThreadLine {
  id: string;
  /** «Aldo Prova · 08/11». */
  header: string;
  /** «Su «Volumi mensili»», «In generale»; null sotto la sua domanda. */
  anchorLabel: string | null;
  /** Il testo, oppure «Testo cancellato.». */
  text: string;
  removed: boolean;
  side: "team" | "referente";
  /** Aspetta l'altra parte. */
  waiting: boolean;
  /** «Rispondi»: per il dubbio del referente. */
  reply: boolean;
  /** «Fatto»: per una risposta del referente su una voce o su «Generale». */
  done: boolean;
}

/** Le righe del filo, in ordine di tempo: quelle delle richieste `requestIds` o quelle di una domanda. */
export function threadLinesOf(messages: readonly ThreadMessageView[] | undefined, o: { requestIds?: ReadonlySet<string>; needId?: string; showAnchor: boolean }): ThreadLine[] {
  const need = o.needId?.toLowerCase() ?? null;
  return (messages ?? [])
    .filter((m) => (o.requestIds ? o.requestIds.has(m.requestId.toLowerCase()) : true) && (need === null || (m.anchor === "domanda" && m.needId?.toLowerCase() === need)))
    .map((m) => ({
      id: m.id,
      header: m.header,
      anchorLabel: o.showAnchor ? m.anchorLabel : null,
      text: m.text ?? T.removed,
      removed: m.text === null,
      side: m.side,
      waiting: m.waiting,
      reply: m.canReply,
      done: m.canDone,
    }));
}

/** Le richieste del referente (la sua persona), per il filo nel blocco «Referente». */
export function referentRequestIds(panel: Pick<UseCaseReferentPanel, "requests" | "referent">): Set<string> {
  const contact = panel.referent?.contact.id.toLowerCase() ?? null;
  if (!contact) return new Set();
  return new Set(panel.requests.filter((r) => r.contact.id.toLowerCase() === contact).map((r) => r.id.toLowerCase()));
}

/** La chiave dell'ancora di un posto dove si chiede un chiarimento («d:<esigenza>», «b:<voce>», «g»). */
export function targetKeyOf(target: Pick<ClarifyTarget, "anchor" | "needId" | "componentKey">): string {
  if (target.anchor === "domanda") return `d:${(target.needId ?? "").toLowerCase()}`;
  if (target.anchor === "beneficio") return `b:${target.componentKey ?? ""}`;
  return "g";
}

/** La proposta dell'AI per una risposta, solo quando lì si può ancora chiedere un chiarimento. */
export function suggestionFor(suggestions: readonly ThreadSuggestionView[] | undefined, target: ClarifyTarget | null | undefined): ThreadSuggestionView | null {
  if (!target || target.pending !== null) return null;
  const key = targetKeyOf(target);
  return (suggestions ?? []).find((s) => s.requestId.toLowerCase() === target.requestId.toLowerCase() && s.anchorKey === key) ?? null;
}

/** Sotto una risposta: «Chiedi un chiarimento», oppure il chiarimento già in attesa, oppure niente. */
export type ClarifyView = { kind: "button"; label: string } | { kind: "pending"; text: string } | null;

export function clarifyViewOf(target: ClarifyTarget | null | undefined): ClarifyView {
  if (!target) return null;
  if (target.pending !== null) return { kind: "pending", text: fillText(T.pending, { testo: target.pending }) };
  return { kind: "button", label: T.clarify };
}

/** «Tocca al referente» / «Tocca a noi», solo quando il filo c'è. */
export function turnTextOf(turn: "team" | "referente" | null | undefined): string | null {
  return turn === "team" ? T.turnTeam : turn === "referente" ? T.turnReferent : null;
}

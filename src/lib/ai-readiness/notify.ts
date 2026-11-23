/**
 * Le notifiche dell'AI Readiness in campanella (rilascio 10, ondata 7b; audit «Fuori» §6.7 e riga 30 della sintesi; la
 * regola del titolare «ogni funzione arriva con le sue notifiche»).
 *
 * - **Chi le riceve:** chi gestisce la rilevazione, cioè chi gestisce il workspace (`canManageWorkspaceSettings`, gli
 *   stessi permessi delle azioni della raccolta). Lo decide `queries/signals.ts`, che le nasconde a ogni altro ruolo.
 *   Chi le riceve apre la pagina: la dashboard si apre a ogni membro del workspace.
 * - **Calme, mai una per risposta:** una sola riga per rilevazione, `ai_readiness_risposte`, aggiornata sul posto a ogni
 *   questionario inviato (il numero di adesso, «46 risposte su 120 attese»): torna in cima e non letta, senza crescere
 *   di una riga. E una riga sola, `ai_readiness_soglia`, quando le risposte arrivano alla soglia dei risultati: non si
 *   ripete. Ogni riga ha un id fisso, derivato dalla rilevazione (`readinessSignalId`): due invii nello stesso istante
 *   scrivono la stessa riga, mai due.
 * - **Niente persone:** solo il nome della rilevazione e i conteggi; mai chi ha risposto, mai una risposta, mai un
 *   punteggio di una persona.
 * - **Link alla scheda giusta:** le risposte nuove a «Raccolta» (`#persone`), la soglia a «Risultati».
 *
 * Le email di questi avvisi aspettano una modifica del database (la coda e la preferenza): vedi il resoconto
 * dell'ondata 7b.
 *
 * Modulo puro, senza `node:`: lo legge anche la campanella nel browser (`notifications/bell.ts`). L'id fisso e il piano
 * di scrittura stanno in `notify-plan.ts`, sul server.
 */
import { formatCount } from "./dashboard-text.ts";
import { READINESS_ANCHORS, readinessHref } from "./dashboard-view.ts";

export const READINESS_ANSWERS_SIGNAL = "ai_readiness_risposte";
export const READINESS_THRESHOLD_SIGNAL = "ai_readiness_soglia";
export const READINESS_SIGNAL_TYPES = Object.freeze([READINESS_ANSWERS_SIGNAL, READINESS_THRESHOLD_SIGNAL] as const);
export type ReadinessSignalType = (typeof READINESS_SIGNAL_TYPES)[number];
/** `weekly_signals.related_entity_type` delle righe dell'AI Readiness. */
export const READINESS_SIGNAL_ENTITY = "ai_readiness_assessment";

export function isReadinessSignalType(type: string): type is ReadinessSignalType {
  return (READINESS_SIGNAL_TYPES as readonly string[]).includes(type);
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const answers = (n: number) => (n === 1 ? "1 risposta" : `${formatCount(n)} risposte`);
const named = (name: string) => `«${name.trim() || "AI Readiness"}»`;

export const READINESS_BELL_TEXT = Object.freeze({
  answersTitle: "Nuove risposte all'AI Readiness",
  answers: (name: string, n: number, expected: number | null) =>
    `${named(name)}: ${answers(n)}${expected && expected > 0 ? ` su ${formatCount(expected)} attese` : ""}.`,
  thresholdTitle: "AI Readiness: i risultati ci sono",
  threshold: (name: string, n: number) => `${named(name)}: ${answers(n)}, abbastanza per i risultati per area e per la sintesi.`,
});

/** Il nome di ogni riga nell'etichetta di Intelligence (`signals-feed.tsx`), al posto della chiave. */
export const READINESS_SIGNAL_LABEL: Readonly<Record<ReadinessSignalType, string>> = Object.freeze({
  ai_readiness_risposte: "AI Readiness · risposte",
  ai_readiness_soglia: "AI Readiness · risultati",
});

export interface ReadinessBellRow {
  id: string;
  type: ReadinessSignalType;
  title: string;
  description: string;
}

/** Dove porta una riga dell'AI Readiness in campanella: le risposte a «Raccolta», la soglia a «Risultati». */
export function readinessSignalHref(workspaceId: string, s: { signalType: string; relatedEntityType: string | null; relatedEntityId: string | null }): string | null {
  if (!isReadinessSignalType(s.signalType) || s.relatedEntityType !== READINESS_SIGNAL_ENTITY || !s.relatedEntityId || !UUID.test(s.relatedEntityId)) return null;
  const assessmentId = s.relatedEntityId.toLowerCase();
  return s.signalType === READINESS_ANSWERS_SIGNAL
    ? readinessHref(workspaceId, { assessmentId, tab: "raccolta", anchor: READINESS_ANCHORS.people })
    : readinessHref(workspaceId, { assessmentId });
}

/**
 * Il piano delle righe dell'AI Readiness in campanella (`notify.ts`), sul server: l'id fisso di ogni riga e che cosa
 * scrivere dopo un questionario inviato. Lo scrive `queries/ai-readiness-notify.ts`.
 *
 * Modulo puro con `node:crypto`: non va nel browser.
 */
import { createHash } from "node:crypto";
import { READINESS_ANSWERS_SIGNAL, READINESS_BELL_TEXT, READINESS_THRESHOLD_SIGNAL, UUID, type ReadinessBellRow, type ReadinessSignalType } from "./notify.ts";

/**
 * L'id fisso della riga di un tipo per una rilevazione: un UUID (versione 5, variante RFC 4122) dallo SHA-256 di tipo
 * e rilevazione. La stessa rilevazione ha sempre la stessa riga, così l'aggiornamento sul posto è un `ON CONFLICT (id)`.
 */
export function readinessSignalId(type: ReadinessSignalType, assessmentId: string): string {
  if (!UUID.test(assessmentId)) throw new Error("Rilevazione non valida");
  const bytes = createHash("sha256").update(`unbundle:ai-readiness:${type}:${assessmentId.toLowerCase()}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface ReadinessBellPlan {
  /**
   * Le risposte per cui le righe sono scritte. Il database le scrive solo se sono quelle che conta in quel momento
   * (`queries/ai-readiness-notify.ts`): un invio arrivato prima, con un numero già vecchio, non scrive niente.
   */
  responses: number;
  /** La riga delle risposte, aggiornata sul posto; null senza risposte. */
  answers: ReadinessBellRow | null;
  /** La riga della soglia, scritta una volta sola; null sotto la soglia. */
  threshold: ReadinessBellRow | null;
}

/**
 * Che cosa scrivere dopo un questionario inviato: la riga delle risposte con il numero di adesso e, da quando le
 * risposte bastano, quella della soglia (che il database scrive una volta sola).
 */
export function readinessBellPlan(i: { assessmentId: string; name: string; responses: number; expected: number | null; threshold: number }): ReadinessBellPlan {
  const n = Math.max(0, Math.trunc(i.responses));
  if (n === 0) return { responses: 0, answers: null, threshold: null };
  const T = READINESS_BELL_TEXT;
  return {
    responses: n,
    answers: { id: readinessSignalId(READINESS_ANSWERS_SIGNAL, i.assessmentId), type: READINESS_ANSWERS_SIGNAL, title: T.answersTitle, description: T.answers(i.name, n, i.expected) },
    threshold:
      n >= Math.max(1, i.threshold)
        ? { id: readinessSignalId(READINESS_THRESHOLD_SIGNAL, i.assessmentId), type: READINESS_THRESHOLD_SIGNAL, title: T.thresholdTitle, description: T.threshold(i.name, n) }
        : null,
  };
}


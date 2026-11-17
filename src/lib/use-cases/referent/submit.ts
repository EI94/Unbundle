/**
 * L'invio del referente (SPEC §3.8; rilascio 5 §6.2), la parte pura: come si chiude una domanda aperta e dove va
 * l'esigenza dopo l'invio. `submitReferentAnswers` (`queries/use-case-referent-public.ts`) la usa così com'è.
 *
 * («File da compilare») Il file da compilare del team non è un file del referente e non chiude mai una domanda: la
 * chiude il file ricaricato con «Allega il file compilato», che è un suo file come gli altri (stessa catena, stessi
 * effetti: «Da verificare», «Nuovi documenti», l'avviso a chi ha chiesto).
 *
 * Modulo puro.
 */

export type SubmitClosure = "testo" | "file" | "non_so" | "allegato";

/**
 * (Rilascio 5, §3.6) Una domanda aperta è chiusa da: un testo (non su «Serve un file»), un file del referente che si
 * può inviare (`files`, pulito o da controllare), «Non ce l'ho» o «È già allegato». null: manca ancora qualcosa.
 */
export function submitClosureOf(
  item: { fileRequired: boolean },
  draft: { dontKnow: boolean; alreadyAttached: boolean; body: string | null } | null,
  files: number,
): SubmitClosure | null {
  if (draft?.dontKnow) return "non_so";
  if (draft?.alreadyAttached) return "allegato";
  if (files > 0) return "file";
  if (!item.fileRequired && draft?.body?.trim()) return "testo";
  return null;
}

/** Una domanda pronta all'invio. */
export interface SubmitTarget {
  needId: string;
  dontKnow: boolean;
  /** (Rilascio 5) «È già allegato»: conta come una risposta, l'esigenza va «Da verificare». */
  alreadyAttached: boolean;
  hasDraft: boolean;
  /** C'è un testo: solo così conta come «risposta» (un file da solo conta tra i documenti). */
  hasText: boolean;
  documents: number;
}

/**
 * Dove vanno le esigenze dopo l'invio, solo da «Chiesta»: «Non ce l'ho» → «Manca il dato» (`mancante`); un testo, un
 * file o «È già allegato» → «Da verificare» (`in_verifica`).
 */
export function submitTransitionsOf(ready: readonly SubmitTarget[]): { inVerifica: string[]; mancante: string[] } {
  return {
    inVerifica: ready.filter((t) => !t.dontKnow).map((t) => t.needId),
    mancante: ready.filter((t) => t.dontKnow).map((t) => t.needId),
  };
}

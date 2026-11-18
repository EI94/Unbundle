/**
 * Gli use case da avvisare con «Il contesto è cambiato» dopo «Modifica» di un fatto (rilascio 9b,
 * docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.8, D5): solo quelli la cui vista cambia.
 *
 * - **Testo o visibilità cambiati:** tutti gli use case del fatto, quelli di prima e quelli di adesso. Anche quando il fatto
 *   diventa «Solo Lateral Space»: chi costruisce ha un `CONTESTO.md` con un fatto che non deve più leggere, e deve
 *   aggiornare il pacchetto (la campanella non ha nessun testo del fatto).
 * - **Solo gli use case:** quelli aggiunti e quelli tolti; gli altri vedono lo stesso fatto di prima.
 * - **Solo la sezione:** nessuno (come prima della correzione: la sezione non è una novità per chi costruisce).
 *
 * `shared`: anche chi costruisce da fuori Lateral Space riceve l'avviso, perché per quello use case il fatto era «Per tutti»
 * prima o lo è adesso (lo vedeva o lo vede). Un fatto «Solo Lateral Space» prima e dopo avvisa solo chi costruisce da
 * Lateral Space.
 *
 * Modulo puro: import relativi `.ts`.
 */
import type { ContextVisibility } from "../vocab.ts";

/** Come stava, o come sta, un fatto per gli avvisi: chi lo vede e a quali use case è legato. */
export interface FactNoticeState {
  visibility: ContextVisibility;
  useCaseIds: readonly string[];
}

/** Uno use case da avvisare; `shared`: anche chi costruisce da fuori. */
export interface NoticeTarget {
  useCaseId: string;
  shared: boolean;
}

/** Gli use case da avvisare dopo «Modifica», nell'ordine: prima quelli di adesso, poi quelli tolti. */
export function editNoticeTargets(i: { before: FactNoticeState; after: FactNoticeState; textChanged: boolean }): NoticeTarget[] {
  const before = new Set(i.before.useCaseIds.map((id) => id.toLowerCase()));
  const after = new Set(i.after.useCaseIds.map((id) => id.toLowerCase()));
  const everyone = i.textChanged || i.before.visibility !== i.after.visibility;
  const targets: NoticeTarget[] = [];
  for (const useCaseId of [...after, ...[...before].filter((id) => !after.has(id))]) {
    const wasThere = before.has(useCaseId);
    const isThere = after.has(useCaseId);
    if (!everyone && wasThere === isThere) continue;
    targets.push({ useCaseId, shared: (wasThere && i.before.visibility === "tutti") || (isThere && i.after.visibility === "tutti") });
  }
  return targets;
}

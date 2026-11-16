/**
 * «Mappatura board»: le bozze della board sul dispositivo (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.7).
 *
 * Una bozza è di una persona e di un'unità: su un browser condiviso chi entra dopo non salva a suo nome le modifiche
 * di chi c'era prima (né i suoi voti). Quando la persona esce dall'app (`signOutBoards`, da ogni strada che chiude la
 * sessione: «Esci» e «Cambia account», con `endAppSession` di src/lib/auth/end-session.ts) ogni board aperta manda
 * quello che resta finché la sessione c'è e smette di scrivere la sua bozza; poi le bozze della board si tolgono dal
 * dispositivo, tutte.
 *
 * Modulo puro, senza import: lo carica anche la fine della sessione dell'app.
 */

/** L'inizio della chiave di ogni bozza della board. */
export const DRAFT_PREFIX = "unbundle-mapping-draft:";

/** La chiave della bozza di una persona su un'unità. */
export const draftKey = (userId: string, departmentId: string) => `${DRAFT_PREFIX}${userId}:${departmentId}`;

type DeviceStorage = Pick<Storage, "length" | "key" | "removeItem">;

/** Toglie dal dispositivo ogni bozza della board, di ogni persona e unità; senza memoria non fa niente. */
export function clearBoardDrafts(storage: DeviceStorage | null): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // La memoria del dispositivo è spenta: non c'è niente da togliere.
  }
}

/** Quello che ogni board aperta fa quando la persona esce: manda quello che resta e lascia la sua bozza. */
const leaving = new Set<() => Promise<void>>();

/** Una board aperta dice che cosa fare all'uscita; la funzione che riceve la toglie (la board si chiude). */
export function onSignOut(run: () => Promise<void>): () => void {
  leaving.add(run);
  return () => {
    leaving.delete(run);
  };
}

/**
 * Prima di uscire dall'app: ogni board aperta manda quello che resta (si aspetta al più `waitMs`), poi nessuna bozza
 * della board resta sul dispositivo.
 */
export async function signOutBoards(storage: DeviceStorage | null, waitMs = 3_000): Promise<void> {
  const runs = [...leaving].map((run) => run().catch(() => undefined));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(runs), new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)))]);
  clearTimeout(timer);
  clearBoardDrafts(storage);
}

/**
 * La fine della sessione dell'app, la stessa da ogni strada che la chiude: «Esci» nella barra laterale e «Cambia
 * account» negli inviti.
 *
 * Prima le board della mappatura aperte mandano quello che resta finché la sessione c'è (al più qualche secondo), poi
 * nessuna bozza della board resta sul dispositivo: un browser condiviso non passa a chi entra dopo le modifiche, e i
 * testi, di chi c'era prima (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.7). Poi la sessione finisce sul server.
 * Nessuna strada chiama `DELETE /api/auth/session` da sola: lo controlla end-session.test.ts.
 *
 * Solo per il browser. Nessun import di React o di Next: lo provano i test con Node.
 */
import { signOutBoards } from "../../components/mappatura/store/drafts.ts";

/** La sessione dell'app sul server (src/app/api/auth/session/route.ts). */
export const SESSION_URL = "/api/auth/session";

export interface EndSessionDeps {
  /** La memoria del dispositivo, dove stanno le bozze della board; null se è spenta. */
  storage: Parameters<typeof signOutBoards>[0];
  fetch(input: string, init: RequestInit): Promise<unknown>;
}

function browserDeps(): EndSessionDeps {
  let storage: EndSessionDeps["storage"] = null;
  try {
    storage = window.localStorage;
  } catch {
    // La memoria del dispositivo è spenta: non ci sono bozze.
    storage = null;
  }
  return { storage, fetch: (input, init) => fetch(input, init) };
}

/**
 * Chiude la sessione: le board aperte e le loro bozze prima, la sessione del server poi. Un errore della richiesta
 * arriva a chi chiama (le bozze sono già tolte).
 */
export async function endAppSession(deps: EndSessionDeps = browserDeps()): Promise<void> {
  await signOutBoards(deps.storage);
  await deps.fetch(SESSION_URL, { method: "DELETE" });
}

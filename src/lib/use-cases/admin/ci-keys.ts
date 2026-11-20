/**
 * `use-case-admin ci-keys --workspace <id>` e `use-case-admin ci-key-revoke --workspace <id> --repo owner/nome [--apply …]`
 * (rilascio 8.2b, docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.8): le chiavi della CI di un workspace, e la revoca a mano
 * delle chiavi di un repository.
 *
 * - **`ci-keys`**, sola lettura: per ogni chiave il repository, il prefisso (`ub_ci_ab12`), le date (creata, scade, ultimo
 *   uso, avviso, revoca), il motivo della revoca e lo stato (`viva`, `scaduta`, `revocata`). Mai la chiave (Unbundle non
 *   ce l'ha), mai chi l'ha creata o revocata.
 * - **`ci-key-revoke`**: a secco dice quali chiavi si revocano; con `--apply` e le conferme dell'operatore le revoca tutte
 *   quelle non revocate del repository, con il motivo `a_mano` e senza persona (l'operatore non è un utente dell'app). Su
 *   GitHub il segreto `UNBUNDLE_CI_TOKEN` si toglie a mano.
 *
 * Le letture e le scritture sono quelle del modulo delle chiavi (`src/lib/db/queries/use-case-ci-keys.ts`), l'unico che
 * tocca la loro tabella. Modulo puro: import relativi `.ts`.
 */
import { isLiveCiKey, type CiKeyRow } from "../ci/keys.ts";

export const CI_KEY_REVOKE_OPTIONS = Object.freeze({ values: Object.freeze(["repo"]) as readonly string[] });

export const CI_KEYS_SCHEMA_MESSAGE = "Manca la tabella delle chiavi della CI (drizzle/0042): l'app la crea al primo avvio dopo il deploy.";

export const CI_KEY_REVOKE_NOTE =
  "Da subito la CI di questo repository non manda più le evals a Unbundle (401). Su GitHub il segreto UNBUNDLE_CI_TOKEN si toglie a mano; per ricollegare la CI: Agent Factory › la famiglia › «Collega la CI».";

export type CiKeyAdminState = "viva" | "scaduta" | "revocata";

/** Una chiave nell'uscita dello script: solo date, prefisso e stato. */
export interface CiKeyAdminLine {
  repository: string;
  prefisso: string;
  stato: CiKeyAdminState;
  creata: string;
  scade: string;
  ultimoUso: string | null;
  avvisata: string | null;
  revocata: string | null;
  motivo: string | null;
  /** La chiave nuova di una rotazione. */
  sostituisceUnaChiave: boolean;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Lo stato di una chiave per l'operatore. */
export function ciKeyAdminState(row: CiKeyRow, now: Date): CiKeyAdminState {
  if (row.revokedAt) return "revocata";
  return isLiveCiKey(row, now) ? "viva" : "scaduta";
}

/** Una riga di `ci-keys`. */
export function ciKeyAdminLine(row: CiKeyRow, now: Date): CiKeyAdminLine {
  return {
    repository: row.repo,
    prefisso: row.prefix,
    stato: ciKeyAdminState(row, now),
    creata: row.createdAt.toISOString(),
    scade: row.expiresAt.toISOString(),
    ultimoUso: iso(row.lastUsedAt),
    avvisata: iso(row.remindedAt),
    revocata: iso(row.revokedAt),
    motivo: row.revokedReason,
    sostituisceUnaChiave: row.replacesKeyId !== null,
  };
}

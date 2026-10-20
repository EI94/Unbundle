/**
 * Predicati unici sul ciclo di vita dei link dei referenti (PIANO §2.3,
 * tabella 9, e D42). Scritti una volta qui e usati da `/r`, `/api/r`,
 * promemoria e invio delle email, sempre con l'orologio del database.
 *
 * - `uc_request_live`: il link vale e si può scrivere.
 * - `uc_request_visible`: come sopra, ma ammette il caso `sospeso` (pagina in
 *   sola lettura «Il caso è in pausa»). Le scritture richiedono sempre live.
 *
 * Una bozza non ha token e non è mai un link valido. Modulo puro.
 */
import { LIVE_REQUEST_STATUSES } from "../vocab.ts";
import { raw, ref, ucSql, type SqlFragment } from "./statement.ts";

const LIVE_STATUSES_SQL = LIVE_REQUEST_STATUSES.map((s) => `'${s}'`).join(", ");

function base(r: string, c: string): SqlFragment {
  const rr = ref(r);
  const cc = ref(c);
  return ucSql`${rr}.status IN (${raw(LIVE_STATUSES_SQL)})
  AND ${rr}.revoked_at IS NULL
  AND ${rr}.expires_at > now()
  AND ${rr}.share_epoch = ${cc}.share_epoch
  AND ${cc}.setup_completed_at IS NOT NULL`;
}

/** `uc_request_live(r, c)`: `r` alias di `uc_requests`, `c` alias di `uc_cases`. */
export function requestLiveSql(r = "r", c = "c"): SqlFragment {
  return ucSql`(${base(r, c)}
  AND ${ref(c)}.status NOT IN ('chiuso', 'sospeso'))`;
}

/** `uc_request_visible(r, c)`: link apribile, in sola lettura se il caso è sospeso. */
export function requestVisibleSql(r = "r", c = "c"): SqlFragment {
  return ucSql`(${base(r, c)}
  AND ${ref(c)}.status <> 'chiuso')`;
}

/** Durata massima di un link dall'invio (spec privacy 12). */
export const REQUEST_LINK_TTL_DAYS = 30;

/**
 * Codice leggibile delle segnalazioni del portafoglio (connettore MCP, WP1).
 *
 * Formato del contratto: prefisso del workspace (2-4 lettere maiuscole),
 * trattino, numero a 4 cifre con zeri davanti; oltre 9999 il numero resta
 * intero (TJ-12345), fino a 99999. Il contatore è
 * `workspace_connector_configs.next_code_seq`: il primo codice è PREFISSO-0001.
 * Modulo puro (SQL e formato): lo usano l'app, gli script e i test con Node.
 */

export const USE_CASE_CODE_PATTERN = /^[A-Z]{2,4}-[0-9]{4,5}$/;
export const USE_CASE_CODE_PREFIX_PATTERN = /^[A-Z]{2,4}$/;
/** Ultimo numero che rispetta il pattern del contratto (5 cifre). */
export const USE_CASE_CODE_MAX_SEQ = 99999;

/** Stesso formato di ASSIGN_USE_CASE_CODE_SQL: `lpad` taglierebbe i numeri a 5 cifre, quindi si usa solo sotto 10000. */
export function formatUseCaseCode(prefix: string, seq: number): string {
  if (!USE_CASE_CODE_PREFIX_PATTERN.test(prefix)) throw new Error("Prefisso del codice non valido");
  if (!Number.isInteger(seq) || seq < 1 || seq > USE_CASE_CODE_MAX_SEQ) throw new Error("Numero del codice fuori intervallo");
  return `${prefix}-${seq < 10000 ? String(seq).padStart(4, "0") : String(seq)}`;
}

/**
 * Un solo statement, quindi atomico anche sul driver Neon HTTP: incrementa il
 * contatore del workspace e scrive il codice sulla segnalazione.
 * Postgres non ammette un UPDATE … RETURNING dentro FROM, quindi l'UPDATE
 * annidato sta in una CTE (eseguita una volta sola, stesso snapshot).
 *  - Nessuna riga in workspace_connector_configs → nessun effetto (codice null).
 *  - Segnalazione che ha già un codice, o di un altro workspace → nessun effetto e
 *    contatore invariato.
 *  - Oltre 99999 → nessun effetto: il pattern del contratto ammette 5 cifre.
 *  - Due chiamate concorrenti sulla stessa segnalazione: la seconda aspetta il
 *    lock della riga, ritrova code non null e non scrive (al più un numero salta).
 *    L'indice unico (workspace_id, code) resta la rete di sicurezza.
 * Parametri: $1 workspace_id, $2 use_case id. Restituisce `code`.
 */
export const ASSIGN_USE_CASE_CODE_SQL = `WITH next_code AS (
  UPDATE workspace_connector_configs c
     SET next_code_seq = c.next_code_seq + 1
   WHERE c.workspace_id = $1::uuid
     AND c.next_code_seq < ${USE_CASE_CODE_MAX_SEQ}
     AND EXISTS (
       SELECT 1 FROM use_cases u
        WHERE u.id = $2::uuid AND u.workspace_id = $1::uuid AND u.code IS NULL
     )
  RETURNING c.code_prefix, c.next_code_seq
)
UPDATE use_cases u
   SET code = n.code_prefix || '-' || CASE
         WHEN n.next_code_seq < 10000 THEN lpad(n.next_code_seq::text, 4, '0')
         ELSE n.next_code_seq::text
       END
  FROM next_code n
 WHERE u.id = $2::uuid AND u.workspace_id = $1::uuid AND u.code IS NULL
RETURNING u.code`;

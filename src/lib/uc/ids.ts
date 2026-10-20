/**
 * Gli identificativi dei Casi d'uso (DESIGN §7.2): un solo controllo per gli
 * UUID di casi, voci, workspace, utenti, link e file, al posto delle copie
 * della stessa espressione regolare sparse nei moduli. Lo usano le letture, i
 * comandi, le action e le pagine prima di mandare un id al database.
 *
 * La forma è quella che scrive Postgres (8-4-4-4-12 cifre esadecimali), con le
 * maiuscole ammesse: un id copiato da un'altra fonte vale lo stesso. Le
 * versioni non si controllano; chi vuole solo gli UUID generati dal browser
 * (versione e variante) ha il suo controllo (`answers/simple.ts`).
 *
 * Modulo puro e senza dipendenze di Node: lo importano anche il client e gli
 * script.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vero per una stringa con la forma di un UUID. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

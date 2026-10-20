/**
 * Esiti della normalizzazione delle risposte (PIANO §3.9).
 *
 * Un `Issue` ha un codice stabile (per i test e per l'interfaccia) e un
 * messaggio in italiano semplice, da mostrare accanto al campo. Non contiene
 * mai il valore scritto dal referente: si può registrare nei log.
 *
 * Modulo puro.
 */

export interface Issue {
  /** Percorso del campo nel payload (`amount`, `rows[2][1]`…). Assente = tutta la risposta. */
  field?: string;
  code: string;
  message: string;
}

export function issue(code: string, message: string, field?: string): Issue {
  return field === undefined ? { code, message } : { field, code, message };
}

/** Aggiunge il prefisso del campo (`from.` per un estremo dell'intervallo…). */
export function withField(issues: readonly Issue[], prefix: string): Issue[] {
  return issues.map((i) => ({ ...i, field: i.field ? `${prefix}.${i.field}` : prefix }));
}

/**
 * Risultato di un parser interno: un valore oppure errori. Gli avvisi valgono
 * in entrambi i casi.
 */
export type Parsed<T> =
  | { ok: true; value: T; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

export function parsed<T>(value: T, warnings: Issue[] = []): Parsed<T> {
  return { ok: true, value, warnings };
}

export function failed<T = never>(errors: Issue | Issue[], warnings: Issue[] = []): Parsed<T> {
  return { ok: false, errors: Array.isArray(errors) ? errors : [errors], warnings };
}

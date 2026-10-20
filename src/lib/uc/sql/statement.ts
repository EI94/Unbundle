/**
 * Costruttore SQL minimo per i comandi uc: frammenti componibili che diventano
 * `{ text, params }` con segnaposti `$1…$n`.
 *
 * Serve perché gli stessi costruttori girano nell'app (Neon HTTP via
 * `db.$client`) e negli script operatore (`neon(UC_ADMIN_DATABASE_URL)`), che
 * non possono importare `src/lib/db/index.ts`. Modulo puro.
 *
 * I valori diventano sempre parametri. Gli unici testi inseriti così come sono
 * vengono da `raw()` (solo costanti del codice) e da `ident()` (nomi validati).
 */

/** Istruzione pronta per l'esecutore uc (`src/lib/db/uc-executor.ts`). */
export interface UcStatement {
  readonly text: string;
  readonly params: readonly unknown[];
}

type Chunk = { kind: "text"; text: string } | { kind: "param"; value: unknown; cast: string | null };

const FRAGMENT = Symbol.for("unbundle.uc.sql");

export interface SqlFragment {
  readonly [FRAGMENT]: readonly Chunk[];
}

function fragment(chunks: readonly Chunk[]): SqlFragment {
  return Object.freeze({ [FRAGMENT]: Object.freeze([...chunks]) });
}

export function isSqlFragment(value: unknown): value is SqlFragment {
  return typeof value === "object" && value !== null && FRAGMENT in value;
}

/** Tag per scrivere SQL: `ucSql\`SELECT … WHERE id = ${id}::uuid\``. */
export function ucSql(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
  const chunks: Chunk[] = [];
  strings.forEach((text, index) => {
    if (text) chunks.push({ kind: "text", text });
    if (index < values.length) {
      const value = values[index];
      if (isSqlFragment(value)) chunks.push(...value[FRAGMENT]);
      else chunks.push({ kind: "param", value, cast: null });
    }
  });
  return fragment(chunks);
}

/** Testo SQL fidato. Mai con valori che vengono dall'esterno. */
export function raw(text: string): SqlFragment {
  return fragment([{ kind: "text", text }]);
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/** Nome di tabella, colonna o alias, validato e tra virgolette. */
export function ident(name: string): SqlFragment {
  if (!IDENT.test(name)) throw new Error(`Identificatore SQL non valido: ${JSON.stringify(name)}`);
  return raw(`"${name}"`);
}

/** Alias o colonna qualificata (`alias.colonna`) senza virgolette, validato. */
export function ref(path: string): SqlFragment {
  if (!/^[a-z_][a-z0-9_]{0,62}(\.[a-z_][a-z0-9_]{0,62})?$/.test(path)) {
    throw new Error(`Riferimento SQL non valido: ${JSON.stringify(path)}`);
  }
  return raw(path);
}

/** Parametro con cast esplicito, es. `cast(id, "uuid")` → `$1::uuid`. */
export function cast(value: unknown, type: "uuid" | "text" | "int" | "bigint" | "boolean" | "timestamptz" | "date" | "numeric" | "uuid[]" | "text[]"): SqlFragment {
  return fragment([{ kind: "param", value, cast: type }]);
}

/** Valore JSON come parametro jsonb. `undefined` diventa `null`. */
export function jsonb(value: unknown): SqlFragment {
  return fragment([{ kind: "param", value: JSON.stringify(value ?? null), cast: "jsonb" }]);
}

/** Unisce frammenti con un separatore costante. */
export function join(parts: readonly SqlFragment[], separator = ", "): SqlFragment {
  const chunks: Chunk[] = [];
  parts.forEach((part, index) => {
    if (index > 0) chunks.push({ kind: "text", text: separator });
    chunks.push(...part[FRAGMENT]);
  });
  return fragment(chunks);
}

/** Numera i parametri e restituisce l'istruzione. */
export function toStatement(f: SqlFragment): UcStatement {
  const params: unknown[] = [];
  let text = "";
  for (const chunk of f[FRAGMENT]) {
    if (chunk.kind === "text") {
      text += chunk.text;
      continue;
    }
    params.push(chunk.value === undefined ? null : chunk.value);
    text += `$${params.length}${chunk.cast ? `::${chunk.cast}` : ""}`;
  }
  return Object.freeze({ text, params: Object.freeze(params) });
}

/** Comodità: più frammenti → più istruzioni, nell'ordine. */
export function toStatements(fragments: readonly SqlFragment[]): UcStatement[] {
  return fragments.map(toStatement);
}

/**
 * Compare-and-swap in un batch a più istruzioni (PIANO §1.1): l'UPDATE deve
 * toccare esattamente `expected` righe, altrimenti `uc_require` annulla tutto il
 * batch con `uc:<code>`.
 *
 * `update` è un `UPDATE … RETURNING 1` (o qualunque istruzione con RETURNING).
 */
export function requireRows(update: SqlFragment, expected: number, code = "conflitto"): SqlFragment {
  if (!Number.isInteger(expected) || expected < 0) throw new Error("Numero di righe atteso non valido");
  if (!/^[a-z0-9_]{1,60}$/.test(code)) throw new Error("Codice uc non valido");
  return ucSql`WITH uc_cas AS (${update}) SELECT uc_require(count(*) = ${cast(expected, "int")}, ${raw(`'${code}'`)}) AS ok FROM uc_cas`;
}

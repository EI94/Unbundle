import { sql, type SQL } from "drizzle-orm";
import type { UcStatement } from "../uc/sql/statement.ts";

/**
 * Un `UcStatement` (testo con `$1`, `$2`… e i parametri) come SQL di drizzle, per metterlo nello
 * stesso `db.batch` (una transazione su neon-http) di una scrittura di drizzle (SPEC §P2.3.7,
 * `needs-service.ts`). Ogni `$n` diventa il parametro n, legato com'è (anche un array: un solo
 * parametro, mai un elenco). I costruttori uc non scrivono mai un `$` dentro una stringa SQL.
 */
export function ucToDrizzle(s: UcStatement): SQL {
  const parts = s.text.split(/\$(\d+)/);
  const chunks: SQL[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) chunks.push(sql.raw(parts[i]));
      continue;
    }
    const index = Number(parts[i]) - 1;
    if (!Number.isSafeInteger(index) || index < 0 || index >= s.params.length) throw new Error(`Parametro $${parts[i]} mancante`);
    chunks.push(sql`${sql.param(s.params[index])}`);
  }
  return sql.join(chunks, sql.raw(""));
}

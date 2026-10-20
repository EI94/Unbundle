// Schema letto da drizzle-kit (`drizzle.config.ts`, DESIGN §7.1 P0-2): tutte le
// esportazioni di `schema.ts` e `learning/schema.ts` tranne le tabelle dei Casi
// d'uso (`uc_*`). Le tabelle uc stanno in `schema.ts` solo per le query
// tipizzate; il loro DDL è `src/lib/uc/ddl.ts` (migrazione 0018). Così il lato
// del codice di drizzle-kit non le conosce, e `tablesFilter: ["!uc_*"]` le toglie
// dal lato del database: nessun comando di drizzle-kit le crea o le cambia.
// Il filtro va per nome, non con un elenco: una tabella uc nuova resta fuori da sola.
// Solo per drizzle-kit: l'app importa `schema.ts`.
/* eslint-disable @typescript-eslint/no-require-imports -- drizzle-kit carica gli schemi con require. */
const { getTableName, is } = require("drizzle-orm");
const { PgTable } = require("drizzle-orm/pg-core");

function withoutUcTables(...modules) {
  const out = {};
  for (const mod of modules) {
    for (const [name, value] of Object.entries(mod)) {
      if (is(value, PgTable) && getTableName(value).startsWith("uc_")) continue;
      if (Object.hasOwn(out, name) && out[name] !== value) throw new Error(`Esportazione doppia negli schemi: ${name}`);
      out[name] = value;
    }
  }
  return out;
}

module.exports = withoutUcTables(require("./schema.ts"), require("../learning/schema.ts"));

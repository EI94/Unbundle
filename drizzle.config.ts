import { defineConfig } from "drizzle-kit";

/**
 * Le tabelle dei Casi d'uso (`uc_*`) non sono di Drizzle (DESIGN §7.1 P0-2):
 * vincoli, FK, indici e trigger stanno solo in `src/lib/uc/ddl.ts` e nella
 * migrazione 0018, che si applica a mano (`docs/casi-duso/RUNBOOK.md`).
 * drizzle-kit non le vede da nessuno dei due lati:
 * - codice: `schema` è `schema.drizzle-kit.cjs`, cioè `schema.ts` e
 *   `learning/schema.ts` senza le tabelle `uc_*`;
 * - database: `tablesFilter` le toglie da ciò che legge, così non propone mai
 *   di cancellarle né di cambiarne i vincoli.
 * Per il database di produzione la regola resta: mai `db:push`, `db:generate`
 * né `db:migrate` senza il sì di Pierpaolo.
 */
export default defineConfig({
  schema: ["./src/lib/db/schema.drizzle-kit.cjs"],
  out: "./drizzle",
  dialect: "postgresql",
  tablesFilter: ["!uc_*"],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

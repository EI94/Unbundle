import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type DB = NeonHttpDatabase<typeof schema>;

/**
 * Durante `next build`, Next importa moduli (auth, API) prima che tutte le env
 * siano disponibili o senza eseguire query: serve una connection string sintatticamente valida.
 * Il client Neon non apre la connessione finché non parte una query.
 * In runtime su Vercel usa sempre `DATABASE_URL` reale dalle Environment Variables.
 */
function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;

  const phase = process.env.NEXT_PHASE;
  if (
    phase === "phase-production-build" ||
    phase === "phase-development-build"
  ) {
    return "postgresql://build@127.0.0.1:5432/build?sslmode=disable";
  }

  throw new Error(
    "DATABASE_URL non impostata. Aggiungila in Vercel (Settings → Environment Variables) per Production, oppure in .env.local in locale."
  );
}

const sql = neon(resolveDatabaseUrl());
export const db = drizzle(sql, { schema });

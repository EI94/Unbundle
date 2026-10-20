/**
 * Esecutore SQL unico dei comandi uc (PIANO §1.1).
 *
 * `batch()` esegue le istruzioni in **una sola transazione non interattiva**
 * (Neon HTTP `transaction()`): o vanno tutte, o nessuna. Un CAS dentro un batch a
 * più istruzioni passa da `uc_require()` (vedi `requireRows` in
 * `src/lib/uc/sql/statement.ts`): l'eccezione `uc:<codice>` annulla il batch e
 * `runUcBatch` la restituisce come `{ ok: false, code }`.
 *
 * - App: `getAppUcExecutor()` usa il client Neon di `src/lib/db/index.ts`.
 * - Script operatore: `ucExecutorForUrl(process.env.UC_ADMIN_DATABASE_URL)`.
 *
 * Questo modulo non importa `./index` in modo statico: gli script lo caricano con
 * Node, che non risolve gli import senza estensione dell'app.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { UcStatement } from "../uc/sql/statement.ts";

export type UcRow = Record<string, unknown>;

export interface UcExecutor {
  /** Esegue le istruzioni in un'unica transazione; restituisce le righe di ciascuna. */
  batch(statements: readonly UcStatement[]): Promise<UcRow[][]>;
}

/** Esecutore su un client Neon HTTP (`neon(url)` oppure `db.$client`). */
export function createUcExecutor(client: NeonQueryFunction<false, false>): UcExecutor {
  return {
    async batch(statements) {
      if (statements.length === 0) return [];
      const results = await client.transaction(statements.map((s) => client.query(s.text, [...s.params])));
      return results as UcRow[][];
    },
  };
}

/** Esecutore per gli script: URL esplicito, mai letto da file `.env`. */
export function ucExecutorForUrl(url: string | undefined): UcExecutor {
  if (!url) throw new Error("Manca l'URL del database (UC_ADMIN_DATABASE_URL).");
  return createUcExecutor(neon(url));
}

let appExecutor: Promise<UcExecutor> | null = null;

/** Esecutore dell'app, sul client Neon condiviso. */
export function getAppUcExecutor(): Promise<UcExecutor> {
  appExecutor ??= import("./index").then(({ db }) => createUcExecutor(db.$client));
  return appExecutor;
}

/** Prefisso delle eccezioni uc (`uc_require` e trigger). */
export const UC_ERROR_PREFIX = "uc:";

/** Messaggi in italiano semplice per i codici noti. */
export const UC_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  conflitto: "Qualcuno ha appena modificato questi dati. Aggiorna la pagina e riprova.",
  sola_aggiunta: "Questo dato non si può modificare né cancellare: si aggiunge una nuova versione.",
  template_pubblicato_immutabile: "Un template pubblicato non si modifica: pubblica una nuova versione.",
  gate_deciso_immutabile: "Questa decisione sul gate è già presa e non si modifica.",
  valore_personale_in_chiaro: "Un dato personale si salva solo cifrato.",
  valore_sanitario: "I dati sanitari non si registrano.",
  blocco_attivo: "La voce è ancora bloccata: prima va sciolto il blocco.",
};

/** Codice `uc:<codice>` da un errore del database, oppure null. */
export function ucErrorCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = /(?:^|\s)uc:([a-z0-9_]{1,60})\b/.exec(message);
  return match ? match[1] : null;
}

export type UcBatchResult = { ok: true; rows: UcRow[][] } | { ok: false; code: string; message: string };

/**
 * Esegue il batch e traduce le eccezioni uc in un esito. Gli altri errori
 * (rete, vincoli non uc) si propagano.
 */
export async function runUcBatch(executor: UcExecutor, statements: readonly UcStatement[]): Promise<UcBatchResult> {
  try {
    return { ok: true, rows: await executor.batch(statements) };
  } catch (error) {
    const code = ucErrorCode(error);
    if (!code) throw error;
    return { ok: false, code, message: UC_ERROR_MESSAGES[code] ?? "Operazione non riuscita. Riprova." };
  }
}

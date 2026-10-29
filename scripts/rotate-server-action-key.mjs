#!/usr/bin/env node
/**
 * Prima di `next build` (lo script `build` di package.json, che Vercel esegue): quando cambia la
 * versione di Next installata, toglie la chiave delle server action che Next tiene nella cache di
 * build (`.next/cache/.rscinfo`), così la build ne crea una nuova e gli ID delle server action cambiano.
 *
 * Perché: Next ricava gli ID delle server action dalla chiave e la riusa dalla cache di build per 14
 * giorni, e Vercel ripristina la cache del deploy precedente. Con la stessa chiave gli ID restano
 * uguali anche quando cambia Next, che porta con sé il React e il formato in cui il browser manda un
 * FormData: da 16.2.3 a 16.4.3 i campi passano da `1_title` a `_1_title`. Una scheda aperta sul deploy
 * precedente chiamava allora l'azione con un FormData vuoto, senza errore (HTTP 200), e i moduli di
 * Portfolio (valutazione, nome del team, webhook WhatsApp) cancellavano i valori salvati dicendo
 * «salvato». Con una chiave nuova la stessa scheda riceve un 409 (azione non trovata), l'azione non
 * parte e niente si scrive; così anche dopo un rollback al deploy precedente, che ha la sua chiave.
 * Con la stessa versione di Next la chiave resta quella della cache, come prima: le schede aperte
 * continuano a funzionare dopo un deploy qualsiasi.
 *
 * Non si imposta NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: una chiave fissa terrebbe gli ID uguali per
 * sempre, e ogni cambio di formato passerebbe in silenzio. La chiave non si stampa mai.
 * Uso: node scripts/rotate-server-action-key.mjs (lo fa `npm run build`).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Il file in cui Next tiene la chiave (server/app-render/encryption-utils-server.js). */
export const KEY_FILE = ".rscinfo";
/** La versione di Next della build che ha scritto la chiave nella cache. */
export const STAMP_FILE = "unbundle-next-version";

/**
 * Toglie la chiave se la cache viene da un'altra versione di Next (o non dice quale), poi annota la
 * versione di adesso. Restituisce se la chiave cambia e la versione di prima (null se non nota).
 */
export function rotateServerActionKey({ cacheDir, nextVersion }) {
  let previous = null;
  try {
    previous = readFileSync(join(cacheDir, STAMP_FILE), "utf8").trim() || null;
  } catch {
    // Nessuna cache, o una cache di prima di questo script.
  }
  const rotated = previous !== nextVersion;
  if (rotated) rmSync(join(cacheDir, KEY_FILE), { force: true });
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, STAMP_FILE), `${nextVersion}\n`);
  return { rotated, previous };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = createRequire(join(root, "package.json"))("next/package.json");
  const { rotated, previous } = rotateServerActionKey({ cacheDir: join(root, ".next", "cache"), nextVersion: version });
  console.log(
    rotated
      ? `Server action: nuova chiave per Next ${version} (${previous ? `la cache era di Next ${previous}` : "nessuna versione di Next annotata nella cache"}).`
      : `Server action: chiave della cache, già di Next ${version}.`,
  );
}

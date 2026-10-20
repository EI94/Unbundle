#!/usr/bin/env node
/**
 * Script dell'operatore del connettore MCP organizzativo (prompt WP8, pacchetto K8;
 * docs/connettore/README.md). Il lavoro è in `src/lib/connector/admin/` (un file per comando).
 *
 *   node --no-warnings scripts/connector-admin.ts <comando> --workspace <uuid> [opzioni]
 *        [--apply --confirm-authorized --confirm-database host[:porta]/database
 *         --environment local|preview|production [--production-approved]]
 *   env: CONNECTOR_ADMIN_DATABASE_URL (a mano, nella shell)
 *
 * Comandi, in quest'ordine:
 *   config          --file <config.json> [--overwrite]   riga di workspace_connector_configs (slug, prefisso, nome, domini, origini, limiti)
 *   profile         --file <profilo.json>                profilo del cliente e modello delle istruzioni del server
 *   guide           --file <guida.json>                  guida del workspace, validata con lo schema e con il profilo
 *   token           [--label <nome>]                     token del connettore, stampato una sola volta
 *   backfill-codes  [--limit <n>]                        codici per le segnalazioni che non ce l'hanno
 * `scoring-model` non c'è: passa all'hub (area «Use case», punteggio v2).
 *
 * Regole (sul modello di `scripts/uc-case-admin.ts` e di `use-case-admin` dell'hub):
 * - il database è solo `CONNECTOR_ADMIN_DATABASE_URL`: lo script non legge file d'ambiente né
 *   `DATABASE_URL`. Senza la variabile si ferma, anche a secco;
 * - prova a secco predefinita: legge in transazioni di sola lettura, stampa le differenze e
 *   non scrive nulla; si scrive solo con `--apply`, `--confirm-authorized`, `--confirm-database`
 *   uguale a host[:porta]/database dell'URL e `--environment` coerente con l'host (`local` solo
 *   su loopback), più `--production-approved` in produzione. Sulla produzione lo lancia Pierpaolo;
 * - i file con i dati di un cliente sono `*.private.json`, fuori da git;
 * - l'uscita è JSON (codice 0, oppure 1 se il comando si ferma); mai la password del database
 *   né messaggi del database. Il token compare solo nell'uscita di `token --apply`.
 */
import { runConnectorAdmin } from "../src/lib/connector/admin/main.ts";

const outcome = await runConnectorAdmin(process.argv.slice(2), { env: process.env });
// Si esce solo quando l'uscita è scritta: su una pipe stdout può essere asincrono.
process.stdout.write(`${JSON.stringify(outcome.output, null, 2)}\n`, () => process.exit(outcome.exitCode));

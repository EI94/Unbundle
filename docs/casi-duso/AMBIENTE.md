# Casi d'uso · Ambiente, variabili e harness locale

Questo documento elenca le variabili d'ambiente della sezione «Casi d'uso», come si applica la migrazione e come si usa il harness locale isolato. Riferimenti: `PIANO.md` §0, §2.5, §6.6, §7.1, §9.

Regola di base: **qui non ci sono valori.** Nessun segreto è inventato o scritto nel repository. I valori veri si generano al momento e si inseriscono solo nella dashboard di Vercel o in un file `.env` locale che non va in git.

---

## 1. Variabili nuove

| Variabile | Dove | Obbligatoria | A cosa serve | Se manca |
|---|---|---|---|---|
| `UC_ENABLED` | Vercel (anteprima, poi produzione), **a mano** | no | `true` accende la sezione. Qualunque altro valore la spegne. | Sezione spenta: niente voce nel menu, pagine interne, cron e MCP dei casi rispondono 404, `/r/*` mostra la scheda generica. Nessuna tabella `uc_*` viene creata dal self-heal. |
| `UC_WORKSPACE_IDS` | Vercel, **a mano** | sì, per accendere un workspace | Accensione per workspace (DESIGN §7.1 P0-1): UUID separati da virgole, spazi o a capo. `*` = tutti, ma solo fuori produzione (`VERCEL_ENV` diverso da `production`). In produzione ogni UUID ha anche la pagina Use case accesa (`USE_CASE_HUB_WORKSPACES`, `*` compreso, e fuori da `USE_CASE_HUB_EXCLUDE`). | Vuota o assente: sezione spenta per ogni workspace. Un workspace fuori elenco riceve 404 sulle pagine e sulle rotte del caso, sulle azioni e sul MCP dei dossier (eccezioni ancora aperte: RUNBOOK §5); i cron non lo toccano (tranne la conservazione dei file, RUNBOOK §7.1). |
| `UC_SCHEMA_SELF_HEAL` | Vercel, **a mano**, solo se serve | no | `off` (anche `false`, `0`, `no`): l'app esegue solo la sonda dello schema uc e non applica mai il DDL; la 0018 si applica a mano (RUNBOOK §3). `on` (anche `true`, `1`, `yes`) accende il self-heal. | Assente: self-heal acceso fuori produzione (locale, ramo Neon di sviluppo) e **spento in produzione** (`VERCEL_ENV=production`). In produzione `uc-doctor` segnala come errore solo un `on`. |
| `UC_LS_EMAIL_DOMAINS` | Vercel | sì, per usare la sezione | Domini email di Lateral Space, separati da virgola (es. `dominio-uno.it, dominio-due.com`). Un utente è di Lateral Space solo con **email verificata** in uno di questi domini, confronto esatto, senza sottodomini. | Nessun ruolo `ls_*` vale: la sezione è in sola lettura («Configurazione incompleta»). |
| `UC_SECRET` | Vercel | consigliata | Chiave da cui si derivano (HKDF) l'hash degli IP negli eventi e gli pseudonimi. Non serve per i link dei referenti, che sono casuali e salvati solo come hash. | `ip_hash` resta vuoto: niente hash senza chiave. |
| `UC_PERSONAL_ZONE_KEY` | Vercel, **a mano**, **solo dopo la scheda A.8 approvata** | no | Chiave master della zona personale (AES-256-GCM a busta, una chiave per workspace derivata con HKDF). 32 byte in base64. | Zona personale chiusa: file e valori personali rifiutati con un messaggio chiaro. |
| `UC_PERSONAL_BLOB_READ_WRITE_TOKEN` | Vercel, **solo dopo A.8** | no | Token di uno store Vercel Blob **separato** e privato per i file cifrati della zona personale. | Zona personale chiusa. |
| `UC_EMAIL_FROM` | Vercel | no | Mittente delle email, su un dominio verificato in Resend (es. `Lateral Space via Unbundle <indirizzo@dominio-verificato>`). | Con `RESEND_API_KEY`, `UC_EMAIL_FROM` o l'indirizzo pubblico dell'app (vedi `NEXT_PUBLIC_APP_URL` sotto) assenti la notifica resta `in_coda` con `hold_reason = email_non_configurata`; l'interfaccia lo dice e Lateral Space copia il link a mano. La campanella di Lateral Space funziona comunque. |
| `UC_LOCAL_STORAGE_DIR` | solo harness locale | no | Cartella locale al posto di Vercel Blob. Ignorata quando la variabile `VERCEL` è impostata. | — |
| `UC_ADMIN_DATABASE_URL` | solo script operatore (`uc-load-template`, `uc-seed-case`, `uc-case-admin`, `uc-doctor`) | sì, per quegli script | URL esplicito del database su cui lo script scrive (o legge, `uc-doctor`), passato a mano nella shell. Gli script non leggono mai `.env` né `DATABASE_URL`. | Lo script si ferma (`uc-doctor` salta i controlli del database e lo dice). |

Variabili esistenti usate dalla sezione:

| Variabile | Uso nella sezione |
|---|---|
| `DATABASE_URL` | Database dell'app (Neon). Le tabelle `uc_*` stanno nello stesso database. |
| `CRON_SECRET` | I cron `uc-reminders` e `uc-freshness` rispondono 401 se manca o non corrisponde (a differenza dei cron esistenti). |
| `RESEND_API_KEY` | Invio delle email della coda `uc_notifications`. Il client Resend si crea solo al primo invio; tra due invii passano almeno 550 ms (limite di base di 2 richieste al secondo) e al primo «troppe richieste» il giro si ferma e riparte dopo 10 minuti. Un giro di cron prende al massimo 50 email in tutto, divise tra i workspace accesi; quelle che restano partono al giro dopo. |
| `NEXT_PUBLIC_APP_URL` | Origine dei link nelle email (`/r/<token>` e pagine dei casi nel riepilogo per Lateral Space). In ordine: `NEXT_PUBLIC_APP_URL`, `APP_URL`, `VERCEL_PROJECT_PRODUCTION_URL`; mai l'URL della singola anteprima (`VERCEL_URL`). Solo `https`, `http` solo su loopback. |
| `BLOB_READ_WRITE_TOKEN` | Store privato dei file della zona standard. |
| `USE_CASE_HUB_WORKSPACES` | Pagina Use case accesa per workspace (`docs/use-case/DESIGN.md` §12.1): `*` = ogni workspace, anche quelli creati dopo e anche in produzione; oppure UUID separati da virgole. Qui la legge solo `uc-doctor`, con le regole della pagina Use case, per controllare che ogni workspace di `UC_WORKSPACE_IDS` abbia la pagina accesa. |
| `USE_CASE_HUB_EXCLUDE` | Facoltativa: UUID separati da virgole per cui la pagina Use case resta spenta anche con `*` (ritorno indietro per un cliente). `uc-doctor` dà errore in produzione se un workspace di `UC_WORKSPACE_IDS` è escluso. |
| `VERCEL_ENV` | Impostata da Vercel. `production` vuol dire produzione: lì `*` in `UC_WORKSPACE_IDS` non vale. |

Solo per il harness locale (mai su Vercel): `UC_TEST_ROOT`, `UC_TEST_DATABASE_URL`, `UC_TEST_ISOLATED`, `UC_TEST_PG_BIN`, `UC_TEST_PG_SOCKET_DIR`, `UC_TEST_PG_PORT`, `UC_TEST_PG_DB`, `FIREBASE_TOOLS_ROOT` (§4).

### Come generare i valori (sul proprio computer, mai in chat o in git)

- `UC_SECRET`, `UC_PERSONAL_ZONE_KEY`, `CRON_SECRET`: `openssl rand -base64 32`.
- `UC_PERSONAL_BLOB_READ_WRITE_TOKEN`: si crea uno store Blob nuovo e privato nella dashboard Vercel, separato da quello standard.
- `scripts/sync-vercel-env.mjs` conosce i nomi di alcune variabili uc (non i valori): copia su Vercel solo quelle presenti in `.env.local`. **Non** copia gli interruttori né la chiave della zona personale: `UC_ENABLED`, `UC_WORKSPACE_IDS`, `UC_SCHEMA_SELF_HEAL` e `UC_PERSONAL_ZONE_KEY` si impostano a mano, ambiente per ambiente (DESIGN §7.1 P0-1). `UC_ADMIN_DATABASE_URL` e `UC_LOCAL_STORAGE_DIR` non vanno mai su Vercel.
- Il controllo di tutte le variabili (presenza e forma, mai i valori) lo fa `scripts/uc-doctor.ts` (`docs/casi-duso/RUNBOOK.md` §9.1).

### Note operative

- **Resend**: sul dominio del mittente vanno **disattivati** il tracciamento delle aperture e dei clic. Il tracciamento dei clic riscriverebbe i link `/r/…` e quello delle aperture aggiungerebbe un pixel (art. 15.4: nessun controllo occulto).
- **Cron** (`vercel.json`): `/api/cron/uc-reminders` alle 08:00 UTC dei giorni feriali (09:00 o 10:00 a Roma) e `/api/cron/uc-freshness` alle 03:00 UTC. Con `UC_ENABLED` spento rispondono 404; senza `CRON_SECRET`, o con un segreto diverso, 401. `uc-reminders` chiude sempre i link scaduti e le voci scadute dopo 2 promemoria; promemoria, segnalazioni all'Owner e riepilogo del lunedì partono solo nella finestra lun–ven 9–18 di Roma, festivi esclusi. La risposta contiene solo conteggi.
- **Zona personale**: la chiave non si ruota nell'MVP. La busta ha un byte di versione della chiave (`kekVersion`) per permetterlo in seguito. Perdere la chiave rende illeggibili i dati personali cifrati.
- **Archivio dei file** (`src/lib/uc/storage.ts`): con `UC_LOCAL_STORAGE_DIR` impostata e senza `VERCEL` la cartella locale vince su qualunque token Blob (il harness non scrive mai su uno store vero). Il caricamento diretto dal browser fino a 20 MB (modalità client-Blob) esiste solo con `BLOB_READ_WRITE_TOKEN`; altrove, e sempre per la zona personale, i file passano dal server fino a 4 MB. Gli oggetti stanno in `uc/q/…` (quarantena), `uc/s/…` (zona standard) e `uc/p/….enc` (zona personale, cifrati); la cancellazione di un workspace li cancella dai due archivi.
- **Ordine di accensione** (PIANO §9.3, §12): prima un branch Neon di sviluppo e un'anteprima Vercel; `UC_ENABLED` resta spento in produzione finché le domande a1, a3 e a4 del piano non sono chiuse. Poi un workspace alla volta in `UC_WORKSPACE_IDS`, sempre dopo la pagina Use case: la procedura completa è `docs/casi-duso/RUNBOOK.md`.
- **Conservazione**: il cron `uc-freshness` toglie dagli archivi i file dei casi chiusi da oltre 30 giorni (tranne le prove scritte); la cancellazione di un caso intero è `uc-case-admin purge-case` (RUNBOOK §7).
- **Log**: errori del server, letture MCP, cron e self-heal uc scrivono una riga JSON (`src/lib/uc/log.ts`, `src/instrumentation.ts`), con il token dei link riscritto in `[token]`.

---

## 2. Database: migrazione 0018 e self-heal

- `drizzle/0018_uc_casi_duso.sql` è **generato** da `src/lib/uc/ddl.ts`. Non si modifica a mano:

  ```sh
  node --no-warnings scripts/uc-write-migration.ts          # riscrive il file
  node --no-warnings scripts/uc-write-migration.ts --check  # esce con 1 se il file non è aggiornato
  ```

  `src/lib/uc/ddl.test.ts` fallisce se il file e il DDL divergono.
- Si applica con `psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0018_uc_casi_duso.sql`. È idempotente: applicarla due volte non cambia nulla.
- **Mai** `npm run db:push`, `db:generate` o `db:migrate` per queste tabelle: Drizzle non conosce CHECK, trigger, FK e indici uc e li toglierebbe.
- Self-heal separato: `ensureUcSchema()` in `src/lib/db/ensure-schema.ts` (`UC_ENSURE_VERSION`, probe `ucSchemaLooksCurrent()`), chiamato solo dalle query uc con `UC_ENABLED=true`. Applica il DDL in una sola transazione, dopo un advisory lock. Un suo errore rende «non disponibile» solo la sezione uc; `ensureDbSchema()` dell'app non cambia.
- Con il self-heal spento (`UC_SCHEMA_SELF_HEAL=off`, e sempre in produzione salvo un `on` esplicito) l'app esegue solo la sonda: se è falsa la sezione risponde 503 e il DDL non parte; dopo l'applicazione manuale della 0018 la richiesta successiva riparte da sola.
- drizzle-kit non vede le tabelle uc: dal codice legge `src/lib/db/schema.drizzle-kit.cjs` (`schema.ts` e `learning/schema.ts` senza le tabelle `uc_*`, filtrate per nome) e dal database le toglie con `tablesFilter: ["!uc_*"]`. `npx drizzle-kit export --dialect postgresql --schema ./src/lib/db/schema.drizzle-kit.cjs` (senza database) lo mostra. La regola sul database resta: mai `db:push`, `db:generate`, `db:migrate` per le tabelle uc.
- Il probe controlla le 28 tabelle, le funzioni e i trigger, le colonne aggiunte, i valori di ogni CHECK dei vocabolari e l'impronta del DDL (commento di `uc_require`): se il DDL cambia, il self-heal riparte da solo. Una CHECK con valori diversi da `vocab.ts` si riallinea con `DROP CONSTRAINT IF EXISTS` + `ADD … NOT VALID` + `VALIDATE CONSTRAINT`.
- Le FK in `NO ACTION` sono `DEFERRABLE INITIALLY DEFERRED`: si controllano al commit. Così la cancellazione di un workspace completa la cascata, e la cancellazione diretta di una riga ancora usata resta rifiutata.

---

## 3. Regole sulla checkout principale

`.env.local` della checkout principale punta al database di **produzione**. Lì sono vietati: `npm run dev`, `next build`, `next start`, `npm run db:*`, gli script uc con `--apply`, e qualunque `psql` o client verso Neon.

Ammessi: `npm run lint`, `npm run typecheck`, `npm run test:uc`, `npm run test`, `npm run check`. I test di integrazione uc si saltano da soli senza variabili esplicite.

---

## 4. Harness locale isolato

Tutto gira su `127.0.0.1` e in cartelle temporanee fuori da git.

| Servizio | Porta | Note |
|---|---|---|
| PostgreSQL 16 | 55449 | utente `uc_test`, database `unbundle_uc_test`, accesso trust, ascolto solo su `127.0.0.1` |
| Emulatore Firebase Auth | 59109 | progetto `demo-unbundle-uc` |
| App Next | 53110 | `start-app.mjs` |
| Login sintetico | 53112 | `browser-login.mjs` |

Le porte 55439, 59099, 53100, 53102 e 53103 appartengono al harness della Formazione: non vanno toccate.

### 4.1 Preparazione (una volta)

```sh
# Radice temporanea del harness (in questa sessione: lo scratchpad di Claude Code).
export UC_TEST_ROOT=/private/tmp/claude-501/-Users-pierpaololaurito-unbundle/c8b292d3-b34a-4b01-8476-0085d1c280be/scratchpad/uc-verify

# Checkout di verifica SENZA file .env*, sul commit da provare.
git worktree add --detach "$UC_TEST_ROOT/unbundle" HEAD
# node_modules fisico (copia APFS), non un symlink: Turbopack rifiuta la radice esterna.
cp -cR /Users/pierpaololaurito/unbundle/node_modules "$UC_TEST_ROOT/unbundle/node_modules"
cd "$UC_TEST_ROOT/unbundle"
ls -a | grep '^\.env' && echo "ATTENZIONE: togli i file .env" || true
```

I file privati del primo caso (seed e template in `docs/casi-duso/`, ignorati da git) si copiano a mano nella checkout di verifica solo nei pacchetti che li usano.

### 4.2 Database

```sh
cd "$UC_TEST_ROOT/unbundle"
# initdb (LC_ALL=C, socket in /private/tmp/ucpg), avvio, createdb,
# drizzle 0000→0017 in ordine, poi 0018 due volte e ogni migrazione successiva
# (0019 del connettore Claude) due volte (idempotenza).
node scripts/uc-test/db-init.mjs init
node scripts/uc-test/db-init.mjs status     # running on 127.0.0.1:55449
node scripts/uc-test/db-init.mjs stop       # ferma il cluster, i dati restano
node scripts/uc-test/db-init.mjs start      # riparte sugli stessi dati
node scripts/uc-test/db-init.mjs migrate    # riapplica 0018 dopo un cambio del DDL
```

Accorgimenti di questa macchina, già gestiti da `db-init.mjs`:

- binari in `/opt/homebrew/opt/postgresql@16/bin` (variabile `UC_TEST_PG_BIN` per cambiarli);
- `LC_ALL=C LANG=C` per `initdb` e `pg_ctl`, altrimenti «postmaster became multithreaded»;
- socket Unix in una cartella corta (`/private/tmp/ucpg`, variabile `UC_TEST_PG_SOCKET_DIR`): il percorso dello scratchpad è troppo lungo;
- nessuna variabile `PG*` o `DATABASE_URL` ereditata: ogni `psql` è fissato a `-h 127.0.0.1 -p 55449 -U uc_test`;
- `UC_TEST_PG_PORT` e `UC_TEST_PG_DB` (facoltative) spostano porta e nome del database per un secondo cluster usa e getta con gli stessi script, per esempio quello del connettore Claude (porta 55469, `docs/connettore/README.md` §4). Senza queste variabili il harness resta su 55449 e `unbundle_uc_test`, e `local-neon.cjs` accetta solo quel database.

Dati del cluster: `$UC_TEST_ROOT/uc-pg`; log: `$UC_TEST_ROOT/uc-pg.log`. Per ripartire da zero: `stop`, poi cancellare `$UC_TEST_ROOT/uc-pg`, poi `init`.

**Attenzione, pulizia di macOS.** Ogni notte a mezzanotte `com.apple.tmp_cleaner` cancella da `/private/tmp` i file non usati da qualche giorno. Un harness fermo da tre giorni o più perde file a caso: dati del cluster (`global/pg_filenode.map`, `PG_VERSION`, configurazione), il manifesto delle fixture, il file `.git` della checkout di verifica e parti di `node_modules` (la copia APFS conserva le date dell'originale). Segni tipici: «could not open file "global/pg_filenode.map"» nel log del cluster, `Cannot find module …/node_modules/…` nel log dell'app, il login sintetico che risponde 502. Non si ripara: si ricostruisce tutto. Fermare app, login, emulatore e cluster; cancellare `uc-pg`, `uc-fixtures` e la checkout (`git worktree prune` dalla checkout principale); poi rifare §4.1, `init`, `seed-fixtures.mjs` con l'emulatore appena avviato e il caricamento del template.

### 4.3 Test di integrazione

```sh
cd "$UC_TEST_ROOT/unbundle"
env -i PATH="$PATH" HOME="$HOME" \
  UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test \
  UC_TEST_ISOLATED=true \
  NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs \
  node --no-warnings --test --test-concurrency=1 \
    src/lib/uc/database.integration.test.ts src/lib/uc/commands.integration.test.ts
```

I file di integrazione condividono lo stesso database e vanno eseguiti **uno alla volta** (`--test-concurrency=1`). `database.integration.test.ts` rompe e ripara di proposito il DDL uc (una CHECK dei vocabolari ristretta per qualche millisecondo): in parallelo, i comandi di `commands.integration.test.ts` falliscono per una CHECK che non c'entra. Per lo stesso motivo non va lanciato mentre si prova l'app sul harness.

`notifications.integration.test.ts` prova coda, invio (con un trasporto finto, mai Resend), cron e campanella. Cron e invio girano solo sul workspace del test (`workspaceId`): le righe delle fixture e degli altri test non cambiano.

`retention.integration.test.ts` prova la conservazione dei file dei casi chiusi (30 giorni, prove scritte escluse; le righe di uno store non configurato si saltano e si contano), i cron che girano solo sui workspace accesi con un solo budget d'invio per giro, la cancellazione di un caso (`purge-case`: dopo, 0 righe uc del caso tranne l'audit, 0 oggetti sotto i suoi prefissi nella cartella locale, i referenti usati solo da quel caso anonimizzati), `anonymize-contact` e `forget-personal-files`. Tocca solo il proprio workspace: si può eseguire anche sul database condiviso del harness. La stessa suite gira in CI (`.github/workflows/uc.yml`, RUNBOOK §9.3).

`local-neon.cjs` esegue le richieste HTTP del driver Neon con `pg`, e solo verso `uc_test@127.0.0.1:55449/unbundle_uc_test` (porta compresa). Il test crea i propri dati sintetici e li cancella alla fine. Verifica: tabelle, CHECK e probe; `uc_require` che annulla un batch; CAS con due transizioni concorrenti; tabelle a sola aggiunta (UPDATE e DELETE rifiutati, cancellazione privacy ammessa); isolamento per caso e per voce; valori personali solo cifrati e sanitari mai; righe di blocchi attivi; gate deciso immutabile; template pubblicato immutabile; predicati dei link; self-heal uc rotto con `ensureDbSchema()` verde; riallineamento di una CHECK; cascata dalla cancellazione del workspace.

### 4.4 App, utenti sintetici e login

```sh
cd "$UC_TEST_ROOT/unbundle"
FIREBASE_TOOLS_ROOT=/opt/homebrew/lib/node_modules/firebase-tools node scripts/uc-test/start-auth.mjs &   # 59109
node --no-warnings scripts/uc-test/seed-fixtures.mjs     # [--workspace-name-from-seed <seed privato>]
node scripts/uc-test/start-app.mjs &                     # dev --webpack su 53110 (o --build, --production, --uc-disabled)
node scripts/uc-test/browser-login.mjs &                 # 53112: http://127.0.0.1:53112/as/ls-lead
node --no-warnings scripts/uc-test/acceptance.mjs        # PASS / FAIL / PENDING, prove in $UC_TEST_ROOT/uc-evidence
```

- `start-app.mjs` passa solo variabili di un elenco ammesso, più `UC_ENABLED=true`, `UC_LS_EMAIL_DOMAINS=ls.test`, `UC_SECRET`, `UC_PERSONAL_ZONE_KEY` e `CRON_SECRET` generati in memoria, `UC_LOCAL_STORAGE_DIR=$UC_TEST_ROOT/uc-blob`. **Nessuna** `RESEND_API_KEY` né `BLOB_READ_WRITE_TOKEN`.
- `seed-fixtures.mjs` crea 7 account sintetici con email verificata: `ls-lead@ls.test`, `ls-analista@ls.test`, `owner-cliente@cliente.test`, `approvatore-privacy@cliente.test`, `osservatore@cliente.test`, `function-lead@cliente.test` (ruolo di workspace `function_lead`, non deve poter diventare `ls_lead`), `estraneo@altro.test` (solo nel secondo workspace). Il manifesto con le password sintetiche è in `$UC_TEST_ROOT/uc-fixtures/synthetic-fixtures.json` (permessi 0600). Il nome del workspace del cliente si legge, se serve, dal seed privato al momento dell'esecuzione: non è scritto nel codice.
- `browser-login.mjs` scambia il token dell'emulatore sull'endpoint vero `POST /api/auth/session` e reindirizza a `/dashboard/<workspace>/casi-duso` (oppure a `?to=/dashboard/…` o `?to=/r/…`). Non va mai pubblicato.
- `acceptance.mjs` è lo scheletro del percorso E2E del PIANO §9.2: oggi esegue i controlli sul database e segna come PENDING i passi delle pagine, che completano i pacchetti successivi (WP13 ne è proprietario).

Per fermare tutto: terminare `start-app.mjs`, `browser-login.mjs` e `start-auth.mjs`, poi `node scripts/uc-test/db-init.mjs stop`.

Controlli di piattaforma sul harness (C11):

```sh
# accensione per workspace: un workspace fuori elenco riceve 404 (pagine e API del caso, MCP; eccezioni in RUNBOOK §5)
node scripts/uc-test/start-app.mjs --flag UC_WORKSPACE_IDS=<uuid di un altro workspace> &
# budget di lettura (P0-5): meglio con --build e poi --production
node --no-warnings scripts/uc-test/perf-smoke.mjs --as ls-lead,owner-cliente --runs 10 [--round-trips]
# ambiente e database in sola lettura (P0-10). uc-doctor usa il driver HTTP di Neon:
# sul harness serve il preload local-neon.cjs, con lo stesso URL in UC_TEST_DATABASE_URL.
UC_TEST_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test \
NODE_OPTIONS=--require=./scripts/uc-test/local-neon.cjs \
UC_ADMIN_DATABASE_URL=postgresql://uc_test@127.0.0.1:55449/unbundle_uc_test \
UC_ENABLED=true UC_WORKSPACE_IDS='*' UC_LS_EMAIL_DOMAINS=ls.test \
node --no-warnings scripts/uc-doctor.ts --environment local
```

Senza il preload la riga `database` dà `Lettura non riuscita (NeonDbError)`. Sul harness è verde con 0 errori: restano avvisi attesi (segreti generati da `start-app.mjs` solo in memoria, nessuna email né archivio Blob, indice unico e schede madri che arrivano con la 0020).

`perf-smoke.mjs` misura TTFB, dimensione dell'HTML e del payload RSC e, con `--round-trips`, le transazioni del database per navigazione (`pg_stat_database`, a app ferma per il resto). Le prove finiscono in `$UC_TEST_ROOT/uc-evidence/perf/`.

### 4.5 Esito della verifica di WP0 (7 ottobre 2026)

- Cluster nuovo creato con `db-init.mjs init`: 0000→0017 applicate in ordine, 0018 applicata due volte senza errori; probe uc vero; ascolto solo su `127.0.0.1:55449`.
- `database.integration.test.ts`: 14 test, 14 superati; nessun dato rimasto nel database dopo il test.
- Harness: emulatore su 59109, 7 account sintetici, app dev su 53110 con lo schema uc presente. Login sintetico riuscito; `/dashboard/<ws>` e `/dashboard/<ws>/use-cases` rispondono 200; l'utente del secondo workspace riceve 404 sul primo. `acceptance.mjs`: PASS 4, FAIL 0, PENDING 11.
- Alla fine: app, login ed emulatore fermati; cluster fermato con `db-init.mjs stop`, dati conservati in `$UC_TEST_ROOT/uc-pg` per i pacchetti successivi.

# Rapporto finale del connettore «Unbundle» (fase 1)

Data: 19/10/2026. Ramo `feat/connettore-mcp`, checkout `../unbundle-connettore`. Ultimo commit prima di questo rapporto: `2b2ec86`.

Questo è il rapporto del §7 del prompt del connettore. Dice da dove parte il ramo, cosa contiene, cosa è stato provato oggi e con quale esito, come sta ogni criterio di accettazione del §6, quali decisioni sono prese e quali restano, e cosa resta da fare a Pierpaolo. I dettagli tecnici sono in `README.md`, le verifiche manuali in `VERIFICA.md`, il progetto della fase 2 in `OAUTH-FASE2.md`.

Regola di questo documento, come degli altri tre: nessun segreto, nessun valore del cliente. Il cliente del pilota si chiama qui «il cliente»; i suoi file stanno in `docs/connettore/*-<cliente>.private.json`, fuori da git.

---

## 0. In breve

- La fase 1 è costruita per intero: servizio di invio condiviso, idempotenza, codici, migrazione 0019 con il self-heal, contratto v2, contenuti sensibili, stati, autenticazione con header, limiti, igiene HTTP, log, rotta MCP con i 4 tool, ricerca e stato, scheda «Connettore Claude», script operatore, skill e plugin, test, smoke e verifica. La fase 2 (OAuth con login Microsoft) è solo progettata, come chiede il prompt.
- Oggi tutti i cancelli sono verdi sull'ultimo commit: `npm run check`, integrazione 97/97 su un database appena copiato dal modello, schema 32/32, smoke con `next start` sulla porta 53130 (40/40, più le fasi «secchio pieno» 11/11 e «sospeso» 12/12), schermate della scheda 75/75.
- Criteri del §6: 19 superati, 2 superati per la parte concordata (14 e 15), 1 non verificabile qui (17, dialogo in Claude Code: il Claude Code di questo Mac non ha un login). Nessuno non superato.
- Niente è uscito da questo Mac: nessun push, nessuna pull request, nessuna unione in `main`, nessun database remoto, nessuna modifica su Vercel.
- Le cose che solo Pierpaolo può fare sono in §7. La prima è il controllo «Request headers» con l'Owner dell'organizzazione del cliente: senza, la fase 1 non si può usare con l'organizzazione.

---

## 1. Base del ramo e storia

**Base.** Il ramo è nato il 13/10/2026 come worktree `../unbundle-connettore`, da `feat/casi-duso` al commit `50ca5e6`. Motivo (proposta del prompt, §2): `main` arrivava alla migrazione 0017 (ultimo commit `ee35b36` del 05/10/2026, ancora lo stesso oggi), mentre la sezione Casi d'uso, con la 0018 e il harness locale `scripts/uc-test/`, viveva solo su `feat/casi-duso`. Il codice del connettore resta indipendente da `src/lib/uc/`: legge `uc_cases` solo con SQL protetto da `UC_ENABLED` e `to_regclass`.

**Unioni ricevute** (in avanti, `git merge --no-ff`, approvate come classe da Pierpaolo il 14/10/2026 con il piano, decisione D12):

| Commit | Data | Cosa | Punto del piano |
|---|---|---|---|
| `6f5fb66` | 14/10 | `feat/casi-duso`, ondata 0 | S2 |
| `a670b71` | 14/10 | `feat/casi-duso`, ondate 1 e 2 | S4 |

Dopo `a670b71` due commit adattano i test del connettore a ciò che è arrivato (`3f9f413`, `9f9e007`).

**Unioni non ancora fatte** (previste dal piano, nessuna urgenza per il connettore):

- **S6**: l'ondata 3 dei Casi d'uso (C11b, C12, C13; punta di `feat/casi-duso` `e41aed7`, 73 commit) non è ancora entrata nel connettore. Serve all'hub per H6a e H6i. La fa la prossima sessione del connettore, tra due pacchetti, poi i cancelli G1-G3.
- **S5**: l'hub ha unito il connettore fino a `9f9e007` (cinque unioni: `28eaa50`, `221bcd1`, `5cc75d7`, `3f7e404`, `a71e407`). K8, K9, K10 e K11 non sono ancora nell'hub: la unione la fa la sessione dell'hub, tra due ondate.

**Stato remoto.** Il ramo non ha un ramo remoto né un upstream: non è mai stato pubblicato.

**Storia locale con valori del cliente** (già in README §5). Due tratti della storia contengono valori del cliente, tolti da HEAD ma ancora nei commit vecchi: il nome di un prodotto del cliente in un test (`6b450d8`, sostituito da `a01fc5a`) e il testo delle istruzioni del prompt WP5 nel codice (da `15aa8fb` fino alla revisione di K8, sostituito da `00a1a85` con un modello sintetico). `git grep` su HEAD non li trova. Il piano vieta il rebase dei tre rami: prima di un push o di un'unione nell'hub o in `main`, Pierpaolo decide se quella storia va sistemata (§6, decisione aperta 7).

---

## 2. Commit per pacchetto

165 commit sulla linea principale del ramo: 163 commit propri e 2 unioni. In ordine:

| Pacchetto | Primo → ultimo | Commit | Giorni | Cosa |
|---|---|---|---|---|
| WP1-WP2 e correzioni di Arresto A | `86b10f5` → `a5c39d7` | 14 | 13-14/10 | harness con un secondo cluster, 0019 e self-heal, codice a ogni nuova segnalazione, idempotenza per principal e sicura con richieste contemporanee, servizio condiviso con ranking dopo la risposta, modello del ranking configurabile, testi degli utenti come dati, notifiche ripulite, codice pre-0019 che continua a funzionare, id prenotato e tentativo sulla presa in carico |
| Unione S2 | `6f5fb66` | 1 | 14/10 | ondata 0 dei Casi d'uso |
| K3 (WP3) | `7b5f055` → `ed44ea1` | 14 | 14/10 | funzione degli stati con la tabella di precedenza, `test:connector` a glob, contratto v2, contenuti sensibili, campi v2 facoltativi nell'invio condiviso |
| K4 (WP4) | `6cbf8ee` → `80defc8` | 15 | 14/10 | igiene HTTP con parametri, interruttore della rotta, autenticazione con header, limite su Postgres, log di una riga, ingresso della rotta, token «esposto» |
| K5 (WP5) e arresto B | `15aa8fb` → `a9a4845` | 19 | 14/10 | istruzioni del server, letture dei tool, i 4 tool, server MCP senza stato, rotta, smoke con il client dell'SDK, app locale su 53130, correzioni della revisione, elenco delle decisioni di arresto B |
| K6 (WP6) con le decisioni 4 e 5 di arresto B | `a588315` → `5b7ac33` | 11 | 14/10 | test del DDL che accetta la versione del self-heal dell'hub, token a 90 giorni, giorno del workspace a mezzanotte di Roma, agenti per parole chiave, dossier avviato nello stato e nella ricerca, test sul database, correzioni della revisione |
| K7r (WP7 ridotto) | `d6a4b40` → `935eaf1` | 15 | 14/10 | scheda «Connettore Claude» nelle Impostazioni, azioni, query, schermate |
| Decisione 2 di arresto B | `bb5defb` | 1 | 14/10 | un invio «integra» risponde con lo stato «possibile doppione» |
| Unione S4 e adattamenti | `a670b71`, `3f9f413`, `9f9e007` | 1 + 2 | 14/10 | ondate 1 e 2 dei Casi d'uso; test del passaggio al caso e risolutore dei test |
| K8 (WP8) | `f63e7c6` → `d3e6092` | 21 | 19/10 | colonne del profilo e ricerca senza accenti in coda alla 0019, giorno del dossier per AVVIATA_COME_CASO, profilo e modello delle istruzioni letti dalla riga del workspace, schema della guida, script `connector-admin`, modello sintetico delle istruzioni al posto del testo del prompt, accensione solo con profilo e modello validi |
| K9 (WP9) | `8de7ecd` → `46549d6` | 11 | 19/10 | skill `segnala-caso-uso`, zip deterministici, pacchetti dal plugin modello, controlli sui valori del cliente |
| K10 (WP10) | `52832e7` → `a651285` | 24 | 19/10 | aula e 201° invio sulla rotta vera, isolamento fra due workspace, ogni errore del contratto e cattura dei log, smoke finale, `Origin` e `server/discover` nel log, script del dialogo in Claude Code, `VERIFICA.md`, revisione |
| K11 (WP11) | `f617887` → `2b2ec86` | 16 | 19/10 | `OAUTH-FASE2.md`, test che proxy e `next.config.ts` lasciano aperti i percorsi della fase 2, elenco prima dell'attivazione, regola di conservazione, nota su Notion, revisione |

Totale dei commit propri: 14 + 14 + 15 + 19 + 11 + 15 + 1 + 2 + 21 + 11 + 24 + 16 = 163. Questo rapporto aggiunge un commit.

L'elenco completo con i messaggi: `git log --first-parent --reverse --format='%h %ad %s' --date=short 50ca5e6..feat/connettore-mcp`.

---

## 3. File toccati

Rispetto a `feat/casi-duso` com'era all'ultima unione (`46901e1`): **133 file, 115 nuovi e 18 modificati, 26.843 righe aggiunte e 314 tolte.** Questo rapporto è il 134°.

| Area | File |
|---|---|
| Database | nuovi: `drizzle/0019_connettore_mcp.sql`, `src/lib/db/connector-ddl.ts` (+ test), `src/lib/db/queries/use-case-codes.ts`; modificati: `src/lib/db/ensure-schema.ts` (`ENSURE_VERSION = 14`), `src/lib/db/schema.ts`, `src/lib/db/queries/use-cases.ts`, `src/lib/db/queries/workspace-integrations.ts` |
| Invio condiviso del portafoglio | nuovi: `src/lib/portfolio/{submit-contribution,submission-http,idempotency,use-case-code,review-state}.ts` (+ test, compreso `submission.integration.test.ts` e `ai-ranking-safety.test.ts`); modificati: `external-submission.ts` (+ test, solo righe aggiunte), `ai-ranking.ts`, `ai-ranking-contract.ts`, `src/app/api/mcp/portfolio/submissions/route.ts` |
| Notifiche, Slack, log | nuovi: `src/lib/notifications/sanitize.ts`, `src/lib/log/safe-error.ts` (+ test), `src/lib/slack/new-use-case-message.ts`; modificati: `src/lib/notifications/portfolio-dispatch.ts`, `src/lib/slack/notifications.ts`, `src/lib/slack/use-case-payload.ts` |
| Connettore | `src/lib/connector/**`: 69 file nuovi (17.347 righe), di cui 34 test e 9 suite d'integrazione; rotta `src/app/api/mcp/connettore/[slug]/route.ts` |
| Dashboard | nuovi: `src/components/workspace/connector-card.tsx`, `connector-card-panel.tsx`, `src/lib/actions/connector-settings.ts`; modificato: `src/app/(dashboard)/dashboard/[workspaceId]/settings/page.tsx` (una riga di montaggio) |
| Skill e plugin | `skills/segnala-caso-uso/SKILL.md`, `plugins/unbundle-organizzazione/.claude-plugin/plugin.json`, `plugins/unbundle-organizzazione/skills/segnala-caso-uso/SKILL.md` |
| Script | nuovi: `scripts/connector-admin.ts`, `scripts/connector-package.mjs`, `scripts/connector-smoke.mjs`, `scripts/connettore-test/` (10 file: avvio dell'app e dell'emulatore, risolutore, test sul database, controllo dello schema, schermate, smoke, dialogo); modificati: `scripts/uc-test/{config.mjs,db-init.mjs,local-neon.cjs}` |
| Documenti | nuovi: `docs/connettore/{README,VERIFICA,OAUTH-FASE2}.md` e gli esempi sintetici `docs/connettore/{config,guida,pacchetto,profilo}-esempio.json`; modificato: `docs/casi-duso/AMBIENTE.md` |
| Progetto | `package.json`: `test:connector` (a glob, dentro `npm test`) e `test:connector:db` |

**File d'altri filoni.** `scripts/uc-test/*`, `docs/casi-duso/AMBIENTE.md` e `ai-ranking.ts` sono stati toccati solo prima di Arresto A (`86b10f5`, `253f82b`, `91db838`, `a5c39d7`), quando il piano lo permetteva. Dopo Arresto A il connettore non li ha più toccati, e non ha toccato il DDL uc (`src/lib/uc/ddl.ts`, `drizzle/0018_uc_casi_duso.sql`). Il server stdio (`mcp/`) e i suoi test non sono cambiati.

**File fuori da git.** In locale ci sono quattro file privati del cliente: `docs/connettore/{config,profilo,guida,pacchetto}-<cliente>.private.json`. `git check-ignore -v` li dà tutti esclusi dalla riga 50 di `.gitignore` (`*.private.json`), e `git ls-files -- '*.private.json'` non restituisce nulla.

---

## 4. Comandi eseguiti e loro esito

### 4.1 Oggi, sull'ultimo commit (`2b2ec86`)

Tutto su `127.0.0.1`: cluster del connettore sulla porta 55469 (già acceso), app sulla 53130, emulatore di Auth sulla 59129. Nessun file `.env*` nella checkout, `DATABASE_URL` tolta dall'ambiente di ogni comando, nessuna chiave di fornitori. Gli script di prova passano al proprio processo figlio solo l'indirizzo del database locale.

| # | Comando | Esito |
|---|---|---|
| 1 | `env -u DATABASE_URL -u ANTHROPIC_API_KEY npm run check` | verde in 33 s. Lint: nessun problema. `tsc`: nessun errore. Test: portfolio 19/19, MCP stdio 16/16, Slack 29/29, collaborazione 16/16, auth 13/13, AI Readiness 50/50, Formazione 179 superati e 7 saltati, Casi d'uso 1.361 superati, 191 saltati e 1 da fare, **connettore 408 test: 329 superati, 79 saltati** (le suite che chiedono il database: girano al punto 2). Nessun test fallito. |
| 2 | `createdb -T unbundle_conn_test conn_final`, poi `UC_TEST_PG_DB=conn_final npm run test:connector:db` | **97/97** in 12 s, con `--test-concurrency=1`. Nessuna stringa che somigli a un token nell'uscita. |
| 3 | `UC_TEST_PG_PORT=55469 node scripts/connettore-test/schema-check.mjs` | **32/32**: 0019 applicata due volte con lo schema identico, self-heal uguale alla migrazione su un database con 0000-0017, backfill, trigger, `unaccent` unica estensione, funzione IMMUTABLE, ricerca senza accenti che usa l'indice nuovo. I due database di prova sono stati cancellati dallo script. |
| 4 | `createdb -T unbundle_conn_test conn_final_smoke`, poi `start-app.mjs --build` | build di Next riuscita in 20 s. |
| 5 | `smoke-run.mjs --start-app` (database `conn_final_smoke`) | porta in ascolto dopo 202 ms; prime chiamate a freddo: `initialize` 476 ms, prima guida 13 ms, primo invio 18 ms (misurate, non contano per il criterio). Giro completo **40/40**, righe salvate **5/5**, secchio pieno **11/11** (`retryAfterSeconds` 251), connettore sospeso **12/12**, nessuna segnalazione in più (21 attese, 21 trovate), log di `next start` **3/3** (18 valori vietati cercati, 72 righe `[mcp] call`, `Origin` non ammessa scritta `other`). **20 invii a caldo: p50 6 ms, p95 12 ms, max 13 ms.** Token revocato, dati sintetici cancellati, figlio fermato, porta libera. |
| 6 | `smoke-run.mjs --start-app --list-only --profile-file <profilo del cliente> --contract-file <contratto>` (file fuori da git) | **11/11**: i 4 tool pubblicati identici al contratto (titoli, descrizioni, schemi, annotazioni), anche sul filo, ordine delle chiavi compreso. |
| 7 | confronto del modello delle istruzioni del profilo del cliente con il testo del prompt WP5 (script in una cartella temporanea, fuori da git) | il modello è identico al testo del prompt, con un solo segnaposto; dopo la sostituzione con il nome visualizzato del cliente (17 caratteri) è lungo **1.893 caratteri** (massimo 2.048). |
| 8 | controllo della guida del cliente (stesso modo) | valida per lo schema di K8, nessuna incoerenza con il profilo del cliente, risposta di `get_intake_guide` di **17.951 caratteri** (sotto 20.000), `esgEnabled` falso. |
| 9 | `createdb -T unbundle_conn_test conn_final_screens`, `start-auth.mjs` (59129), `start-app.mjs --production --auth-emulator` (53130), `screens.mjs` | **75/75**, 10 schermate a 1440 e 400 px in `$UC_TEST_ROOT/conn-evidence/k7r/`, fuori da git. Emulatore e app fermati (solo i miei due processi), porte 53130 e 59129 libere. |
| 10 | `git ls-files -- '*.private.json'`, `git check-ignore -v docs/connettore/*.private.json`, `git grep -E 'ub_(mcp|team)_[A-Za-z0-9_-]{24,}'` | nessun file privato tracciato; i quattro file del cliente ignorati; nessun token nei file tracciati. |

I tre database `conn_final`, `conn_final_smoke` e `conn_final_screens` restano sul cluster locale, con soli dati sintetici (smoke e schermate cancellano i propri). Come quelli dei pacchetti precedenti (`conn_k8` … `conn_k11r`), si possono togliere con `dropdb` o lasciare: la pulizia di macOS svuota `/private/tmp`.

### 4.2 Esiti dei pacchetti precedenti (da README e VERIFICA)

Solo i numeri registrati allora; una casella vuota vuol dire che quel giro non è stato registrato in quel punto.

| Quando | Integrazione | Schema | Smoke | Schermate |
|---|---|---|---|---|
| K5 corretto, arresto B (14/10) | | | 33/33, righe 5/5, p95 14 ms | |
| K6 (14/10) | | | 33/33, righe 5/5, p95 10 ms | |
| K7r corretto (14/10) | | | | 75/75 |
| K8 corretto (19/10) | | 32/32 | 34/34, righe 5/5, p95 87 ms | 75/75 |
| prima di K10 | 74 | | | |
| K10 (19/10) | 92 | 32/32 | 40/40, 11/11, 12/12, log 3/3, p95 10 ms | 75/75 |
| K10 corretto (19/10) | 97/97 | 32/32 | 40/40, 11/11, 12/12, log 3/3, p95 11 ms | 75/75 |
| K11 corretto (19/10) | 97/97 | DDL invariato | | pagine invariate |
| **Oggi (19/10), HEAD finale** | **97/97** | **32/32** | **40/40, 11/11, 12/12, log 3/3, p95 12 ms** | **75/75** |

### 4.3 Non eseguiti, di proposito

- `npm run db:push`, `db:generate`, `db:migrate`: mai. La 0019 si applica solo con `psql --single-transaction --set=ON_ERROR_STOP=1`, e solo al cluster locale.
- Nessun database remoto (Neon), nessuna variabile o protezione di Vercel, nessun push, nessuna pull request, nessuna unione in `main`.
- Il dialogo con il modello in Claude Code: il Claude Code di questo Mac non ha un login (VERIFICA §2, lo fa Pierpaolo).
- MCP Inspector: scarica un pacchetto con `npx`, quindi solo con il sì di Pierpaolo. Lo smoke usa già il client ufficiale dell'SDK.
- `claude plugin validate --strict`: provato con K9 il 19/10 («Validation passed» sul plugin modello e sui quattro plugin generati); i plugin non sono cambiati dopo.

---

## 5. Criteri di accettazione (§6 del prompt)

| # | Criterio | Esito | Perché |
|---|---|---|---|
| 1 | `npm run check`, `test:connector` dentro `npm test`, test esistenti senza aspettative cambiate | **superato** | §4.1 punto 1. `test:connector` è l'ultima voce di `npm test`. Dei test che c'erano prima è cambiato solo `external-submission.test.ts`, con sole righe aggiunte; i test del server stdio, di Slack e dei Casi d'uso non sono stati toccati. |
| 2 | 0019 due volte senza differenze; `ENSURE_VERSION` 14; self-heal uguale | **superato** | `schema-check.mjs` 32/32 (§4.1 punto 3), su un database con 0000-0017; `ENSURE_VERSION = 14` in `ensure-schema.ts`; `connector-ddl.test.ts` nel punto 1. |
| 3 | `tools/list` con 4 tool, titoli, annotazioni e schemi del contratto; istruzioni del §WP5 ≤ 2.048 caratteri | **superato** | Smoke 40/40 (annotazioni, nessun `outputSchema`, schemi uguali anche sul filo); con il profilo del cliente, tool identici al contratto (§4.1 punto 6); istruzioni identiche al testo del prompt, 1.893 caratteri (punto 7). Per decisione 1 di arresto B il testo sta nella riga del workspace e nel file privato, non nel codice. |
| 4 | `get_intake_guide` con versione, identità, aree, strumenti, rubrica, agenti, sotto 20.000 caratteri | **superato** | Smoke: guida d'esempio con rubrica e catalogo, 9.517 caratteri; guida del cliente valida e di 17.951 caratteri (punto 8); `tools.test.ts`, `guide-schema.test.ts`. |
| 5 | Invio valido: HTTP 200, `ok`, `duplicate: false`, `TJ-0001`, RICEVUTA, `link: null`; p95 < 2 s; riga salvata giusta | **superato** | Smoke: `TJ-0001` (prefisso di prova del workspace sintetico), RICEVUTA, `link: null`; p95 12 ms su 20 invii a caldo; righe: `source = claude_connector`, `intake.contractVersion = 2`, `impact_time`, `impact_economic`, `impact_flag` e `custom_scores` vuoti. HTTP 200 sull'invio in `route.integration.test.ts` (10 invii, sempre 200) ed `errors-logs.integration.test.ts`. Un invio «integra» risponde «possibile doppione» per decisione 2 di arresto B. |
| 6 | Stessa chiave: duplicato anche a secchio pieno; conflitto; 10 invii insieme; ripresa dopo `failed` | **superato** | Smoke (duplicato, conflitto, fase «secchio pieno»); `route.integration.test.ts` (10 invii contemporanei, una segnalazione, zero 500); `classroom.integration.test.ts`; ripresa in `submission.integration.test.ts` ed `errors-logs.integration.test.ts`. |
| 7 | Ogni codice d'errore del contratto con il suo formato, `invalid_payload` con `fieldErrors`, mai il testo dell'SDK | **superato** | `errors-logs.integration.test.ts`: i 16 codici sulla rotta vera, sempre HTTP 200 e `isError: true`; smoke con sette codici; `contract.test.ts`, `tools.test.ts`. |
| 8 | 401 nei sei casi senza `WWW-Authenticate`; token in query 400 senza eco e segnato «esposto»; 405; 404 con l'interruttore spento; `connector_disabled` | **superato** | `access.integration.test.ts`, `gate.test.ts`, `handler.test.ts`, `route.integration.test.ts`, `settings.integration.test.ts`; smoke (401, 400 senza eco, 405 con `Allow: POST` per sei metodi, fase «sospeso»). |
| 9 | 30 persone in un'ora senza `rate_limited`; 201° invio con `retryAfterSeconds > 0`; `initialize` e `tools/list` fuori dal limite | **superato** | `classroom.integration.test.ts` sulla rotta vera (30 client dell'SDK, 120 letture e 30 invii esatti, poi il 201°); `route.integration.test.ts` (nessuna riga nel limite dopo `initialize` e `tools/list`). |
| 10 | Codice fiscale, IBAN, carta, telefono, email di terzi bloccati in ogni campo; «visita medica» salvata con avviso; numeri della rubrica non bloccati | **superato** | `sensitive-content.test.ts`, `tools.test.ts`, `errors-logs.integration.test.ts`; smoke (telefono inventato in `promptSnippet`). |
| 11 | Ricerca con 3 parole anche accentate; mai autore, email, note, punteggi; niente nascoste o archiviate non doppioni; agenti e nota | **superato** | `status-search.integration.test.ts`, `route.integration.test.ts`, `isolation.integration.test.ts`; ricerca senza accenti in `schema-check.mjs` (§4.1 punto 3); smoke (nessun campo vietato). |
| 12 | Stato giusto nei 12 casi; `statusChangedAt` coerente; `linkedCaseCode` con `UC_ENABLED`; nascosta ridotta; `identity_required` | **superato** | `status.test.ts` (23 righe), `status-search.integration.test.ts` (stati letti dalle righe, dossier collegato, giorno del dossier per AVVIATA_COME_CASO), smoke (`identity_required`). |
| 13 | Nei log mai token, testi o email, anche negli errori | **superato** | `errors-logs.integration.test.ts` cattura tutto stdout e stderr del processo; log di `next start` controllato dallo smoke (§4.1 punto 5); uscita del punto 2 senza token. |
| 14 | Dashboard: codice, dati raccolti, nota pubblica, nascondi, doppione, oscura, scheda «Connettore Claude» con token e scadenza; nessuna metrica per persona | **superato per la parte concordata** | Il piano approvato il 14/10 (PIANO-LAVORI §3.5, riga K7r) riduce WP7 alla scheda «Connettore Claude»: schermate 75/75 oggi (§4.1 punto 9), nessun conteggio per persona. La parte della scheda dello use case (codice, dati raccolti, nota pubblica con l'avviso, «Nascondi dalla ricerca», «Segna come doppione», «Oscura testo») è dell'hub (H3b, H4b) e si chiude all'arresto H-B. |
| 15 | `connector-admin` a secco (`config`, `backfill-codes`, `scoring-model`) non scrive; `--apply` solo su `CONNECTOR_ADMIN_DATABASE_URL` | **superato per la parte che resta** | `admin/admin.integration.test.ts` (ogni prova a secco lascia identiche configurazione, codici e token; `--apply` senza conferme non scrive), `admin/commands.test.ts`, `admin/cli.test.ts`. `scoring-model` non c'è per decisione del 19/10 (passa all'hub, punteggio v2): lo script risponde `NOT_AVAILABLE`. |
| 16 | Skill: nome, descrizione ≤ 1.024, < 500 righe, tool `Unbundle:…`, modalità senza connettore; manifest valido; zip giusti, fase 1 senza `.mcp.json` | **superato** | `package/skill-package.test.ts` e `package/zip.test.ts` nel punto 1 (descrizione di 811 caratteri, 336 righe, lo script vero scrive i tre zip); `claude plugin validate --strict` superato con K9. |
| 17 | Dialogo completo in Claude Code contro il server locale, compreso il piano B | **non verificabile qui** | Il Claude Code di questo Mac non ha un login (decisione del 19/10). Provato solo il collegamento: Claude Code 2.1.299 con l'header, «Connected», 4 tool (VERIFICA §1). La procedura esatta, i sei dialoghi e la tabella degli esiti sono in VERIFICA §2 e §5: li fa Pierpaolo. |
| 18 | README, VERIFICA, OAUTH-FASE2 esistono; nessun file privato né segreto in git | **superato** | I tre documenti esistono (più questo rapporto); §4.1 punto 10; il test dei valori del cliente su skill, plugin, esempi, README, VERIFICA e OAUTH-FASE2 gira in locale nel punto 1. Resta la storia locale di §1. |
| 19 | Isolamento fra due workspace | **superato** | `isolation.integration.test.ts`: codici, duplicati, ricerca, agenti, stato, `unknown_related_code`, guida, token, secchi, REST. |
| 20 | `Origin` non ammesso 403, corpo oltre 256 KB 413, content-type 415 | **superato** | Smoke (403, 413, 415, più 406 dell'SDK e le intestazioni di igiene); `access.integration.test.ts`, `gate.test.ts`, `http-hygiene.test.ts`. |
| 21 | Una segnalazione REST riceve un codice e si trova con la ricerca | **superato** | `route.integration.test.ts` (anche una creata come fa lo Slack intake), `submission.integration.test.ts`. |
| 22 | «Avvia caso d'uso» su una segnalazione del connettore, con `UC_ENABLED=true` | **superato** | `status-search.integration.test.ts` sul database locale: il pulsante compare, la procedura «Nuovo caso» la elenca, il caso si crea, il secondo avvio dà `caso_gia_avviato`, lo stato diventa AVVIATA_COME_CASO. |

---

## 6. Decisioni

### 6.1 Prese

| Quando | Decisione | Dove sta |
|---|---|---|
| 14/10 | Base del ramo su `feat/casi-duso` (proposta del prompt) e via libera di Arresto A (D12); piano approvato con le unioni in avanti tra i tre rami locali | §1; PIANO-LAVORI §2 |
| 14/10 | Precedenza dei 12 stati come nel prompt (D10, predefinita e reversibile); tabella a 23 righe condivisa con l'hub | `status.ts`, `status.fixtures.ts` |
| 14/10, arresto A | Trigger per `status_changed_at` e backfill da `submitted_at`, poi `created_at` (confermati con il via libera di Arresto A e con la decisione 7 di arresto B) | 0019, README §2 |
| 14/10, arresto B | 1. profilo del cliente e modello delle istruzioni nel database, per workspace (fatto con K8); 2. invio «integra» con lo stato «possibile doppione»; 3. etichette di riserva confermate; 4. token del connettore a 90 giorni, avviso da 14 giorni prima; 5. limiti di fase 1 (200 invii e 3.000 letture l'ora per credenziale, 1.000 invii al giorno per workspace, giorno da mezzanotte di Roma); 6. avviso sanitario dopo il salvataggio, senza `acknowledgedWarnings`; 7. modello del ranking `claude-sonnet-5-5`, REST che risponde prima del ranking | README §5 |
| 14/10 | WP7 ridotto alla scheda «Connettore Claude»; il resto all'hub | PIANO-LAVORI §3.5 |
| 19/10 | Ricerca senza accenti con `unaccent`, creata dalla migrazione e dal self-heal; indice nuovo, vecchio tenuto | README §1 e §2 |
| 19/10 | `statusChangedAt` di AVVIATA_COME_CASO = giorno di avvio del dossier (ora italiana) | README §1 |
| 19/10 | `scoring-model` passa all'hub (punteggio v2); dossier precompilato dai dati raccolti all'hub (H6a) | README §1 e §5 |
| 19/10 | Dialogo in Claude Code e organizzazione di prova a Pierpaolo | VERIFICA §2 e §3 |
| 19/10, K9 | Plugin modello con un nome neutro (`plugins/unbundle-organizzazione/`): il nome del cliente nasce solo nei pacchetti, fuori da git | README §5 |

### 6.2 Ancora aperte (le decide Pierpaolo)

1. **Cancello «Request headers»**: l'Owner dell'organizzazione del cliente vede «Request headers» in «Add custom connector»? Se no, la fase 1 non si usa con l'organizzazione e si decide se anticipare l'OAuth (`OAUTH-FASE2.md`, 8-12 giorni).
2. **Prefisso dei codici**: quello proposto dal prompt (WP8) sta nella configurazione privata del cliente. Va confermato prima di `backfill-codes` (PIANO-LAVORI §7.1, decisione 7).
3. **Stato per codice leggibile da tutta l'organizzazione, con codici in sequenza**: accettare il rischio in fase 1? Mitigazioni già fatte: limite delle letture, forma ridotta per le nascoste, avviso accanto alla nota pubblica (hub), regola sui titoli nella guida. In fase 2 lo stato si può limitare a chi ha proposto (`OAUTH-FASE2.md` §12).
4. **Link assoluti nella REST**: oggi restano relativi, come chiede il prompt. Cambiarli cambia la forma della risposta.
5. **Accesso dell'anteprima Vercel** per l'organizzazione di prova: dominio di prova senza protezione, protezione sospesa per la prova, oppure «Protection Bypass for Automation» (header non standard, da far approvare ad Anthropic, occupa uno dei 4 header).
6. **`.mcp.json` nel plugin** dopo la prova nell'organizzazione di prova (VERIFICA §3.2, voce 10).
7. **Storia locale con valori del cliente** (§1): sistemarla o accettarla, prima di un push o di un'unione.
8. **Indirizzo email del referente Lateral Space** per la modalità senza connettore: oggi la skill dice «il tuo referente Lateral Space». Se serve un indirizzo, va deciso dove metterlo (guida o pacchetto del cliente).
9. **Guida del cliente da completare**: la descrizione di un agente che le fonti non descrivono e la conferma di `esgEnabled` (oggi falso; lo script si ferma se il workspace dice altro).
10. **`Origin` di claude.ai e ripiego da `server/discover`**: si leggono nei log dell'anteprima (VERIFICA §3.2, voci 6 e 7). Se claude.ai non ripiega su `initialize`, serve aggiornare l'SDK MCP del server.
11. **Fase 2**: le decisioni di `OAUTH-FASE2.md` §16 (app in Azure, progetto Firebase a parte per il rischio di §9.4, durata del refresh, stato limitato a chi ha proposto, client ammessi, revoca automatica di un token in un indirizzo, decisione dell'AI Board).
12. **MCP Inspector**: solo con il suo sì (scaricamento di un pacchetto).
13. **Modello del ranking**: una chiamata vera alla prima anteprima.
14. **Unioni in avanti S6 e S5** (§1): previste dal piano e già approvate come classe; le fanno la prossima sessione del connettore (S6) e la sessione dell'hub (S5).

---

## 7. Cosa deve fare Pierpaolo

In quest'ordine.

1. **Controllo «Request headers»** con l'Owner dell'organizzazione del cliente: Organization settings › Connectors › Add › Custom › Web. Esito in VERIFICA §5 (voce 1). È il dato che decide se la fase 1 serve all'organizzazione.
2. **Branch Neon di sviluppo per le anteprime.** Oggi le anteprime Vercel usano il `DATABASE_URL` di produzione (una sola variabile per Preview e Production), e il self-heal altera lo schema del database a cui punta alla prima richiesta. Prima di qualunque push che crei un'anteprima: un branch Neon di sviluppo e un `DATABASE_URL` impostato **solo per Preview** su quel branch.
3. **Storia locale** (§6.2, punto 7): decidere prima del push.
4. **Variabili di Vercel**:
   - Preview: `MCP_CONNECTOR_ENABLED=true` solo in Preview, per la prova; la scelta sulla Deployment Protection (§6.2, punto 5);
   - Production: `MCP_CONNECTOR_ENABLED` resta spenta fino all'attivazione;
   - `PORTFOLIO_RANKING_MODEL` facoltativa (senza: `claude-sonnet-5-5`); `UC_ENABLED` come oggi;
   - `MCP_CONNECTOR_PROFILE` non serve più: se c'è, si toglie;
   - `CONNECTOR_ADMIN_DATABASE_URL` mai su Vercel né in un file: solo nella shell di chi lancia lo script.
5. **Dialogo in Claude Code** contro il server locale, con un Claude Code che ha il login: procedura in VERIFICA §2 (preparazione, workspace sintetico con `dialog-workspace.mjs`, sei dialoghi, chiusura), esiti in VERIFICA §5, senza token né testi.
6. **Organizzazione Claude di prova**: preparazione in VERIFICA §3.1 (anteprima con il branch Neon, protezione, workspace caricato con `connector-admin --environment preview`, pacchetti, indirizzo, accensione dalla scheda) e checklist di 18 voci in VERIFICA §3.2; esiti in VERIFICA §5.
7. **Unione in `main`**, solo con il suo sì e una alla volta, nell'ordine del piano: `feat/casi-duso`, poi `feat/connettore-mcp`, poi l'hub. Prima del deploy si applicano a mano le migrazioni del ramo (`psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0019_connettore_mcp.sql`), perché il self-heal altera lo schema alla prima richiesta.
8. **Script operatore sul workspace del cliente**, in produzione, lanciati da lui. Nella shell: `export CONNECTOR_ADMIN_DATABASE_URL=…`. Ogni comando prima a secco, poi con `--apply --confirm-authorized --confirm-database <host>/<database> --environment production --production-approved`:
   1. `config --workspace <id> --file docs/connettore/config-<cliente>.private.json` (crea la riga spenta);
   2. `profile --workspace <id> --file docs/connettore/profilo-<cliente>.private.json --guide-file docs/connettore/guida-<cliente>.private.json` (profilo, modello delle istruzioni e guida in un solo UPDATE), dopo aver completato la guida (§6.2, punto 9);
   3. `backfill-codes --workspace <id>`, solo dopo aver confermato il prefisso (§6.2, punto 2): a secco mostra i codici previsti;
   4. `token --workspace <id> --label "Connettore Claude"`: il token si stampa una volta sola; va nel connettore come header `Authorization: Bearer <token>`, mai in un indirizzo;
   5. accensione dalla scheda «Connettore Claude» (Impostazioni › Integrazioni); poi `config` a secco: nella prontezza `"acceso": true` e `"mancano": []`.
9. **Prima dell'attivazione reale** (README §6): guardrail del 27/10; scheda A.8 con Unbundle e i fornitori e le regioni (Vercel, Neon, Firebase, Anthropic API, eventualmente Resend e Slack); regola di conservazione; email al referente change management del cliente; costi autorizzati per iscritto (art. 8.4); decisione dell'AI Board sull'autenticazione.
10. **Le decisioni aperte di §6.2.**

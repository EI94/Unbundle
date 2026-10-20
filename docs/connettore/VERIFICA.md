# Verifica del connettore «Unbundle» (WP10)

Questo documento raccoglie le verifiche del connettore che non bastano i test a dimostrare: cosa è già provato in locale, il dialogo in Claude Code che fa Pierpaolo, la checklist dell'organizzazione Claude di prova e le schermate della scheda «Connettore Claude». Il resto (moduli, schemi, codici, rotta) è in `README.md`.

Regole per chi registra gli esiti: niente token, niente indirizzi con un token, niente testi delle segnalazioni, niente nomi o email, niente valori del cliente. Si scrive sì, no, un codice d'esito (`connector_disabled`), un numero o un'origine (`https://…`). Solo dati sintetici.

---

## 1. Cosa è già verificato in locale (pacchetto K10 e sua revisione, 19/10/2026)

Tutto su `127.0.0.1`: cluster del connettore sulla porta 55469 (database `conn_k10`, poi `conn_k10r` per la revisione, copiati dal modello), app su 53130, emulatore di Auth su 59129. La tabella dà gli esiti dell'ultimo giro, dopo la revisione di K10. Nessun file `.env*`, nessun database remoto.

| Verifica | Comando | Esito |
|---|---|---|
| lint, tipi e test di tutto il repository | `env -u DATABASE_URL -u ANTHROPIC_API_KEY npm run check` | superato; `test:connector` 404 test, 325 superati e 79 saltati (le suite d'integrazione, che girano solo sul database locale; con K10: 392, 318 e 74) |
| integrazione sul database locale | `UC_TEST_PG_DB=conn_k10r npm run test:connector:db` | 97/97 (con K10: 92; prima di K10: 74) |
| schema: 0019 due volte, self-heal, ricerca senza accenti | `UC_TEST_PG_PORT=55469 node scripts/connettore-test/schema-check.mjs` | 32/32 (DDL non cambiato da K8) |
| smoke con `next start`, avviato dallo script (partenza a freddo vera) | `node --no-warnings scripts/connettore-test/smoke-run.mjs --start-app` | giro completo 40/40, righe 5/5, secchio pieno 11/11, connettore sospeso 12/12, nessuna riga in più, log del server 3/3 (18 valori vietati cercati) |
| schermate della scheda «Connettore Claude» | `node --no-warnings scripts/connettore-test/screens.mjs` | 75/75, 10 schermate (§4) |
| Claude Code 2.1.299 (il binario dell'app desktop) contro il server locale, con una configurazione temporanea | script fuori da git (sotto) | collegato con l'header; 4 tool; nessuna modifica alla configurazione dell'utente |

**Nuove suite di K10** (in `src/lib/connector/`, lanciate da `run-db-tests.mjs`):

- `classroom.integration.test.ts`: 30 persone sullo stesso token nella stessa ora, ognuna con un client dell'SDK (initialize, tools/list, guida, due ricerche, un invio, uno stato), mai `rate_limited`; `initialize` e `tools/list` non consumano (120 letture e 30 invii esatti); poi fino a 200 invii nell'ora e il 201° riceve `rate_limited` con `retryAfterSeconds` fino alla fine dell'ora, mentre il duplicato di un invio dell'aula riceve ancora `duplicate: true` e le letture passano (criteri 6 e 9 sulla rotta vera).
- `isolation.integration.test.ts`: due workspace accesi con la stessa segnalazione e la stessa chiave di idempotenza. Ognuno riceve il suo codice (`IA-0001`, `IB-0001`) e il suo duplicato, trova solo le sue segnalazioni e gli agenti della sua guida, vede `not_found` per il codice dell'altro (anche con lo stesso numero), riceve `unknown_related_code` per un codice dell'altro, la sua guida, i suoi secchi del limite; il token di uno non apre l'altro; un invio REST di A non si vede da B (criterio 19).
- `errors-logs.integration.test.ts`: i 16 codici d'errore del contratto, ognuno da un input o da uno stato fatto apposta, sempre HTTP 200, `isError: true`, solo `error`, `message`, `fieldErrors`, `retryAfterSeconds` e la copia testuale JSON, mai un valore ricevuto (criterio 7). Poi tutto ciò che il processo scrive su stdout e stderr durante la suite, compresi zod, errori veri di Postgres che contengono il titolo, la query o l'email, ranking e notifica che falliscono dopo la risposta, 401, token nell'indirizzo, `Origin`, 415, 413, JSON non valido e la REST: nessun token, hash, testo, nome o email (criterio 13). Un controllo a mano con una riga di prova che scrive un'email su stderr fa fallire il test.
- `route.integration.test.ts`, in più: una segnalazione creata come fa lo Slack intake (`buildUseCaseDataFromSlackDraft` e `createUseCase`) riceve il codice e si trova con la ricerca.
- `dialog-workspace.integration.test.ts` (revisione di K10): `scripts/connettore-test/dialog-workspace.mjs` lanciato davvero. Con un altro database o un'altra porta nella shell si rifiuta senza toccare nulla; senza la riga della configurazione o del token fallisce invece di dire «sospeso» o «attivo»; `remove` tiene lo stato finché il token non è revocato e i dati non sono cancellati (in una transazione).

**Smoke con `next start`** (`smoke-run.mjs --start-app`, database `conn_k10r`, guida d'esempio, profilo e modello sintetici):

- partenza (ultimo giro, dopo la revisione di K10, con una build nuova): pid del figlio stampato subito, porta in ascolto dopo 203 ms; prime chiamate a freddo: `initialize` 483 ms, prima guida 7 ms, primo invio 19 ms (misurate e riportate, non contano per il criterio). Sull'HEAD finale di K10: 204 ms, `initialize` 476 ms;
- 20 invii a caldo: p50 7 ms, p95 11 ms, max 11 ms (criterio p95 sotto 2 s);
- giro completo: initialize con 2025-11-25 e con un client 2025-06-18, istruzioni (1.901 caratteri), 4 tool con titoli, annotazioni e schemi (anche l'ordine delle chiavi sul filo), guida con rubrica e catalogo, ricerca, invio `TJ-0001` RICEVUTA con `link: null`, stessa chiave → `duplicate: true`, stato, ricerca senza campi vietati; errori del contratto `invalid_payload`, `missing_impact_measure`, `sensitive_content` (telefono inventato), `unknown_related_code`, `idempotency_conflict`, `not_found`, `identity_required`; HTTP 401, 400 (token nella query), 405 con `Allow: POST` per sei metodi, 403 (`Origin`), 415, 413, 406, intestazioni di igiene;
- righe salvate: primo codice `TJ-0001`, `source = claude_connector`, `intake.contractVersion = 2`, `impact_*` e `custom_scores` vuoti, nessuna riga per il duplicato, token mai segnato come esposto;
- secchio degli invii pieno (limite portato a 1 l'ora): il duplicato passa, un invio nuovo riceve `rate_limited` con `retryAfterSeconds` fino alla fine dell'ora, le letture passano;
- connettore sospeso: `initialize` e `tools/list` funzionano, i 4 tool rispondono `connector_disabled` (ciò che serve a Claude per il piano B);
- log di `next start`: nessun token (nemmeno il prefisso `ub_mcp_`), hash, testo libero dell'invio davvero mandato, nome, email o telefono (anche solo cifre): 18 valori cercati; 72 righe `[mcp] call`; l'`Origin` non ammessa compare come `other`. Il log è salvato fuori da git in `$UC_TEST_ROOT/conn-evidence/k10/next-start-<giro>.log`, solo se `UC_TEST_ROOT` è una cartella temporanea fuori dalla checkout.

**Claude Code 2.1.299 contro il server locale** (configurazione temporanea con `CLAUDE_CONFIG_DIR`, nessun login, nessuna chiamata al modello; `~/.claude.json` dell'utente non contiene `unbundle-test` né prima né dopo):

- `claude mcp add --transport http --scope local unbundle-test <url> --header "Authorization: Bearer …"` poi `claude mcp get` e `claude mcp list`: «✔ Connected». Il server vede `initialize`, `notifications/initialized` e `tools/list`, nessuna riga nel limite di richieste.
- Prima di `initialize` Claude Code manda `server/discover` con il protocollo **2026-07-28**. L'SDK 1.29 del server risponde 400 («Unsupported protocol version») e Claude Code ripiega su `initialize` con 2025-11-25: funziona. Nel log la riga è `"tool":"server/discover","outcome":"http_400"` (K10 aggiunge il nome del metodo al log; un test fissa il comportamento).
- Con l'header scritto tra apici singoli, `--header 'Authorization: Bearer ${UB_CONNECTOR_TEST_TOKEN}'`, Claude Code salva la variabile e non il token, e la espande quando si collega: con la variabile impostata «Connected», senza 401. Con l'header espanso dalla shell il token resta in chiaro nella configurazione locale.
- `claude mcp get` mostra a schermo l'header espanso: non usarlo mentre si condivide lo schermo.

**Non fatto in locale.** Il dialogo con il modello in Claude Code (il Claude Code di questo Mac non ha un login: lo fa Pierpaolo, §2) e MCP Inspector (`npx @modelcontextprotocol/inspector` scarica un pacchetto: solo con il sì di Pierpaolo; lo smoke usa già il client ufficiale dell'SDK).

---

## 2. Dialogo in Claude Code contro il server locale (lo fa Pierpaolo)

Serve un Claude Code con il login (l'app desktop o la CLI), la checkout `feat/connettore-mcp` senza file `.env*` e con un `node_modules` fisico, e il cluster locale del connettore. Il token di prova vive solo in un file fuori da git e in una variabile della shell; il database tiene l'hash. Dati sintetici: la guida d'esempio (aree come «Amministrazione» o «Vendite», agenti «atlante» e «boreale»), il prefisso `TJ`.

### 2.1 Preparazione (terminale A)

```sh
cd /Users/pierpaololaurito/unbundle-connettore
export UC_TEST_ROOT=/private/tmp/<cartella>/conn UC_TEST_PG_PORT=55469 UC_TEST_PG_SOCKET_DIR=/private/tmp/cnpg
node scripts/uc-test/db-init.mjs status                              # «running on 127.0.0.1:55469», altrimenti: start
createdb -h 127.0.0.1 -p 55469 -U uc_test -T unbundle_conn_test conn_dialogo
export UC_TEST_PG_DB=conn_dialogo
node --no-warnings scripts/connettore-test/start-app.mjs --build
node --no-warnings scripts/connettore-test/start-app.mjs --production   # resta aperto: 127.0.0.1:53130
```

### 2.2 Workspace e token (terminale B, stesse variabili `UC_TEST_*`)

```sh
node --no-warnings scripts/connettore-test/dialog-workspace.mjs create
```

Lo script crea un'organizzazione e un workspace sintetici con il connettore acceso, la guida d'esempio, il profilo e il modello sintetici e un token valido un giorno. Il token non compare: sta in `$UC_TEST_ROOT/conn-dialog/token` (permessi 0600). Lo script stampa lo slug, l'indirizzo e i due comandi da usare qui sotto.

### 2.3 Collegare Claude Code (terminale B)

```sh
export UB_CONNECTOR_TEST_TOKEN="$(cat $UC_TEST_ROOT/conn-dialog/token)"
claude mcp add --transport http --scope local unbundle-test http://127.0.0.1:53130/api/mcp/connettore/<slug> \
  --header 'Authorization: Bearer ${UB_CONNECTOR_TEST_TOKEN}'
claude mcp list                                   # «unbundle-test … ✔ Connected»
claude --plugin-dir plugins/unbundle-organizzazione
```

- Gli **apici singoli** sono voluti: Claude Code salva `${UB_CONNECTOR_TEST_TOKEN}` e lo legge dall'ambiente a ogni collegamento (provato il 19/10/2026 con la versione 2.1.299). Claude va lanciato dalla shell dove la variabile c'è.
- È la forma del prompt (WP10), con lo scope `local`: vale solo per questa cartella.
- `--plugin-dir` carica per la sessione il plugin modello con la skill `segnala-caso-uso`, senza installarlo.
- In Claude Code i tool si chiamano `mcp__unbundle-test__get_intake_guide` e così via, non `Unbundle:…`: la skill lo prevede («se in questa app i tool compaiono con un prefisso diverso, sono gli stessi»). Claude Code chiede il permesso alla prima chiamata di ogni tool: consentilo per la sessione.
- Non lanciare `claude mcp get unbundle-test` con lo schermo condiviso: mostra l'header.

### 2.4 I dialoghi

Ogni dialogo in una conversazione nuova (`/clear`). Dopo ogni invio, nel terminale A o in un terzo terminale: `node --no-warnings scripts/connettore-test/dialog-workspace.mjs status` (codici, tipo, fonte, stato, «integra»; nessun testo).

| # | Cosa scrivere | Cosa deve succedere |
|---|---|---|
| 1. Idea da zero (scenario B) | «Vorrei proporre un'idea: ogni mese in amministrazione due persone fanno a mano la riconciliazione delle fatture dei fornitori con gli ordini nel gestionale.» Rispondi alle domande con numeri inventati. | `get_intake_guide` prima delle domande; al massimo 2 giri, ognuno in un messaggio; una sola domanda sul tempo («quanto tempo ti fa risparmiare ogni volta»); chiede il nome (identità «dichiarata»); `find_similar_contributions` prima del riepilogo; se la ricerca contiene «riconciliazione» (la parola chiave di «atlante» nella guida d'esempio: gli agenti si trovano solo per parola chiave), l'agente «atlante» proposto; se Claude non usa quella parola, annotarlo: non è un errore del server; stima con il calcolo scritto; riepilogo completo con la riga sulla visibilità di titolo e stato ai colleghi; «Confermi l'invio?»; invio solo dopo il sì; risposta con `TJ-0001` e «Ricevuta». |
| 2. Best practice già fatta in chat (scenario A) | Prima un compito: «Riscrivi in modo più chiaro questa risposta standard a un cliente che chiede i tempi di consegna: "Gentile cliente, la consegna avviene entro 5 giorni lavorativi dall'ordine."». Poi: «Questa cosa la potrebbero usare anche i colleghi delle vendite.» | Prima finisce il compito, poi propone la segnalazione con una domanda di una riga e parte solo dopo un sì; `best_practice`, «funzionante»; `promptSnippet` ripulito; un solo giro di domande o nessuno; codice `TJ-0002`. |
| 3. Lavoro in corso (scenario C) | «Sto costruendo con te un foglio che segnala i documenti di magazzino in scadenza, non è ancora finito: vorrei segnalarlo.» | `use_case_ai`, «prototipo»; l'agente «boreale» proposto dalla ricerca; codice `TJ-0003`. |
| 4. Doppione | Conversazione nuova: «Voglio proporre di automatizzare il confronto tra le fatture dei fornitori e gli ordini.» Quando Claude mostra `TJ-0001`: «È un'integrazione: aggiungerei anche le note di credito.» | La ricerca trova `TJ-0001`; Claude chiede se è la stessa cosa, un'integrazione o un'idea diversa; invio con `relatedCode` `TJ-0001` e `relationType` «integra»; risposta «In valutazione (possibile doppione di TJ-0001)»; `status` mostra «integra TJ-0001». |
| 5. Stato | «A che punto è TJ-0001?» Poi, in una conversazione nuova: «A che punto è la mia proposta?» | Con il codice: titolo, «Ricevuta», giorno del cambio, nessuna nota interna né punteggio. Senza codice: `identity_required` e Claude chiede il codice in una frase. |
| 6. Connettore sospeso (piano B) | Terminale B: `dialog-workspace.mjs suspend`. Conversazione nuova: «Voglio proporre un caso d'uso: preparare in automatico i promemoria delle scadenze dei contratti.» Alla fine: `dialog-workspace.mjs resume`. | I tool rispondono `connector_disabled`; Claude lo dice in una frase senza gergo, fa comunque il dialogo e prepara il riepilogo in un blocco con «NON ANCORA INVIATA» in cima e «Controllo doppioni non eseguito» in fondo, da mandare per email al referente Lateral Space; non dice mai «inviata»; `status` non mostra righe nuove. |

In tutti: niente emoji, niente trattini lunghi, frasi brevi; nessun numero o importo in euro inventato; nessun codice tecnico mostrato alla persona.

### 2.5 Chiusura

```sh
claude mcp remove unbundle-test -s local
node --no-warnings scripts/connettore-test/dialog-workspace.mjs remove    # revoca il token, cancella i dati e il file del token
unset UB_CONNECTOR_TEST_TOKEN
# terminale A: Ctrl-C su start-app.mjs, poi
dropdb -h 127.0.0.1 -p 55469 -U uc_test conn_dialogo
```

L'esito si registra in §5, senza token né testi.

---

## 3. Organizzazione Claude di prova (la fa Pierpaolo, con l'Owner se serve)

### 3.1 Prima della prova (decisioni e passi di Pierpaolo)

1. **Indirizzo pubblico.** Serve un'anteprima Vercel del ramo. Oggi le anteprime usano il `DATABASE_URL` di produzione e il self-heal altererebbe lo schema di produzione al primo avvio (README §2): prima si imposta un `DATABASE_URL` solo per Preview su un branch Neon di sviluppo. Poi `MCP_CONNECTOR_ENABLED=true` solo in Preview.
2. **Deployment Protection.** Blocca le chiamate dal cloud di Anthropic. Una delle tre: un dominio di prova senza protezione; la protezione sospesa per la durata della prova; «Protection Bypass for Automation» (header `x-vercel-protection-bypass`: nome non standard, va approvato da Anthropic e occupa uno dei 4 header ammessi). Decide Pierpaolo.
3. **Workspace sul database dell'anteprima.** Un workspace creato dall'app, poi `scripts/connector-admin.ts` con `CONNECTOR_ADMIN_DATABASE_URL` del branch di sviluppo e `--environment preview`, in quest'ordine: `config`, `profile` (con `--guide-file`), `token` (README §1, «Configurazione del workspace»); l'accensione è il passo 6. File sintetici, tutti in `docs/connettore/`: `config --file docs/connettore/config-esempio.json`, poi `profile --file docs/connettore/profilo-esempio.json --guide-file docs/connettore/guida-esempio.json` (la guida d'esempio dice `esgEnabled: false`, come un workspace nuovo dell'app); oppure, se Pierpaolo lo decide, i file privati del cliente. Il token si copia una volta sola dall'uscita di `token --apply` nell'header del connettore; in alternativa la scheda «Connettore Claude» dell'anteprima.
4. **Pacchetti.** `node --no-warnings scripts/connector-package.mjs --config <configurazione del pacchetto>` produce fuori da git il plugin di fase 1, la variante con `.mcp.json` (solo per la voce 8) e la skill da sola. Nella configurazione lo slug del workspace dell'anteprima.
5. **Indirizzo del connettore**: `https://<dominio dell'anteprima>/api/mcp/connettore/<slug>`.
6. **Accendere il connettore.** `config` crea la riga sempre spenta e nessun comando di `connector-admin` tocca l'interruttore: senza questo passo l'handshake e `tools/list` funzionano (il connettore risulta collegato), ma ogni tool risponde `connector_disabled`. Scheda «Connettore Claude» dell'anteprima (Impostazioni › Integrazioni), interruttore su acceso. Poi `connector-admin config` a secco (senza `--apply`) con lo stesso file: nella prontezza `"acceso": true` e `"mancano": []`.

### 3.2 Checklist

| # | Voce | Come si verifica | Cosa registrare |
|---|---|---|---|
| 1 | **Compare «Request headers»** nel dialogo «Add custom connector»? Dato decisivo per la fase 1. | Organization settings > Connectors > Add > Custom > Web. | sì / no. Se no: la fase 1 non si usa con l'organizzazione e Pierpaolo decide se anticipare l'OAuth (WP11). |
| 2 | Aggiunta del connettore | «No sign-in»; header `authorization` con valore `Bearer ` e il token, una riga. Prima chiamata a un tool: niente `connector_disabled` (altrimenti manca il passo 6 di §3.1). | aggiunto sì / no; nomi esatti dei menu. |
| 3 | I membri vedono il valore dell'header? | Un account membro (non Owner): Customize > Connectors > Unbundle. | sì / no (se sì, il token è visibile a tutta l'organizzazione: da sapere prima dell'aula). |
| 4 | Con «No sign-in» serve comunque «Connetti»? | Lo stesso membro, prima di cliccare: i tool sono disponibili in chat? | sì / no. |
| 5 | Il connettore con header arriva anche in Claude Code? | Un membro con Claude Code collegato all'account dell'organizzazione: `/mcp`. | sì / no; nome con cui compare. |
| 6 | **claude.ai manda un header `Origin`? Quale?** | Log dell'anteprima su Vercel, righe `[mcp] call` dopo il primo collegamento. Dal K10 la riga porta `"origin"` quando la richiesta ha l'header: il valore se è un'origine dei client di Claude (`https://claude.ai`, `https://claude.com`, `https://anthropic.com`, anche con `www.`) o ammessa dal workspace, altrimenti `"other"`. Con l'elenco vuoto ogni `Origin` dà 403 `origin_not_allowed` e il connettore non si collega. | nessun campo `origin` (claude.ai non lo manda: niente da fare) / l'origine trovata / `other`. Se c'è un'origine e il connettore non si collega, Pierpaolo decide se aggiungerla con `connector-admin config` (`allowedOrigins`). Con `other` l'origine non è nell'elenco dei client di Claude: va scoperta prima di ammetterla. |
| 7 | Protocollo | Stesse righe: c'è `"tool":"server/discover","outcome":"http_400"` seguito da `"tool":"initialize","outcome":"ok"`? | ripiega su `initialize` sì / no. Se c'è solo `server/discover` senza `initialize`, claude.ai non ripiega: serve aggiornare l'SDK MCP del server (punto aperto). |
| 8 | Permessi dei tool | Customize > Connectors > Unbundle > Tool permissions (o Organization settings > Connectors). Consigliato: letture «Always allow», `submit_contribution` «Needs approval». | percorso esatto; impostazioni applicate. |
| 9 | Plugin di fase 1 | Organization settings > Plugins & skills > Upload a plugin, lo zip **senza** `.mcp.json`; «Installed by default». | caricato sì / no; la skill compare per i membri. |
| 10 | Variante del plugin con `.mcp.json` (solo qui, poi si toglie) | Caricare lo zip «-con-connettore» al posto di quello di fase 1. | compare un secondo «Unbundle»? chi lo collega riceve 401? i tool si chiamano `Unbundle:…` (in Claude Code la documentazione dice `mcp__plugin_<plugin>_Unbundle__<tool>`)? Poi rimettere il plugin di fase 1. |
| 11 | I 5 dialoghi in claude.ai | I dialoghi 1-5 di §2.4 (scenari B, A, C, doppione, stato), con i codici del workspace dell'anteprima. | per ognuno: riuscito sì / no, codice ricevuto, stato; ciò che non va. |
| 12 | Piano B in claude.ai | Scheda «Connettore Claude» dell'anteprima: interruttore su sospeso; dialogo 6 di §2.4; poi riaccendere. | `connector_disabled` gestito sì / no; blocco «NON ANCORA INVIATA» sì / no. |
| 13 | Prova in Cowork | Dialoghi 1 e 5. Con «Allow 'Always allow' for connector tools» spento l'invio chiede conferma ogni volta. | riuscito sì / no; conferma all'invio sì / no. |
| 14 | Prova da mobile | App Claude sul telefono: dialogo 5 e una proposta breve. | tool disponibili sì / no; riuscito sì / no. |
| 15 | Skill spenta: claude.ai e Cowork leggono le istruzioni del server? | Spegnere la skill (o il plugin) per l'account di prova, poi «Voglio proporre un caso d'uso». | Claude chiama `get_intake_guide` per primo, fa al massimo due giri, mostra il riepilogo e chiede «Confermi l'invio?»: sì / no, in claude.ai e in Cowork. |
| 16 | Log dell'anteprima | Un campione di righe `[mcp] call` e degli errori. | nessun token, testo, nome o email: sì / no. |
| 17 | Schermate della dashboard (WP7) | Scheda «Connettore Claude» dell'anteprima con dati sintetici; la scheda della segnalazione (nota pubblica, «Nascondi dalla ricerca», «Segna come doppione», «Oscura testo», dati raccolti) è dell'hub (H3b, H4b) e si chiude all'arresto H-B. | percorsi delle schermate, fuori da git. |
| 18 | Pulizia | Archiviare le segnalazioni di prova, revocare il token, togliere il connettore e la variante del plugin. | fatto sì / no. |

---

## 4. Schermate della scheda «Connettore Claude» (K7r)

Rigenerate il 19/10/2026 con il driver (`scripts/connettore-test/screens.mjs`, emulatore di Auth su 59129, `next start --auth-emulator` su 53130, database `conn_k10`, poi di nuovo dopo la revisione di K10 su `conn_k10r`): 75/75 controlli (testi della scheda, nessuno scorrimento orizzontale, nessun «Application error» né errore in console, token nuovo mostrato una volta e salvato solo come hash, sospensione con `updated_by` e riattivazione, revoca del solo token esposto, nessuna scheda per chi non gestisce le integrazioni né sulla riga di D6). Le pagine non sono cambiate da K7r. File fuori da git, in `$UC_TEST_ROOT/conn-evidence/k7r/` (in questa sessione `UC_TEST_ROOT` è la cartella temporanea `/private/tmp/claude-501/…/scratchpad/conn`):

| Larghezza | Pagina intera | Scheda | Token creato | Sospeso | Dopo la revoca |
|---|---|---|---|---|---|
| 1440 px | `k7r-w1440-pagina.png` | `k7r-w1440-scheda.png` | `k7r-w1440-token-creato.png` | `k7r-w1440-sospeso.png` | `k7r-w1440-dopo-revoca.png` |
| 400 px | `k7r-w400-pagina.png` | `k7r-w400-scheda.png` | `k7r-w400-token-creato.png` | `k7r-w400-sospeso.png` | `k7r-w400-dopo-revoca.png` |

Per rigenerarle: README §4, «Schermate della scheda "Connettore Claude" (K7r)».

---

## 5. Esiti da registrare

### Dialogo in Claude Code (§2)

| # | Data | Versione di Claude Code | Riuscito | Codice e stato | Note (senza token né testi) |
|---|---|---|---|---|---|
| 1. Idea da zero | | | | | |
| 2. Best practice | | | | | |
| 3. Lavoro in corso | | | | | |
| 4. Doppione | | | | | |
| 5. Stato | | | | | |
| 6. Piano B | | | | | |

### Organizzazione di prova (§3)

| # | Data | Esito | Note |
|---|---|---|---|
| 1. «Request headers» | | | |
| 2. Aggiunta | | | |
| 3. Header visibile ai membri | | | |
| 4. «Connetti» con «No sign-in» | | | |
| 5. Claude Code | | | |
| 6. `Origin` | | | |
| 7. `server/discover` e ripiego | | | |
| 8. Permessi dei tool | | | |
| 9. Plugin di fase 1 | | | |
| 10. Variante con `.mcp.json` | | | |
| 11. 5 dialoghi | | | |
| 12. Piano B | | | |
| 13. Cowork | | | |
| 14. Mobile | | | |
| 15. Skill spenta | | | |
| 16. Log | | | |
| 17. Schermate | | | |
| 18. Pulizia | | | |

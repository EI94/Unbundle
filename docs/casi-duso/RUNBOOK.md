# Casi d'uso · Runbook di produzione

Cosa fa Pierpaolo, in che ordine, per accendere i dossier dei Casi d'uso in produzione, tornare indietro e gestire gli incidenti. Riferimenti: `docs/casi-duso/DESIGN.md` §7.1 (P0), `docs/use-case/PIANO-LAVORI.md` §7 e `docs/casi-duso/AMBIENTE.md` (variabili e harness).

Regole di questo documento:
- **Niente valori.** Qui ci sono solo nomi di variabili, comandi e controlli. I segreti si generano sul proprio computer e si scrivono solo nella dashboard di Vercel o nella shell del momento.
- **Nessun nome di cliente.** Workspace e casi si indicano con il loro UUID o con un codice inventato (XX-0012).
- **Ogni passo in produzione lo esegue Pierpaolo.** Gli agenti lavorano solo sul harness locale (`127.0.0.1`).

| § | Contenuto |
|---|---|
| 1 | Prima del go-live: decisioni e controlli |
| 2 | Variabili per ambiente |
| 3 | Migrazione 0018 (ramo Neon, poi produzione) |
| 4 | Go-live per workspace |
| 5 | Ritorno indietro |
| 6 | Incidenti |
| 7 | Richieste sui dati, conservazione e cancellazione |
| 8 | Schema, seed e template |
| 9 | Controlli: `uc-doctor`, `perf-smoke`, CI, log |
| 10 | Use case: «Chiedi al referente», la campanella per persona, gli avvisi a chi ha chiesto |

---

## 1. Prima del go-live

**Decisioni di Pierpaolo** (`docs/use-case/PIANO-LAVORI.md` §7.1):
1. **Regione delle funzioni Vercel** (domanda 3 di `DESIGN.md` §9.2). Vale per tutto Unbundle. Se la scelta è Francoforte, in `vercel.json` si aggiunge una riga e si fa un deploy:
   ```json
   "regions": ["fra1"]
   ```
   Il pacchetto C11 **non** l'ha aggiunta: senza la decisione la regione resta quella di oggi. Dopo la scelta, controllare che anche gli store Blob (standard e zona personale) siano in Europa: dashboard Vercel › Storage › store › Settings › Region.
2. **Workspace e data del go-live** (domanda 4). Ogni workspace dei dossier deve avere **già** la pagina Use case accesa (`USE_CASE_HUB_WORKSPACES`, §4): con `*` lo è ogni workspace che non sta in `USE_CASE_HUB_EXCLUDE`.
3. **Testi legali** (domanda 2) e **scheda privacy A.8** prima di qualunque dato reale nella zona personale.

**Prerequisiti tecnici**
- `feat/casi-duso` unito in `main` con il sì di Pierpaolo (`PIANO-LAVORI.md` §2.4, unione 1), con `UC_ENABLED` spento in produzione.
- La pagina Use case (hub) unita e accesa per i workspace che riceveranno i dossier: **la pagina Use case si accende prima dei dossier**.
- P0-16 fatto prima di togliere la voce «Casi d'uso» e di reindirizzare `/casi-duso`: `use-case-admin dossier-dups` a zero doppioni (righe complete e incomplete) **prima della 0020**, poi `use-case-admin dossier-links` dopo la 0020. `uc-doctor` (§9.1) mostra zero doppioni. Finché `dossierLinksReady` non è vero (o la lettura non riesce) il layout tiene la voce «Casi d'uso» sotto «Use case» e non reindirizza `/casi-duso`: un dossier senza scheda resta raggiungibile dalla barra.
- La 0020 si applica **prima** del deploy del codice della pagina Use case: senza, la prima richiesta esegue nella funzione tutto il DDL di recupero (idempotente, una transazione, advisory lock), con lock ALTER durante una richiesta vera, e un errore DDL fa rispondere 500 a ogni pagina use_cases finché non riesce.

**Cosa cambia anche nei workspace con la pagina Use case spenta** (fuori da `USE_CASE_HUB_WORKSPACES`, o in `USE_CASE_HUB_EXCLUDE`) (accettato: stringe la privacy come il commit di produzione 2ae98a7, art. 15.4; D4, D13, D14 valgono per tutti i workspace, non solo per quello dell'AI lab):
- i contributori non vedono più matrice, punteggi e testi in `/portfolio`, `/portfolio/review/<id>`, `/use-cases`, `/use-cases/<id>` e `/plan`; il link di condivisione mostra a chi non è membro solo titolo, fase e «Quando»;
- i segnali «nuova proposta» della campanella vanno ai soli revisori; i testi dei ruoli cambiano per tutti;
- le scritture REST scrivono una riga di Storia e fanno salire `version`; il flusso di invio da Slack è idempotente e svuota i testi della bozza;
- il cron `weekly-pulse` rifiuta un `CRON_SECRET` assente o vuoto (§2);
- l'avvio di un dossier da una scheda arrivata dal connettore porta nel dossier, in sola lettura, problema, soluzione, area e strumenti (decisione del 19/10/2026), anche con l'area spenta: mai il proponente, e solo dove la sezione Casi d'uso è accesa.
Per tenere uno di questi workspace come oggi servirebbe legare D4 a `isUseCaseHubWorkspace`: non si fa, perché riaprirebbe ai contributori dati che la produzione ha già chiuso.

## 2. Variabili per ambiente

Si impostano **a mano** nella dashboard di Vercel, ambiente per ambiente. `scripts/sync-vercel-env.mjs` non copia più gli interruttori né la chiave della zona personale.

| Variabile | Produzione | Anteprima (ramo Neon di sviluppo) | Note |
|---|---|---|---|
| `UC_ENABLED` | `true` solo al go-live | `true` per le prove | interruttore generale |
| `UC_WORKSPACE_IDS` | UUID separati da virgole; vuota = sezione spenta ovunque | UUID, oppure `*` | `*` non vale in produzione; ogni UUID deve avere anche la pagina Use case accesa (`USE_CASE_HUB_WORKSPACES`, `*` compreso, e fuori da `USE_CASE_HUB_EXCLUDE`) |
| `USE_CASE_HUB_WORKSPACES` | `*`: pagina Use case accesa per ogni workspace, anche per quelli creati dopo; oppure UUID separati da virgole | come in produzione | `*` vale anche in produzione (a differenza di `UC_WORKSPACE_IDS`). I prerequisiti di un workspace nuovo li scrive l'app alla creazione (`docs/use-case/DESIGN.md` §12.1): riga di config spenta (slug dal nome più 8 caratteri dell'id: lo slug «pulito» lo dà l'operatore) e modello v2 solo se il workspace non ha né modello né use case. Un modello che c'è non lo tocca mai: un workspace di prima ancora in v1 (o riportato in v1 con `scoring-v2 --revert`) resta com'è, `use-case-admin doctor` lo segnala (`scoring_v2`) e si passa con `scoring-v2 --apply --workspace` |
| `USE_CASE_HUB_EXCLUDE` | facoltativa: UUID separati da virgole con la pagina Use case spenta anche con `*` | come in produzione | il ritorno indietro per un cliente senza togliere `*`; un `*` qui non spegne nulla |
| `UC_SCHEMA_SELF_HEAL` | assente oppure `off`; mai `on` | facoltativa (assente = self-heal acceso) | in produzione (`VERCEL_ENV=production`) il self-heal è spento se la variabile non dice `on`: l'app esegue solo la sonda e risponde 503 se lo schema non è aggiornato |
| `UC_LS_EMAIL_DOMAINS` | domini di Lateral Space | come in produzione | serve anche con i dossier spenti (pagina Use case) |
| `UC_SECRET` | obbligatoria | consigliata | `openssl rand -base64 32`; senza, le scritture dei link rispondono 503 |
| `CRON_SECRET` | obbligatoria | consigliata | senza, i cron uc e `weekly-pulse` rispondono 401 |
| `NEXT_PUBLIC_APP_URL` | `https://…` del dominio pubblico | mai l'URL della singola anteprima | origine dei link nelle email |
| `RESEND_API_KEY`, `UC_EMAIL_FROM` | sì | facoltative | tracciamento di aperture e clic **spento** sul dominio del mittente |
| `UC_EMAIL_REPLY_TO` | sì, se il mittente non riceve posta | facoltativa | un solo indirizzo semplice; reply-to di email dei dossier, riepiloghi e avvisi a chi ha chiesto (e delle email ai referenti quando chi ha chiesto non è più revisore). Assente: nessun reply-to, `uc-doctor` avvisa |
| `BLOB_READ_WRITE_TOKEN` | store standard | store di prova | file della zona standard e quarantena |
| `UC_PERSONAL_ZONE_KEY`, `UC_PERSONAL_BLOB_READ_WRITE_TOKEN` | solo dopo la scheda A.8 | solo per le prove | store Blob **separato**; la chiave non si ruota (perderla = dati personali illeggibili, §6.2) |

Mai su Vercel: `UC_ADMIN_DATABASE_URL`, `UC_LOCAL_STORAGE_DIR`, `UC_TEST_*`.

**Anteprime solo verso un ramo Neon di sviluppo**: un'anteprima collegata al database di produzione ne cambierebbe lo schema al primo avvio (self-heal dell'app).

## 3. Migrazione 0018

Il DDL uc non parte da una richiesta in produzione: lì il self-heal uc è spento, salvo un `UC_SCHEMA_SELF_HEAL=on` scritto a mano (da non fare). La 0018 si applica a mano, prima del deploy che la usa.

1. **Ramo Neon dalla produzione** (console Neon › Branches › Create branch, dal punto di adesso). Copiare l'URL del ramo solo nella shell.
2. **Applicare la 0018 sul ramo**, dalla checkout del commit da rilasciare:
   ```sh
   psql "$URL_DEL_RAMO" --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0018_uc_casi_duso.sql
   ```
   È idempotente: una seconda esecuzione non cambia nulla (i `NOTICE … already exists, skipping` sono normali).
3. **Sonda e controlli** sul ramo, in sola lettura:
   ```sh
   UC_ADMIN_DATABASE_URL="$URL_DEL_RAMO" UC_ENABLED=true UC_SCHEMA_SELF_HEAL=off \
     node --no-warnings scripts/uc-doctor.ts --environment preview
   ```
   Le righe `sonda` e `doppioni` devono essere `OK`.
4. **Prova a vuoto del seed e del template** (nessun accesso al database senza `--apply`): `scripts/uc-load-template.ts --file …` e `scripts/uc-seed-case.ts --file …` (§8).
5. **Tempi sul ramo**: un'anteprima collegata al ramo, poi `perf-smoke` (§9.2) contro l'anteprima solo se Pierpaolo lo decide; altrimenti i tempi del harness.
6. **Produzione**: punto di ripristino Neon (console › Branches › main › Restore point, o un ramo di backup), poi lo stesso `psql` del punto 2 sull'URL di produzione, poi `uc-doctor --environment production` (§9.1).
7. **Solo dopo**, deploy con `UC_ENABLED` ancora spento. L'accensione è il §4.

drizzle-kit non vede le tabelle `uc_*` da nessuno dei due lati: dal codice legge `src/lib/db/schema.drizzle-kit.cjs` (gli schemi senza le tabelle uc) e dal database le toglie con `tablesFilter`. Una prova sicura, senza database: `npx drizzle-kit export --dialect postgresql --schema ./src/lib/db/schema.drizzle-kit.cjs` non contiene nessun `uc_`. Sul database di produzione la regola resta comunque: mai `npm run db:push`, `db:generate` o `db:migrate` senza il sì di Pierpaolo.

## 4. Go-live per workspace

Ordine: prima il workspace di Lateral Space, poi un cliente alla volta. **La pagina Use case prima dei dossier.**

1. Il workspace ha già la pagina Use case accesa (`USE_CASE_HUB_WORKSPACES=*`, o il suo UUID nell'elenco, e non in `USE_CASE_HUB_EXCLUDE`) e la pagina funziona.
2. `uc-doctor --environment production` senza errori (§9.1), con il nuovo UUID già nella variabile che si sta per salvare (si prova nella shell prima di toccare Vercel).
3. Vercel › Settings › Environment Variables › Production: aggiungere l'UUID a `UC_WORKSPACE_IDS` (virgola come separatore). Al primo go-live anche `UC_ENABLED=true`.
4. Redeploy della produzione (le variabili valgono dal deploy successivo).
5. Controlli a mano: il dossier si apre per chi è membro; un workspace fuori elenco riceve 404 su `/dashboard/<ws>/casi-duso/<caso>`; `GET /api/cron/uc-freshness` con il `CRON_SECRET` risponde con `"workspaces": <n>`; le intestazioni di `/r/<token>` hanno la `Content-Security-Policy` (§9.4).
6. **Regole del Vercel Firewall** (una volta, prima del primo link a un cliente), in Vercel › Firewall › Custom Rules, azione «Rate limit», chiave l'IP:
   | Regola | Condizione | Limite indicativo |
   |---|---|---|
   | link personali | `GET` e percorso che inizia con `/r/` | 60 richieste al minuto per IP |
   | API dei link | percorso che inizia con `/api/r/` | 120 richieste al minuto per IP |
   | MCP dei dossier | percorso che inizia con `/api/mcp/casi` | 60 richieste al minuto per IP |
   I limiti dell'app (`uc_rate_limits`) restano: il firewall ferma prima le raffiche.
7. **Log drain e avviso** (P0-6): Vercel › Settings › Log Drains verso lo strumento di log scelto; un avviso quando le righe JSON con `"level":"error"` e `"area":"uc…"` superano, per esempio, 20 in 10 minuti (§9.5).

## 5. Ritorno indietro

- **Un workspace**: togliere il suo UUID da `UC_WORKSPACE_IDS` e fare redeploy. Le pagine del caso e le loro rotte (file, esporta, registro), l'elenco `/casi-duso` e `/casi-duso/nuovo`, le azioni sul caso, il MCP dei dossier e i cron di quel workspace rispondono come a sezione spenta (404); i link `/r` e `/api/r` dei suoi casi rispondono «link non valido», come un link scaduto; la campanella non mostra più i suoi casi; i dati restano. Ogni azione sul caso porta il suo workspace e nessuna parte senza: il vecchio «Nuovo caso» (`createCaseAction`), che poteva, non c'è più.
- **La pagina Use case di un cliente** (con `USE_CASE_HUB_WORKSPACES=*`): se il workspace è in `UC_WORKSPACE_IDS`, prima toglierlo da lì (un workspace dei dossier escluso è un errore di `uc-doctor`). Poi aggiungere il suo UUID a `USE_CASE_HUB_EXCLUDE` (UUID intero, virgola come separatore) e fare redeploy. **Controllo obbligatorio**: nella shell, con gli stessi valori di Vercel per `USE_CASE_HUB_WORKSPACES` e `USE_CASE_HUB_EXCLUDE`, `use-case-admin doctor --workspace <uuid>` (sola lettura) deve dire `areaAccesa: false`. Una voce con un errore di battitura, un UUID tagliato o due UUID separati da spazi invece che da virgola si ignorano in silenzio, e l'area resta accesa. I dati restano; togliendo l'UUID dall'esclusione l'area torna com'era.
- **Tutta la sezione**: `UC_ENABLED` a qualunque valore diverso da `true`, redeploy. Nessuna tabella si cancella. **Attenzione**: con la sezione spenta i cron uc rispondono 404, quindi si ferma anche la conservazione notturna dei file (§7.1), che è un obbligo. Se la sezione resta spenta più di qualche giorno, i casi chiusi oltre i 30 giorni si cancellano a mano con `purge-case` (§7.3); alla riaccensione il cron riprende da solo i file arretrati (fino a 500 per notte).
- **Codice**: redeploy del deploy precedente (Vercel › Deployments › Promote). La 0018 resta: è solo additiva, e il codice precedente non legge le tabelle uc.
- **Schema rotto in produzione**: con il self-heal spento (il default in produzione) le rotte uc rispondono 503 e il resto dell'app funziona. Riapplicare la 0018 (§3, punto 2); la richiesta dopo riparte senza redeploy.

## 6. Incidenti

### 6.1 Link personale trapelato

1. Il Responsabile del caso apre il caso › Persone › **«Revoca tutti i link»**. Nuova epoca dei link: tutte le richieste aperte e i token MCP del caso si revocano, le voci «Chiesta» tornano da chiedere.
2. Si rimandano i link ai referenti giusti (Persone › Invia).
3. Nei log cercare le righe con `"area":"uc.r"`: il token non c'è mai (`/r/[token]`), si guardano orari e codici d'errore.
4. Se il link è finito in un sito pubblico: il percorso del token è già `noindex` e `no-store`; chiedere comunque la rimozione.

### 6.2 Chiave della zona personale persa

La chiave (`UC_PERSONAL_ZONE_KEY`) non si ruota e non ha copia nell'app. Senza la chiave i valori e i file della zona personale sono illeggibili (sono cifrati), ma il resto del caso funziona.
1. Non generare una chiave nuova sopra la vecchia: i dati vecchi diventerebbero illeggibili per sempre e i nuovi si mescolerebbero.
2. Cercare la chiave nel gestore delle password e nella cronologia delle variabili di Vercel.
3. Se è persa: chiudere la zona personale (togliere `UC_PERSONAL_ZONE_KEY` e `UC_PERSONAL_BLOB_READ_WRITE_TOKEN`), informare il titolare del trattamento, chiedere di nuovo i dati personali necessari dopo una nuova chiave e un nuovo store, e cancellare il vecchio store dalla dashboard di Vercel.
4. **Righe dei file rimaste senza store.** Dopo la cancellazione del vecchio store le righe dei file personali puntano a oggetti che non esistono più: la pulizia notturna le salta e le conta (`retention.unreachable` nella risposta di `uc-freshness`, un avviso nel log), e `purge-case` di un caso con file personali si fermerebbe (`Archivio personale non configurato`). Prima di configurare il nuovo store, con le variabili dello store **non** impostate nella shell:
   ```sh
   UC_ADMIN_DATABASE_URL=… node --no-warnings scripts/uc-case-admin.ts forget-personal-files \
     --apply --confirm-authorized --confirm-database <host>/<db> --environment production --production-approved   # piano: numero di file
   … forget-personal-files --confirm-files <n> --apply …                                                               # le chiude
   ```
   Le righe restano senza percorso, cancellate con il motivo `archivio_rimosso` e l'evento `file.cancellato`. Il comando si rifiuta se lo store della zona personale è ancora configurato.

### 6.3 Cron fallito

- `uc-reminders` (giorni feriali, 08:00 UTC) e `uc-freshness` (ogni notte, 03:00 UTC). Vercel › Cron Jobs mostra l'esito; la risposta contiene solo conteggi (`errors`, `deferred`, `workspaces`).
- 401: `CRON_SECRET` mancante o diverso. 404: `UC_ENABLED` spento. 503: schema uc non aggiornato (§3).
- `errors > 0`: nei log, righe `"area":"uc.cron"` con il passo e il codice. Ogni passo si riprova da solo al giro dopo; `deferred: true` vuol dire tempo finito, il resto parte al giro dopo.
- Per rilanciarlo a mano: `curl -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/cron/uc-freshness` (il segreto solo nella shell).

### 6.4 Rimbalzi di Resend

- Resend › Emails mostra le email rimbalzate (`bounced`) o segnate come spam. L'app non riceve webhook: la notifica risulta inviata.
- Il Responsabile del caso corregge l'email del referente in Persone e rimanda la richiesta; se il referente non ha un'email valida, Lateral Space copia il link e lo manda a mano.
- Molti rimbalzi dallo stesso dominio: controllare SPF, DKIM e DMARC del dominio di `UC_EMAIL_FROM` in Resend › Domains.
- Coda ferma con «email non configurata»: mancano `RESEND_API_KEY`, `UC_EMAIL_FROM` o `NEXT_PUBLIC_APP_URL` (`uc-doctor` lo dice).

### 6.5 Errori in aumento

Le righe JSON hanno `{level, area, op, code, pgCode, digest, workspaceId, caseId, durationMs}`. `digest` lega la riga all'errore mostrato all'utente; `pgCode` è lo SQLSTATE di Postgres (per esempio `42P01` tabella mancante: schema da migrare). Mai token, email o valori.

## 7. Richieste sui dati, conservazione e cancellazione

### 7.1 Conservazione (automatica)

Il cron `uc-freshness` toglie ogni notte i file dei casi **chiusi da oltre 30 giorni** (o dopo `retention_until`, se registrata) dai due archivi, e lascia la riga senza percorsi con l'evento `file.cancellato` motivo `conservazione_scaduta`. Restano le prove scritte usate dal caso (designazione dei firmatari, blocchi, gate) fino alla cancellazione del caso. Gira su tutti i workspace, anche spenti: è un obbligo, non una funzione. Non gira se tutta la sezione è spenta (`UC_ENABLED`, §5). I file di uno store non configurato si saltano e si contano a parte (`retention.unreachable`, §6.2).

### 7.2 Richiesta dell'interessato (accesso, rettifica, cancellazione)

1. **Identificare** la persona: referente (`uc_contacts`, per workspace) o utente di Unbundle. Annotare la data della richiesta (risposta entro 30 giorni).
2. **Accesso**: dal caso, menu «⋯» › Esporta (dati del caso) e Persone (dati del referente). Mai mandare dati di altre persone.
3. **Rettifica**: Persone › modifica del referente.
4. **Cancellazione del referente**: su un caso aperto, Persone › **«Anonimizza»** (nome sostituito dall'etichetta del ruolo, email, telefono e account tolti; si rifiuta se ha richieste aperte: prima «Revoca» o «Revoca tutti i link»). Se i suoi casi sono chiusi la pagina non lo permette: si usa `uc-case-admin anonymize-contact` con le stesse regole (sotto). Un referente usato solo da un caso cancellato con `purge-case` lo anonimizza la purge stessa (§7.3). Le risposte già date restano come dato del caso, senza il nome.
   ```sh
   node --no-warnings scripts/uc-case-admin.ts anonymize-contact --case <uuid di un suo caso> --contact <uuid del referente>   # prova a vuoto
   UC_ADMIN_DATABASE_URL=… node --no-warnings scripts/uc-case-admin.ts anonymize-contact --case <uuid> --contact <uuid> \
     --apply --confirm-authorized --confirm-database <host>/<db> --environment production --production-approved
   ```
   Rifiuti: `richieste_aperte` (revocare prima i link), `firmatario_designato` (firmatario di un caso non chiuso: cambiare prima la designazione), `conflitto` (referente di un altro workspace o già anonimizzato).
5. **Cancellazione di tutto il caso** (fine del rapporto, richiesta del titolare): §7.3.
6. Registrare la risposta data (data, cosa si è fatto) fuori dall'app, senza copiare i dati.

### 7.3 Cancellazione di un caso (`uc-case-admin purge-case`)

Cancella il caso in cascata (tutte le tabelle uc del caso), toglie i suoi file dai due archivi (percorsi registrati e prefissi `uc/q|s|p/<workspace>/<caso>/`), revoca i token MCP del caso e anonimizza i referenti del caso che nessun altro caso del workspace usa (nel piano `contactsToAnonymize`, nell'esito `contactsAnonymized`; la loro coda di email si annulla). Restano gli eventi di audit e i referenti usati da altri casi (§7.2 punto 4).

```sh
# 1. prova a vuoto: nessun accesso al database
node --no-warnings scripts/uc-case-admin.ts purge-case --case <uuid>

# 2. piano: legge righe per tabella, oggetti e token, non cancella (manca --confirm-code)
UC_ADMIN_DATABASE_URL=… BLOB_READ_WRITE_TOKEN=… UC_PERSONAL_BLOB_READ_WRITE_TOKEN=… \
node --no-warnings scripts/uc-case-admin.ts purge-case --case <uuid> \
  --apply --confirm-authorized --confirm-database <host>/<db> --environment production --production-approved

# 3. cancellazione: con il codice del caso letto nel piano (e --allow-open se il caso non è chiuso)
… purge-case --case <uuid> --confirm-code XX-0012 --apply --confirm-authorized \
  --confirm-database <host>/<db> --environment production --production-approved
```

- Se un archivio non risponde, il comando si ferma **prima** di toccare il database: si rilancia.
- Esito `APPLIED`: `remaining` vuoto, `objectsDeleted`, `tokensRevoked` e `contactsAnonymized` contati. `APPLIED_WITH_LEFTOVERS` (uscita 1): una tabella ha ancora righe del caso, da guardare prima di chiudere la richiesta. `referenti_cambiati`: un referente del piano è stato legato a un altro caso nel frattempo; nessuna riga cancellata, si rilancia.
- **Decisione aperta di Pierpaolo (P0-8).** L'accettazione di P0-8 chiede «0 righe uc» dopo la purge, ma le righe di `uc_events` del caso restano: la tabella è a sola aggiunta (trigger `uc_guard_append_only`) e l'audit sopravvive al caso per scelta. Non hanno valori, ma hanno gli id degli attori (`actor_user_id`, `actor_contact_id`), `ip_hash` e `user_agent`. Le strade: (a) tenere l'audit così e riscrivere l'accettazione in «0 righe uc del caso tranne `uc_events`»; (b) far pseudonimizzare alla purge gli eventi del caso (vuotare `actor_contact_id`, `ip_hash` e `user_agent`), che richiede un'eccezione al trigger nel DDL uc (pacchetto C11b, `ddl.ts`). Finché Pierpaolo non sceglie vale (a).
- Prima della produzione, la stessa cosa sul ramo Neon (con `--environment preview`).

## 8. Schema, seed e template

- **Template**: `scripts/uc-load-template.ts --file templates/uc/<key>/<version>.json [--publish] [--restrict-workspace <uuid>]`, prima a vuoto, poi con `--apply` sul ramo Neon e infine in produzione. Un template pubblicato è immutabile: si pubblica una nuova versione.
- **Seed di un caso reale**: `scripts/uc-seed-case.ts --file <seed privato> …`. Il seed e il template del cliente non entrano mai in git (`docs/casi-duso/.gitignore`). Prima a vuoto (piano, conteggi, report di scansione), poi `--apply` sul ramo, poi in produzione. Idempotente sul codice del caso.
- **Regola del gate e ambiente AI**: `scripts/uc-case-admin.ts confirm-gate-policy | set-ai-environment | set-ai-processing`, sempre con una prova scritta del caso.
- Ordine al primo cliente: 0018 (§3) › template › seed › `uc-doctor` › go-live del workspace (§4).

## 9. Controlli

### 9.1 `uc-doctor`

Sola lettura: variabili (presenza e forma, mai i valori), poi, con `UC_ADMIN_DATABASE_URL`, il database in una transazione `READ ONLY`: tabelle uc, sonda dello schema, dossier doppi sulla stessa scheda (righe complete e incomplete, la stessa condizione della 0020), indice unico, dossier senza scheda madre, workspace accesi presenti.

```sh
# variabili dell'ambiente nella shell (mai un file .env nella checkout), poi:
UC_ADMIN_DATABASE_URL=… node --no-warnings scripts/uc-doctor.ts --environment production
node --no-warnings scripts/uc-doctor.ts --environment preview --no-db --json
```

Esce con 1 se c'è un errore. In produzione sono errori: `*` in `UC_WORKSPACE_IDS`, un workspace dei dossier senza pagina Use case, `UC_SCHEMA_SELF_HEAL=on`, segreti o store mancanti a sezione accesa, `NEXT_PUBLIC_APP_URL` non https, sonda falsa, doppioni.

### 9.2 `perf-smoke`

Budget di P0-5: TTFB p95 < 800 ms al primo caricamento e < 500 ms nella navigazione, HTML < 300 KB, payload RSC < 200 KB, al massimo 4 round-trip per navigazione. Sul harness (`docs/casi-duso/AMBIENTE.md` §4.4), con l'app avviata in modalità produzione:

```sh
node scripts/uc-test/start-app.mjs --build && node scripts/uc-test/start-app.mjs --production &
node --no-warnings scripts/uc-test/perf-smoke.mjs --as ls-lead,owner-cliente --runs 10 --round-trips
```

La misura su un ramo Neon (WP13) si fa con un'anteprima collegata al ramo, solo con il sì di Pierpaolo.

### 9.3 CI

`.github/workflows/uc.yml` gira su GitHub dopo un push approvato: `uc-write-migration.ts --check`, `npm run check`, migrazioni su un Postgres 16 (dalla 0018 due volte), suite di integrazione uc una alla volta, `database.integration.test.ts` per ultima. Nessun segreto.

### 9.4 Intestazioni dei link

`curl -sI https://<dominio>/r/qualcosa` deve mostrare `content-security-policy: frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'; connect-src 'self' https://vercel.com https://*.blob.vercel-storage.com; img-src 'self' data: blob:`, più `x-robots-tag: noindex, nofollow`, `cache-control: no-store` e `referrer-policy: no-referrer`. Lo stesso su `/api/r/…`.

### 9.5 Log

Ogni errore del server (`src/instrumentation.ts`) e ogni lettura MCP, cron e self-heal uc scrive una riga JSON (`src/lib/uc/log.ts`). La durata dei caricatori (`durationMs`) c'è per l'accesso al caso (`"op":"accesso_caso"`, una volta per richiesta), le letture MCP e i cron; i caricatori delle pagine (`uc-views`, `uc-shell`, `uc-header`) li misura WP13 con lo stesso `timeUc`. Il percorso dei link personali è sempre `/r/[token]`. Per l'avviso sul tasso d'errore si filtra `"level":"error"` e `"area":"uc"`, `"uc.r"`, `"uc.mcp"`, `"uc.cron"` o `"uc.schema"`.

### 9.6 MCP dei dossier

Il server `unbundle-casi` resta in sola lettura. Lo strumento `list_use_cases` si chiama ora `list_cases`; il vecchio nome resta come alias per una release e poi si toglie (solo nel server stdio `mcp/unbundle-casi-server.mjs`, che per l'alias chiama la stessa rotta). Chi ha installato il server lo riscarica dal pannello «Sviluppo con Claude» del caso.

## 10. Use case: «Chiedi al referente», la campanella per persona, gli avvisi a chi ha chiesto

Riferimento: la SPEC del pacchetto (parti 1 e 2). La funzione vive nell'area «Use case» e **non dipende da `UC_ENABLED` né da `UC_WORKSPACE_IDS`**: spegnere i dossier non la spegne. Per spegnerla: `USE_CASE_REFERENTS=off`.

### 10.1 Variabili

| Variabile | Produzione | Note |
|---|---|---|
| `USE_CASE_REFERENTS` | assente (accesa) oppure `off` | `off`: niente pannello, i link rispondono «non valido», il cron risponde 404, nessuna email ai referenti né a chi ha chiesto. La campanella per persona continua a funzionare. |
| `USE_CASE_REFERENTS_PRIVACY_EMAIL` | facoltativa | L'indirizzo dell'informativa per accesso, rettifica e cancellazione. Assente: `UC_EMAIL_REPLY_TO`, poi l'indirizzo dentro `UC_EMAIL_FROM`. |
| `RESEND_API_KEY` | **solo Produzione** | Mai in Preview: le anteprime usano il database di produzione. Il codice spegne comunque la funzione con `VERCEL_ENV=preview`. |
| `UC_EMAIL_FROM` | `Lateral Space via Unbundle <indirizzo@dominio-verificato>` | In Resend: dominio verificato (SPF, DKIM) e **tracciamento di aperture e clic spento** (riscriverebbe i link `/rispondi/` e aggiungerebbe un pixel). |
| `UC_EMAIL_REPLY_TO` | un indirizzo che riceve posta (es. `persona@lateralspace.ai`) | Il mittente sta su un sottodominio che non riceve posta. Email al referente: reply-to = l'email verificata di chi ha chiesto finché è revisore del workspace; altrimenti questa. Avvisi a chi ha chiesto e email dei dossier: sempre questa. Assente o non valida: nessun reply-to. |
| `UC_SECRET` | già impostata | Obbligatoria per le scritture della pagina pubblica su ogni ambiente Vercel (limite per IP). Senza, «Chiedi al referente» resta fermo con l'avviso «Le risposte dal link non sono attive…» e richieste e promemoria aspettano in coda (`risposte_non_attive`): nessun link da cui non si può rispondere. |
| `BLOB_READ_WRITE_TOKEN` | già impostata | Store privato: caricamenti diretti fino a 20 MB. Senza, solo fino a 4 MB passando dal server. |
| `CRON_SECRET` | già impostata | `/api/cron/use-case-referents` (lun–ven alle 09:00 UTC) risponde 401 se manca o è diversa. |
| `UC_ENABLED` | non letta qui | `UC_ENABLED=false` ferma solo i dossier. |
| `USE_CASE_CLIENT_NOTICES` | **assente (spenta ovunque)**; a mano, un workspace alla volta | Gli avvisi alle persone del cliente (oggi solo «Autorizza i fornitori», §10.8): UUID di workspace separati da virgole. `*` non accende niente, una voce che non è un UUID intero si ignora. Vale solo dove vale anche «Chiedi al referente» (area accesa, `USE_CASE_REFERENTS` non `off`, mai in anteprima). |

### 10.2 Migrazione 0024 (a mano, prima del deploy)

**Prima del merge su `main`**: Vercel pubblica in produzione a ogni push su `main`, quindi il merge è già il deploy. La 0024 va applicata (passi 1–5) prima di unire il ramo, non dopo.

Se il deploy arriva lo stesso prima della 0024: il self-heal dell'app prova la 0024 al primo avvio a freddo, dentro una richiesta. Un suo errore (per esempio `lock timeout` dietro una transazione lunga) non ferma le pagine: si registra (`[db/ensure-schema] 0024 self-heal failed`), l'app serve senza «Chiedi al referente» (le scritture di «Cosa serve» saltano il segno «Informazioni complete»), e ogni processo riprova al massimo ogni 5 minuti. Applicare la 0024 a mano come qui sotto.

1. Restore point su Neon.
2. Controllo di sola lettura: `SHOW TimeZone;` deve dare `GMT`, `UTC` o `Etc/UTC` (la campanella legge `weekly_signals.created_at`, un `timestamp` senza fuso, come UTC). Se no, fermarsi.
3. In un momento tranquillo: `psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0024_use_case_referents.sql`.
4. `SELECT <USE_CASE_REFERENTS_PROBE_SQL>` (da `src/lib/db/use-case-hub-referents-ddl.ts`) deve dare `true`. Il DDL è solo additivo: il codice di prima ignora le tabelle nuove e il CHECK più largo.
5. Mai drizzle-kit, mai `db:push`. Il self-heal dell'app (`ENSURE_VERSION` 18) trova lo schema aggiornato e non fa niente.

Prima della migrazione: `node scripts/use-case-test/schema-check.mjs` sul cluster locale (casi 18–20: due applicazioni, self-heal, produzione di oggi, TimeZone).

Il ramo `feat/chiedi-al-referente` ha i deploy spenti (`vercel.json`, `git.deploymentEnabled`): un'anteprima applicherebbe la 0024 al database di produzione prima della revisione.

### 10.3 Accensione

1. Deploy (dopo 10.2). `GET /api/cron/use-case-referents` con `CRON_SECRET`: soli conteggi, tutti a zero.
2. Un responsabile del cliente (function_lead, exec_sponsor o transformation_lead, email non di Lateral Space) autorizza i sub-responsabili in Impostazioni › Sub-responsabili. La scheda c'è anche senza dossier. Senza autorizzazione «Chiedi al referente» resta fermo con il suo avviso e nessuna email parte (righe in attesa, `sub_responsabili_mancanti`).
3. `RESEND_API_KEY` e `UC_EMAIL_FROM` in Produzione, poi un nuovo deploy. Prima decidere cosa fare delle righe dei dossier in attesa: il dispatcher dei dossier le manderebbe in ritardo. Le righe della coda dei referenti e degli avvisi più vecchie di 2 giorni lavorativi si annullano da sole (`troppo_vecchia`).
4. Prima richiesta a una casella di prova fuori dai domini di Lateral Space, poi ai referenti veri.

Regole del Firewall di Vercel (chiave: IP), accanto a quelle di `/r/`: `GET /rispondi/*` 60 al minuto; `/api/rispondi/*` 120 al minuto; facoltativa `/api/workspaces/*/bell` 120 al minuto.

### 10.4 Dati, conservazione e cancellazione

- Conservazione automatica (cron, passo 8): 12 mesi dopo la fine di una richiesta, se le sue esigenze non sono più «da verificare», risposte svuotate e file cancellati (codici e date restano). Bozze e file non inviati si cancellano appena la richiesta finisce.
- «Cancella i dati di questa persona» dalla scheda, oppure l'operatore:
  `node --no-warnings scripts/use-case-admin.ts erase-referent --workspace <uuid> --contact <uuid>` (a secco), poi con `--apply --confirm-authorized --confirm-database host[:porta]/database --environment production --production-approved`. Una transazione: richieste revocate («cancellazione»), link revocati, email in coda annullate, risposte svuotate, file segnati cancellati, messaggi tolti; la riga del referente si anonimizza solo se la usa soltanto l'hub. Lo script non ha accesso all'archivio: gli oggetti dei file li cancella il prossimo giro del cron (passo 7). Se il referente è anche in un dossier: `uc-case-admin anonymize-contact` (§7.2).
- Link trapelato: «Revoca il link» dalla scheda (oppure la cancellazione qui sopra). Un cambio d'indirizzo del referente («Correggi l'email») revoca da solo i link partiti al vecchio indirizzo.

### 10.5 La campanella per persona

- Il numero rosso conta le righe **non lette da quella persona** e **più nuove della sua ultima apertura** della campanella; senza una riga di stato, dall'inizio della sua iscrizione. Aprire la campanella azzera il numero; le righe restano evidenziate finché non si aprono o «Segna tutte come lette».
- Dove sta lo stato: `weekly_signal_reads` (segnali letti per persona; `weekly_signals.is_read = true` vuol dire «letto per tutti», solo per le righe di prima o ritirate dal riepilogo), `workspace_bell_state` (`seen_at`, la scelta sulle email), `use_case_notifications` (una riga per revisore, use case, tipo e giorno di Roma), `uc_notifications` per le righe dei dossier.
- Controllo di una persona, in sola lettura (UUID inventati):
  ```sql
  SELECT seen_at, referent_emails FROM workspace_bell_state WHERE workspace_id = '<ws>' AND user_id = '<utente>';
  SELECT kind, rome_day, answers, unknowns, documents, read_at FROM use_case_notifications
   WHERE workspace_id = '<ws>' AND recipient_user_id = '<utente>' ORDER BY last_event_at DESC LIMIT 20;
  ```
- Dove portano le righe degli use case: «Risposte arrivate», «Nuovi documenti» e «Informazioni complete» a «Cosa serve» della scheda (`?capitolo=cosa-serve`); «Nessuna risposta» a «Richieste inviate» (`?capitolo=richieste`), la piega delle richieste dentro «Cosa serve», aperta, con il fuoco sul suo riassunto e «Chiedi di nuovo» accanto alla richiesta (senza richieste a vista la scheda arriva a «Cosa serve»); «Pronto da avviare» e «Autorizza i fornitori» come in §10.8. Indietro e Avanti del browser tra due di questi indirizzi della stessa scheda (per esempio «Cosa serve» e poi «Nessuna risposta») arrivano dove dice l'indirizzo a cui si torna: Indietro a `?capitolo=cosa-serve` dà il fuoco al titolo di «Cosa serve» con «Richieste inviate» chiusa, Avanti a `?capitolo=richieste` la riapre con il fuoco sul suo riassunto; lo stesso vale per le pieghe («Dettagli», «Storia»).
- Le notifiche e gli avvisi più vecchi di 90 giorni si cancellano (cron, passo 12).

### 10.6 Avvisi per email a chi ha chiesto

- Coda: `use_case_requester_emails` (una riga per persona, workspace e giorno di Roma) con le voci in `use_case_requester_email_items`. Al massimo un'email al giorno per persona, lun–ven 9–18 di Roma, festivi esclusi.
- Le risposte del referente partono subito (prima email del giorno); documenti e «Nessuna risposta» vanno nell'email del giorno lavorativo dopo, alle 9 (o si uniscono a quella di oggi se non è ancora partita).
- In attesa (`hold_reason`): `email_non_configurata`, `sub_responsabili_mancanti`, `funzione_spenta`. Annullate (`cancel_reason`): `destinatario_non_valido` (email non verificata, non più revisore), `avvisi_spenti` (la persona ha tolto la spunta nella campanella), `nessuna_voce`, `troppo_vecchia` (più di 2 giorni lavorativi dopo `due_at`, che i nuovi tentativi non spostano).
- Il link di ogni voce porta alla scheda: a «Cosa serve» quando ci sono risposte, documenti o «Non lo so» da guardare; a «Richieste inviate» (`?capitolo=richieste`, aperta) quando la voce è solo «Nessuna risposta» (ultimo promemoria o link scaduto), dove si chiede di nuovo. Con il codice di prima (ritorno indietro) un link `?capitolo=richieste` apre la scheda in cima.
- Mai nel testo: risposte, nomi di file, nome o email del referente.


### 10.7 Referente che ha già un account Unbundle

Il referente risponde sempre dal link personale, senza entrare: essere referente non dà accesso a niente e la pagina `/rispondi/` non legge la sessione. Può però avere già un account (per esempio ha partecipato a una formazione, oppure lavora nel workspace).

- **«A chi chiedi?»**: dopo i referenti, le persone del workspace con un account e l'email verificata, in ordine alfabetico, con nome ed email coperta (più «Fa parte del team» per i revisori). Sono le stesse persone di Impostazioni › Persone («Chi ha accesso»): mai i partecipanti ai corsi, mai Lateral Space, mai chi guarda, mai una seconda voce per chi è già un referente. Scegliendo una persona il server ricontrolla tutto e crea il referente collegato al suo account (`uc_contacts.user_id`), oppure usa quello che c'è già.
- **«+ Nuovo referente»** con l'email di un referente che c'è già: si usa quel referente, con il nome che ha (niente «email già in uso»); un referente disattivato dà «Questo referente non è più attivo». Con l'email verificata di una persona del workspace (anche un partecipante ai corsi) il referente nuovo nasce collegato al suo account. I referenti già esistenti, condivisi con i dossier, non si modificano mai dall'hub.
- **Email**: (rilascio 5.1) oggetto «{Azienda}: sei il referente per il caso d'uso «{codice · titolo}»», prima riga «{Nome} ti ha indicato come referente per il caso d'uso «{codice · titolo}».», poi la riga che dice che cos'è un caso d'uso (§10.11). A chi, al momento dell'invio, è membro del workspace senza essere revisore (corsista, contributore) con la stessa email verificata, richiesta e promemoria aggiungono «Hai già un account Unbundle: per rispondere non serve entrare, basta questo link.», senza link alla dashboard. I revisori hanno la riga del team con il link alla scheda (§10, Parte 3). Si ricalcola a ogni invio: chi si iscrive dopo la richiesta riceve la riga nei promemoria.
- **«Correggi l'email»** (solo referenti dell'hub): il collegamento all'account segue l'indirizzo nuovo (l'account con quell'email verificata se è del workspace, altrimenti nessuno).
- Controllo di sola lettura di un referente (UUID inventati): `SELECT user_id IS NOT NULL AS collegato, is_active FROM uc_contacts WHERE workspace_id = '<ws>' AND id = '<referente>';`

### 10.8 «Pronto da avviare» e «Autorizza i fornitori» (0025)

Due avvisi nella campanella, con l'email del giorno lavorativo dopo (stesso trasporto, mittente `UC_EMAIL_FROM` sul sottodominio delle notifiche, reply-to `UC_EMAIL_REPLY_TO`; le email partono solo dal cron dei referenti, lun–ven alle 09:00 UTC, dentro la finestra di Roma). La fase di uno use case resta una decisione di una persona: niente si avvia da solo.

- **«Pronto da avviare»**, solo ai revisori di Lateral Space del workspace (ruolo da revisore, email verificata di `UC_LS_EMAIL_DOMAINS`), mai a chi ha agito: uno use case «Da costruire» approvato per questo trimestre o dopo, senza dossier, con ogni informazione del cliente «A posto» o «Non si applica» (o nessuna). Una volta per passaggio (`use_case_ready_state`); la riga (e il link dell'email, `?capitolo=realizzazione`) porta alla scheda: finché lo use case è pronto, al riquadro «Prossimo passo» con «Avvia la realizzazione» (o «Segna come in realizzazione» con la sezione Casi d'uso spenta) e il fuoco lì, perché la piega «Realizzazione» non ripete il pulsante; quando non lo è più (avviato, trimestre finito, un'informazione di nuovo da chiedere) lo stesso link, anche di un'email già partita, apre la piega «Realizzazione» (o il riquadro «Prossimo passo», se la piega non c'è: per esempio uno use case segnato con «Segna come in realizzazione», senza dossier). Un vecchio link con «#realizzazione» al posto di `?capitolo=` segue la stessa regola. L'arrivo vale una volta per apertura del link: le riletture della pagina dopo un'azione sulla stessa scheda (una scelta in «Quando», un requisito aggiunto in «Cosa serve») non aprono né chiudono pieghe e non spostano il fuoco, anche quando intanto lo use case diventa o smette di essere pronto. La riga sparisce appena lo use case non è più pronto. L'email resta in attesa senza l'ok sui sub-responsabili (`sub_responsabili_mancanti`, come ogni email dell'area) e si annulla da sola dopo 2 giorni lavorativi. Non dipende da `USE_CASE_CLIENT_NOTICES`. Lo stesso giorno un revisore di Lateral Space non riceve anche «Informazioni complete» per lo stesso use case.
- **«Autorizza i fornitori»**, solo con `USE_CASE_CLIENT_NOTICES` acceso per il workspace, solo a chi può dare l'ok (Sponsor esecutivo, Responsabile della trasformazione, Responsabile di funzione, email verificata fuori da Lateral Space): quando una persona di Lateral Space approva o pianifica uno use case con informazioni da chiedere, prepara le domande o prova a chiedere al referente mentre l'ok manca, e dal cron. Al massimo una volta ogni 7 giorni per workspace. La riga porta a Impostazioni › Sub-responsabili; l'email non porta dati degli use case. Con l'ok le righe spariscono, le email in coda si annullano (`autorizzazione_data`) e non si scrive più niente.

**Prima di accendere `USE_CASE_CLIENT_NOTICES`**: l'email di «Autorizza i fornitori» passa da Resend, che è uno dei sub-responsabili da autorizzare. La decisione è del proprietario (o del legale); senza, si lascia spenta.

**Migrazione 0025 (a mano, prima del deploy)**, come la 0024 (§10.2):

1. Restore point su Neon.
2. `psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0025_use_case_alerts.sql` (allarga il CHECK dei tipi di `use_case_notifications` con `pronto` e `fornitori`, crea `use_case_ready_state`, `use_case_alert_emails`, `use_case_alert_email_items`, e segna subito come già pronti gli use case pronti oggi: nessuno riceve notizie vecchie).
3. `SELECT <USE_CASE_ALERTS_PROBE_SQL>` (da `src/lib/db/use-case-hub-alerts-ddl.ts`) deve dare `true`; oppure `use-case-admin doctor` (con `USE_CASE_ADMIN_DATABASE_URL` nel comando, come nel controllo di «Accendere gli avvisi al cliente» qui sotto) deve dire `migrazione0025: true`.
4. Mai drizzle-kit, mai `db:push`. Il self-heal (`ENSURE_VERSION` 19) trova lo schema aggiornato e non fa niente. Senza la 0025 l'app funziona come prima e non scrive nessuno dei due avvisi.

Il ramo non si pubblica prima della revisione: le anteprime usano il database di produzione e il self-heal applicherebbe la 0025 lì.

**Accendere gli avvisi al cliente per un workspace**:

1. Vercel › Settings › Environment Variables › Production: `USE_CASE_CLIENT_NOTICES=<uuid del workspace>` (più workspace: `<uuid>,<uuid>`).
2. Redeploy: una variabile nuova vale solo dal deploy dopo.
3. Controllo, di sola lettura: `USE_CASE_ADMIN_DATABASE_URL=<URL di produzione, solo nel comando> USE_CASE_CLIENT_NOTICES=<uuid> USE_CASE_HUB_WORKSPACES=<come su Vercel> UC_LS_EMAIL_DOMAINS=<come su Vercel> node --no-warnings scripts/use-case-admin.ts doctor --workspace <uuid>` (lo script non legge file d'ambiente: senza l'URL non trova il database) deve dire `avvisiCliente: true`; `chiPuòAutorizzare: false` vuol dire che nel workspace nessuno può dare l'ok (nessun avviso parte finché non c'è).

Spegnere: togliere l'UUID e rifare il deploy. Le email già in coda si annullano all'invio (`avvisi_cliente_spenti`); le righe già nella campanella restano finché l'ok manca.

**Controllo di sola lettura** (UUID inventati):
```sql
SELECT ready_since, ready_quarter FROM use_case_ready_state WHERE use_case_id = '<use case>';
SELECT kind, status, hold_reason, cancel_reason, send_on FROM use_case_alert_emails WHERE workspace_id = '<ws>' ORDER BY created_at DESC LIMIT 20;
```

**Ritorno indietro** (Vercel Hobby, un passo, senza skew protection): il codice di prima mostrerebbe le righe `pronto` e `fornitori` senza titolo e con un link a «Cosa serve». Deploy la sera e `main` fermo per circa 24 ore. Se si torna indietro, il proprietario (mai un agente) cancella in produzione `DELETE FROM use_case_notifications WHERE kind IN ('pronto', 'fornitori');`. Le tabelle della 0025 possono restare: il codice di prima non le legge.


### 10.9 «Referente in un tocco» (0026)

Il rilascio 5: i revisori scelgono il referente di uno use case con un'azione sola; il referente riceve subito l'email, conferma lo use case («Sì, è così» / «Correggi»), stima il tempo del lavoro (sempre in ore, mai euro) e chiude ogni domanda (una risposta, un file, «Non ce l'ho» o «È già allegato»). Il referente di uno use case non è una colonna: è il contatto dell'ultima richiesta al referente (`use_case_referent_checks`), nessuno quando quella è revocata.

**Migrazione 0026 (a mano, prima del deploy)**, come la 0024 (§10.2) e la 0025 (§10.8):

1. Prima del deploy, il proprietario: restore point su Neon, poi `psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0026_use_case_referent_check.sql` (crea `use_case_referent_checks`, aggiunge `file_required` a `use_case_referent_request_items`, `comment` e `already_attached` a `use_case_need_answers` e un solo CHECK, `use_case_need_answers_comment_check`; non scrive dati).
2. `SELECT <USE_CASE_REFERENT_CHECK_PROBE_SQL>` (da `src/lib/db/use-case-hub-referent-check-ddl.ts`) deve dare `true`, oppure `use-case-admin doctor` (con `USE_CASE_ADMIN_DATABASE_URL` nel comando, come in §10.8) deve dire `migrazione0026: true`.
3. Mai drizzle-kit, mai `db:push`. Il self-heal (`ENSURE_VERSION` 20) trova lo schema aggiornato e non fa niente. Senza la 0026 l'app serve senza «Chiedi al referente» (il pannello non c'è) e la pagina del referente dice «Non disponibile».
4. Il ramo non si pubblica prima della revisione: le anteprime usano il database di produzione e il self-heal applicherebbe la 0026 lì. La serie va in produzione tutta insieme, la sera, con `main` fermo per circa 24 ore dopo (Vercel Hobby: niente skew protection, ritorno indietro di un passo).
5. Ritorno indietro, prima di premerlo: il codice di prima vede una richiesta al referente come una richiesta con le sole domande, quindi la completa senza la conferma (subito, se non ha domande). Il proprietario (mai un agente) legge il numero e decide se revocarle prima: `SELECT count(*) FROM use_case_referent_requests r JOIN use_case_referent_checks c ON c.request_id = r.id WHERE r.status = 'inviata' AND c.submitted_at IS NULL;` (solo un numero). Gli oggetti della 0026 restano.
6. Ritorno indietro, mentre il codice di prima è in produzione: la sua cancellazione, la sua conservazione di 12 mesi e la sua pulizia delle bozze non tolgono commenti e note di conferma. Subito dopo ogni «Cancella i dati di questa persona» fatto sul codice di prima, il proprietario esegue la pulizia (il cron del codice nuovo esegue ogni giorno gli stessi tre statement, `REFERENT_CHECK_SWEEP_SQL`, dopo il ritorno avanti):
```sql
UPDATE use_case_need_answers SET comment = NULL, updated_at = now() WHERE comment IS NOT NULL AND removed_at IS NOT NULL;
UPDATE use_case_referent_checks c SET confirm_note = NULL, purged_at = coalesce(c.purged_at, now()), updated_at = now()
  FROM use_case_referent_requests r WHERE c.request_id = r.id AND r.purged_at IS NOT NULL AND c.confirm_note IS NOT NULL;
UPDATE use_case_referent_checks c SET confirm = NULL, confirm_note = NULL, estimate = NULL, times_per_month = NULL, minutes_each = NULL, updated_at = now()
  FROM use_case_referent_requests r WHERE c.request_id = r.id AND c.submitted_at IS NULL AND r.status <> 'inviata'
  AND (c.confirm IS NOT NULL OR c.confirm_note IS NOT NULL OR c.estimate IS NOT NULL OR c.times_per_month IS NOT NULL OR c.minutes_each IS NOT NULL);
```
7. Dopo il ritorno avanti, una richiesta al referente che il codice di prima ha completato senza la conferma si mostra «Il referente ha risposto» con «Lo use case: nessuna conferma.» sulla scheda: «Chiedi di nuovo» non c'è; «Cambia referente», o la stessa persona scelta di nuovo, chiede la conferma.

**Controllo di sola lettura** (UUID inventati):
```sql
SELECT r.status, c.confirm IS NOT NULL AS confermato, c.estimate, c.submitted_at IS NOT NULL AS inviata
FROM use_case_referent_requests r JOIN use_case_referent_checks c ON c.request_id = r.id
WHERE r.use_case_id = '<use case>' ORDER BY r.created_at DESC, r.id DESC LIMIT 5;
```

### 10.10 «L'impatto, per ogni beneficio» (0027)

Il rilascio 5.1: al passo «L'impatto» della pagina del referente c'è una riga per ogni voce di «Benefici e costi» (ore, euro, qualitative), ognuna con un tocco («Sì» / «È di meno» / «È di più» / «Non so» su una cifra del team, «Ti torna?» con «Sì» / «No» / «Non so» su un beneficio senza cifra, i due numeri oppure «Non so» quando il team non li ha) e un commento facoltativo; sulla scheda il team vede ogni risposta accanto alla sua voce e usa con un clic i numeri di una voce («Usa la stima di {Nome}»). «Non so» su una cifra (decisione del titolare del 04/11/2026) non salva numeri e conta come risposta; sulla scheda si legge «{Nome}: non lo sa.», mai con «Usa la stima di {Nome}»: il team la chiude con «Rivedi la stima» o «Fatto», e finché non lo fa lo use case è «Risposte da verificare» con la riga «Il referente non sa rispondere su una stima.» (una stima diversa, se c'è, viene prima). Gli euro di una voce «euro» il referente li vede (decisione del 04/11/2026); mai punteggi, costi, quote, ore liberate, altri use case o persone. Senza modello del valore resta la stima del tempo del rilascio 5.

**Migrazione 0027 (la applica l'app, al primo avvio dopo il deploy)**, come la 0026 nel rilascio 5 (decisione del titolare del 04/11/2026):

1. Prima del deploy, il proprietario: restore point su Neon. Niente psql: al primo avvio a freddo dopo il deploy il self-heal (`ensureDbSchema()`, `ENSURE_VERSION` 21) trova la sonda della 0027 falsa e applica gli stessi statement di `drizzle/0027_use_case_referent_benefits.sql` (`USE_CASE_REFERENT_BENEFITS_DDL`), in una transazione con l'advisory lock del file e `lock_timeout` 3s: aggiunge `benefits` a `use_case_referent_checks`, crea `use_case_referent_check_benefits` («Non so» vale su ogni voce, sempre senza numeri) e allarga, con lo stesso nome, il CHECK `use_case_referent_checks_submitted_check`; non scrive dati. L'allargamento è l'unico statement non solo additivo (DROP CONSTRAINT e ADD CONSTRAINT … NOT VALID, poi VALIDATE): la condizione nuova è quella della 0026 con `benefits` in OR, quindi ogni riga di prima resta valida. Gli avvii dopo trovano la sonda vera e non fanno niente.
2. Subito dopo il deploy: aprire una pagina dell'app (il primo avvio), poi `use-case-admin doctor` (con `USE_CASE_ADMIN_DATABASE_URL` nel comando, come in §10.8) deve dire `migrazione0027: true`, oppure `SELECT <USE_CASE_REFERENT_BENEFITS_PROBE_SQL>` (da `src/lib/db/use-case-hub-referent-benefits-ddl.ts`) deve dare `true`. Poi la scheda di uno use case con il referente e il suo pannello «Referente» si aprono come prima.
3. Se la sonda resta `false` (nel log «0027 self-heal failed…», per esempio il `lock_timeout` dietro una transazione lunga): l'app serve senza «Chiedi al referente» (il pannello non c'è) e la pagina del referente dice «Non disponibile», come senza la 0026; il self-heal riprova al massimo ogni 5 minuti per processo. La strada di riserva, solo allora, è il file a mano: `psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0027_use_case_referent_benefits.sql` (idempotente, con lo stesso lock e lo stesso `lock_timeout`), poi di nuovo il doctor. Mai drizzle-kit, mai `db:push`.
4. Il ramo non si pubblica prima della revisione (le anteprime usano il database di produzione e il self-heal applicherebbe la 0027 lì). Una sola messa in produzione, il 05/11/2026 alle 09:45, quando finisce il fermo di 24 ore dopo il rilascio 5 (scelta del titolare, come per i rilasci 4 e 5), con `main` fermo per circa 24 ore dopo. Una pagina del referente aperta prima del deploy (il rilascio 5, senza Skew Protection) che salva il passo «Il tempo» su uno use case con il modello del valore riceve `link_non_valido` e si ricarica intera: arriva alle righe per beneficio, niente di scritto, il link resta valido.
5. Ritorno indietro, prima di premerlo: il codice del rilascio 5 non legge `use_case_referent_check_benefits`. Una conferma inviata per beneficio si mostra sulla scheda come «Il tempo: nessuna stima del team.» senza numeri, e il riquadro può chiedere «Aggiungi alla stima» / «Non serve» su quello use case; una bozza per beneficio non ancora inviata torna al passo «Il tempo» del rilascio 5 (il referente risponde di nuovo sulle ore). Il proprietario (mai un agente) legge i due numeri e decide: `SELECT count(*) FILTER (WHERE c.submitted_at IS NOT NULL) AS inviate, count(*) FILTER (WHERE c.submitted_at IS NULL) AS bozze FROM use_case_referent_checks c WHERE c.benefits;` (solo numeri). Gli oggetti della 0027 restano.
6. Ritorno indietro, mentre il codice di prima è in produzione: la sua cancellazione dei dati, la sua conservazione di 12 mesi e la sua pulizia delle bozze non toccano le risposte per beneficio. Subito dopo ogni «Cancella i dati di questa persona» fatto sul codice di prima, il proprietario esegue la pulizia (il cron del codice nuovo esegue ogni giorno gli stessi tre statement, `REFERENT_BENEFITS_SWEEP_SQL`, dopo quelli della 0026):
```sql
UPDATE use_case_referent_check_benefits b SET comment = NULL, updated_at = now()
  FROM use_case_referent_requests r WHERE b.request_id = r.id AND r.purged_at IS NOT NULL AND b.comment IS NOT NULL;
DELETE FROM use_case_referent_check_benefits b USING use_case_referent_checks c, use_case_referent_requests r
  WHERE b.request_id = c.request_id AND c.request_id = r.id AND c.submitted_at IS NULL AND r.status <> 'inviata';
UPDATE use_case_referent_checks c SET benefits = false, updated_at = now()
  FROM use_case_referent_requests r WHERE c.request_id = r.id AND c.submitted_at IS NULL AND r.status <> 'inviata' AND c.benefits;
```
7. Dopo il ritorno avanti, le conferme inviate con il codice di prima (`benefits` falso) si leggono come nel rilascio 5: la stima del tempo e «Usa la stima di {Nome}» sulla voce «ore». Lo stesso vale per una conferma cominciata per beneficio con il codice nuovo e finita con quello di prima: il codice di prima scrive la sua stima del tempo (istantanea, scelta, numeri) e `submitted_at` senza toccare `benefits`, che resta vero. Il codice nuovo legge `benefits` solo quando le colonne della stima del tempo sono vuote (`BENEFITS_FLAG_SQL` in `src/lib/use-cases/referent/impact.ts`, in tutti e quattro i lettori: la pagina del referente, il blocco della scheda, le azioni del team, gli stati della lista): la scheda mostra la stima del rilascio 5 da verificare, con «Usa la stima di {Nome}», e la pagina del referente la sua stima, mai le righe per beneficio di prima; una bozza così non ancora inviata mostra le righe per beneficio vuote, e il referente risponde di nuovo. Una riga per beneficio senza risposta si legge «{Nome}: nessuna risposta.», mai «sì». Quante sono, solo numeri: `SELECT count(*) FILTER (WHERE c.submitted_at IS NOT NULL) AS inviate, count(*) FILTER (WHERE c.submitted_at IS NULL) AS bozze FROM use_case_referent_checks c WHERE c.benefits AND (c.team_component_key IS NOT NULL OR c.estimate IS NOT NULL OR c.times_per_month IS NOT NULL OR c.minutes_each IS NOT NULL);`.

**Controllo di sola lettura** (UUID inventati):
```sql
SELECT b.component_key, b.kind, b.answer, b.outcome, c.submitted_at IS NOT NULL AS inviata
FROM use_case_referent_checks c JOIN use_case_referent_check_benefits b ON b.request_id = c.request_id
WHERE c.request_id = '<richiesta>' ORDER BY b.position;
```

### 10.11 Rilascio 5.1: meno paura, «caso d'uso» fuori dalla dashboard

Nessuna migrazione: solo testi e regole del codice.

- **Dati personali** (decisione del titolare del 04/11/2026: «basta che lo diciamo prima nelle informative»): nelle risposte, nella nota di «Correggi» e nei commenti del passo «L'impatto» nomi, email e telefoni non bloccano più e non danno avvisi; dati sanitari e discriminatori si rifiutano sempre, codici fiscali e date di nascita sono un avviso nella bozza e fermano «Invia». Lo stesso per i testi del team: il messaggio al referente («Aggiungi un messaggio») e la risposta del team dalla scheda («Aggiungi una risposta») accettano nomi, email e telefoni di altre persone e rifiutano dati sanitari, discriminatori, codici fiscali e date di nascita (non hanno bozza: si rifiutano subito). I titoli delle domande restano senza nomi, email e telefoni. I file non chiedono più la dichiarazione («Confermo, scelgo il file») né «Servono, lo lascio», e sulla scheda non c'è più «Può contenere dati personali»; il controllo automatico dei file resta uguale (tipo dal contenuto, quarantena, PDF con poco testo a Lateral Space, rifiuto di dati sanitari, discriminatori, codici fiscali e date di nascita), salvo una cosa: nei file del referente e in «Allega un file» del team, le colonne di nomi, cognomi, email, telefoni e indirizzi di un CSV o di un XLSX passano come lo stesso testo in un documento (prima facevano rifiutare il file con il messaggio dei codici fiscali); le colonne di IBAN, documenti d'identità e sesso si rifiutano ancora, con il loro messaggio («Il file ha IBAN, documenti d'identità o il sesso delle persone…»), e il messaggio dei codici fiscali esce solo se il controllo ne ha trovati. `personal_warning` si scrive ancora, come fatto del controllo. I dossier (`/r`) non cambiano: dichiarazione e testi come prima.
- **Informativa** `ucq-2026-11-1`: «Prima di iniziare» è una riga e due punti, con «Leggi l'informativa completa» a un tocco e «Iniziamo»; il testo completo resta intero. Chi aveva letto la versione `ucq-2026-10-1` la vede di nuovo una volta. Una pagina aperta prima del deploy che preme il vecchio «Ho letto, iniziamo» riceve «L'informativa è cambiata: ricarica la pagina e leggila di nuovo.».
- **«Caso d'uso» fuori dalla dashboard**: la pagina pubblica `/rispondi` e ogni email dell'area (richiesta, promemoria, grazie al referente; avvisi a chi ha chiesto; «Pronto da avviare» e «Autorizza i fornitori») dicono «caso d'uso», mai «use case»; la dashboard resta «use case» (l'anteprima dell'email in «Scegli il referente» mostra l'email com'è). Gli oggetti cominciano tutti con il nome dell'azienda: «{Azienda}: sei il referente per il caso d'uso «…»», «{Azienda}: alcune domande sul caso d'uso «…»», «{Azienda}: promemoria sul caso d'uso «…»», «{Azienda}: ultimo promemoria sul caso d'uso «…»», «{Azienda}: nuove domande sul caso d'uso «…»», «{Azienda}: promemoria su {n} casi d'uso», «{Azienda}: grazie per le risposte sul caso d'uso «…»», «{Azienda}: risposte arrivate sul caso d'uso «…»» (e «nuovi documenti», «il referente non sa rispondere», «nessuna risposta», «novità su {n} casi d'uso»), «{Azienda}: il caso d'uso «…» è pronto da avviare». La richiesta dice in una riga che cos'è: «Un caso d'uso è un'attività di lavoro che {Azienda} sta valutando di semplificare con l'intelligenza artificiale.». Il controllo dei testi ha l'ambito `esterno` (`src/lib/use-cases/copy-guard.ts`).

### 10.12 Il marchio nelle email e BIMI

- **Il marchio in cima alle email** (rilascio 5.1): ogni email dell'area «Use case» (referente, avvisi a chi ha chiesto, «Pronto da avviare», «Autorizza i fornitori») comincia con il marchio «U» di Unbundle e, accanto in testo, «Lateral Space via Unbundle». L'immagine è il file statico `public/email/unbundle-u.png` (96×96, mostrato a 32×32; lo rifà `node scripts/render-email-logo.mjs`, `--check` dice se è cambiato), con l'indirizzo assoluto dall'origine pubblica dell'app (`NEXT_PUBLIC_APP_URL`): in produzione `https://www.theunbundle.com/email/unbundle-u.png`. Stesso indirizzo per tutti, senza parametri: non è un pixel e non dice chi ha aperto l'email. Con le immagini bloccate si leggono il testo alternativo «Unbundle» e il nome accanto; il testo semplice dell'email non cambia. Le email dei dossier restano senza immagini. Dopo il deploy: `curl -sI https://www.theunbundle.com/email/unbundle-u.png` deve dare `200` e `content-type: image/png`.
- **L'avatar del mittente in Gmail (BIMI)**: il cerchio accanto a «Lateral Space via Unbundle» in Gmail non viene dall'email ma dal DNS del dominio che spedisce. È lavoro di DNS e di marchio, fuori dal codice; la lista per quando il proprietario decide:
  1. SPF e DKIM allineati per il mittente `notifiche.lateralspace.ai` (Resend firma con DKIM `d=notifiche.lateralspace.ai`): controllare in Resend che il dominio sia «Verified» e in un'email ricevuta che `dkim=pass` e `dmarc=pass`.
  2. DMARC su `lateralspace.ai` oggi è `p=none`: BIMI chiede l'applicazione. Prima `rua=` per i rapporti e qualche settimana di controllo che tutti i mittenti veri (Google Workspace, Resend, gli altri) passino; poi `p=quarantine` (con `pct=100`), poi se va bene `p=reject`. Se c'è `sp=`, non deve essere `none` (vale per `notifiche.`).
  3. Il logo di Lateral Space in SVG Tiny Portable/Secure (profilo `tiny-ps`): quadrato, sfondo pieno, `<title>`, niente script né risorse esterne, piccolo (meno di 32 KB), su un indirizzo https pubblico.
  4. Per Gmail (e Apple Mail) serve un certificato: VMC (con marchio registrato) oppure CMC (marchio in uso da almeno un anno, senza registrazione), da un'autorità ammessa (per esempio DigiCert o Sectigo). Senza certificato Gmail non mostra il logo.
  5. Il record: `default._bimi.lateralspace.ai TXT "v=BIMI1; l=https://<dominio>/bimi/lateral-space.svg; a=https://<dominio>/bimi/lateral-space.pem"` (il mittente `notifiche.lateralspace.ai` usa quello del dominio principale se non ne ha uno suo).
  6. Controllo: un validatore BIMI pubblico sul dominio, poi in Gmail «Mostra originale» di un'email nuova.

### 10.13 L'ok sui sub-responsabili registrato da Lateral Space

Decisione del titolare del 04/11/2026, senza un documento: l'«ok sui sub-responsabili» di un cliente lo può registrare anche Lateral Space, per conto del cliente, con un clic. Nessuna migrazione: la stessa tabella `uc_subprocessor_acks`, a sola aggiunta.

- **Chi**: una persona di Lateral Space (email verificata di `UC_LS_EMAIL_DOMAINS`) con ruolo Sponsor esecutivo, Responsabile della trasformazione o Responsabile di funzione nell'organizzazione o nel workspace (gli stessi ruoli del cliente). Un analista di Lateral Space legge soltanto. Il cliente autorizza come prima, con la casella «Ho i poteri…».
- **Come**: Impostazioni › Sub-responsabili mostra a Lateral Space il testo «Per conto di {cliente}: {cliente}, titolare del trattamento, autorizza Lateral Space … L'ok lo registra Lateral Space. …» e un solo pulsante, non pieno, «Registra l'ok di {cliente}» (nessuna casella). Il testo salvato comincia con «Registrato da Lateral Space per conto di {cliente}» e porta l'elenco della versione; la persona e il ruolo stanno in `declared_by_user_id` e `declared_by_role`.
- **Dopo**: la riga a schermo dice «Ok di {cliente} registrato da Lateral Space ({Nome}) il {data} alle {ora} (lista {versione}).». Anche una riga scritta a mano il cui testo comincia con «Registrato da Lateral Space» (come quella del workspace di prova del 04/11) si legge così. Le righe del cliente restano «Autorizzati da {Nome} il …».
- **Dove arriva Lateral Space**: il riquadro «Prossimo passo» (G4, «Autorizzare i fornitori»), «Scegli il referente» e «Chiedi al referente» danno a chi può registrare l'ok il link «Apri Impostazioni», con la riga «Manca l'ok di {cliente} sui fornitori che usiamo, …: puoi registrarlo tu per conto di {cliente}, in Impostazioni › Sub-responsabili.». L'avviso «Autorizza i fornitori» (campanella ed email, §10.8) resta un avviso al cliente: non va a Lateral Space.
- **Ritorno indietro**: il codice del rilascio 5 legge la stessa riga (l'ok c'è, le porte si aprono) e la mostra come «Autorizzati da {Nome} il …».
- **Controllo di sola lettura** (UUID inventati): `SELECT left(statement_text, 60) AS inizio, declared_by_role, declared_at FROM uc_subprocessor_acks WHERE workspace_id = '<ws>';`

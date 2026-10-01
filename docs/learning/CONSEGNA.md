# Consegna M1 — 5 e 7 ottobre 2026

**Percorso implementato e verificato nell'ambiente locale isolato. Non pronto alla prova generale o al rilascio finché restano P0 non provati.** Nessun merge, push, deploy, invito o intervento sul database della survey è stato eseguito.

Branch dedicato: `codex/m1-training`, dalla base `e63a2a719410af77982c85522dad6339975f869e`. Il checkout originale e il lavoro survey non committato sono rimasti separati. Il commit consegnato è identificato nella ricevuta finale di verifica e nella risposta di consegna; `git rev-parse HEAD` nel checkout dedicato ne restituisce l'identificatore completo. Le evidenze registrano anche le prove eseguite prima del commit, senza attribuire loro retroattivamente uno SHA diverso.

## Funzioni consegnate

- Autenticazione e workspace esistenti; assegnazione a una replica, calendario Europe/Rome, informativa nominativa configurata e contatto dei formatori.
- Checkpoint, caso in due fasi e verifica finale; risposte in ordine stabile per tentativo, salvataggio con revisione, ripresa e gestione del conflitto.
- Consegna atomica e ricevuta idempotente; correzione deterministica lato server, feedback, punti essenziali e recupero B con conservazione della prima prova. Nessuna chiamata LLM necessaria.
- Vista riservata ai formatori per coorte, aggregati con soglia e soppressione complementare, export con permesso distinto e audit.
- Idea facoltativa privata fino all'invio esplicito al portfolio; una sola proposta anche al retry, senza voti o risposte copiate.
- Migrazione additiva, importazione privata/versionata, flag globale spento per default, flag del programma, chiusura e procedura di conservazione. M2/M3 restano moduli futuri.
- Pannello amministrativo M1: importazione e anteprima sicura, configurazione, assegnazioni singole o in gruppo, cambio turno prima dell’inizio, sospensione e ripristino, apertura dei turni, deleghe e revoche, visibilità e chiusura, registro e cancellazione a scadenza con conferma esplicita. [Manuale amministratori](ADMIN.md).

La survey non viene ripetuta e non è collegata agli account della formazione. Nessun file di autenticazione, proxy, azione survey o pagina dei link anonimi è stato modificato. La banca privata non è nel repository o nei bundle client.

## Evidenze

L’estensione amministrativa del 2 ottobre è documentata separatamente in [evidence/admin.md](evidence/admin.md), con prove del percorso admin → partecipante → formatore, isolamento tra turni, concorrenza e limiti dell’ambiente. La tabella seguente conserva i risultati della prima consegna M1 del 1° ottobre; non va letta come una riesecuzione automatica sul codice amministrativo successivo.

| Prova | Risultato e riferimento |
| --- | --- |
| Regressioni esistenti | 109/109 passate; [dettaglio](evidence/regressions.md) |
| Learning | 62 test puri passati; 7 test DB eseguiti separatamente, non conteggiati dai `skip` della suite generica |
| Flusso e isolamento reali | Gateway JSON Learning, cookie verificato e PostgreSQL locale; [integrazione](evidence/local-integration.md) |
| Browser | Caso, salvataggio/ripresa, consegna, feedback, recupero, formatore, perdita connessione e sessione; [URL e screenshot](evidence/browser.md) |
| Contenuti | Validazione del pacchetto privato, 21 controlli semantici e 35 test del riferimento; [contenuti](evidence/content.md) |
| Carico | 50 utenti sintetici, runtime ottimizzato: 400 richieste confermate, p95 autosave 94,8 ms e invio 157,5 ms sul gateway finale; [misure e limiti](evidence/load.md) |
| Backup/retention | Ripristino con conteggi e digest uguali su 48 tabelle; 5 controlli della conservazione; [integrazione](evidence/local-integration.md) |
| Piano completo | 47 ID: 43 PASS locali, 0 FAIL correnti, 4 BLOCKED; FAIL storici conservati; [matrice P0](evidence/test-matrix.md) |

La modalità di sviluppo ha **fallito** le soglie di latenza: nella prova senza altro traffico p95 autosave 8007,8 ms e invio 6880,1 ms. La build ottimizzata, compreso il gateway JSON finale, le ha superate; i risultati negativi sono conservati, non cancellati. Nessuna misura locale equivale a una misura dell'infrastruttura di rilascio, del trasporto Neon o del cold start.

Lint, controllo TypeScript e build standard Next/Turbopack sono passati. Le prove del codice definitivo registrano gli hash dei sorgenti prima del commit; la ricevuta finale verifica la corrispondenza con lo SHA consegnato e distingue le letture di controllo successive dalle suite precedenti. Controllo prima del commit: nessuna banca privata, chiave privata o URL di database con password fra i file nuovi/modificati; `.gitignore` protegge i percorsi di seed privati. Questo controllo non sostituisce la gestione degli accessi a database e backup.

## Ciò che resta aperto

Il proprietario dell'ambiente deve individuare un'anteprima con database separato e configurazione Firebase approvata. Non sono stati usati i collegamenti reali della survey come ambiente di prova. Restano da attestare gli scenari BLOCKED della matrice, inclusi login/provider e inviti reali, lettore di schermo, regressione sui collegamenti reali e prova generale con due partecipanti non amministrativi. Le modifiche survey in corso devono essere integrate preservandole e il commit combinato va nuovamente verificato.

Visibilità nominativa, formatori autorizzati, conservazione, supporto e trattamento delle copie di backup richiedono configurazione e conferma del responsabile prima dei dati reali. Gli URL verificati sono solo locali e temporanei; nessun URL o QR per il corso viene dichiarato pronto.

## Rollback e prosecuzione

La [procedura operativa](RUNBOOK.md) descrive importazione, iscrizioni, grant, attivazione, prove e rollback. Per bloccare Formazione: disabilitare il singolo programma o `LEARNING_ENABLED`; per congelare le scritture mantenendo il feedback usare la chiusura. Ripristinare la build precedente con flag spento, conservando le tabelle additive e tutte le ricevute. Non eseguire `DROP`, reset o ripristino del database della survey per annullare la formazione.

La [verifica operativa](operations-review.md) distingue procedura documentata e rollback effettivamente provato. I servizi locali sono destinati ai test e vengono arrestati dopo la verifica finale; le istruzioni per riavviarli sono in `scripts/learning-test/README.md`.

Ricevute locali escluse da Git, senza seed o credenziali: `../../learning-verification.private.json` per la prima consegna M1 e `../../admin-verification.private.json` per l’estensione amministrativa. I risultati JSON pubblicabili e gli screenshot sono raccolti in `evidence/results` e `evidence/screenshots`.

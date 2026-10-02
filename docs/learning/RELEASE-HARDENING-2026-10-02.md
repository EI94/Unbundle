# Verifica integrata e correzioni del 2 ottobre 2026

**Correzioni verificate sull’ultima build locale; produzione non dichiarata pronta.** Nessun merge o deploy è stato eseguito. Questo documento integra le evidenze precedenti, senza trasformare i loro PASS in prove della nuova versione.

## Versione e ambiente delle prove

La candidata è il working tree del branch `codex/m1-training`, basato su `5ad1ec99e87f09a2a0a4be4f2e504936cc44ddcd`, con correzioni di identità/sessione e sorgente survey integrata. La build ottimizzata finale di questo giro è **`mLKpQvP1366UJpxhqoHjS`** e include i fix idea, retry e portfolio. La [ricevuta della fonte](evidence/results/release-20261002/tested-build-source.json) identifica 21 file con SHA-256; la rilettura indipendente conferma **21 corrispondenze su 21**. La prima build integrata `my2t-fLxt7xkuAmx9AT3c` resta storica. Il commit viene identificato nella ricevuta post-commit locale `release-verification.private.json` e nella consegna in chat; i 21 hash permettono di confrontarlo con la build testata. La ricevuta successiva non è inclusa nel commit che attesta.

Le ricevute pubblicabili di questo giro sono in [evidence/results/release-20261002](evidence/results/release-20261002). Log completi e materiali di lavoro restano nella cartella locale riservata `/private/tmp/unbundle-release-evidence-20261002`: non copiarne indiscriminatamente il contenuto nel repository, perché comprende anche fixture e materiali privati. Le ricevute pubblicate non contengono credenziali, banca privata o risposte di persone reali.

Le prove applicative usano Next in modalità production **su localhost**, PostgreSQL isolato e Firebase Auth Emulator, esclusivamente con account e contenuti sintetici. Il trasporto di test esegue le query Neon/Drizzle su PostgreSQL locale. Non dimostra il comportamento dell’infrastruttura remota o dei provider reali. Nessuna chiamata LLM è necessaria per M1.

## Difetti riprodotti e correzioni

Due problemi di prodotto sono stati riprodotti nel browser sulla baseline `5ad1ec9`, conservando le prove originali:

| Caso | FAIL osservato prima della correzione | Correzione |
| --- | --- | --- |
| `B-ACCOUNT-IDEA` | A scriveva una nuova idea; B accedeva da un’altra scheda dello stesso browser. Il salvataggio nella vecchia scheda confermava e registrava il testo come proposta di B. Il controllo del database confermava l’errore di attribuzione. | Il comando richiede l’identità attesa e il server la confronta con la sessione. Per una bozza esistente sono obbligatori anche ID e revisione; l’aggiornamento verifica entrambi insieme all’autore autenticato e all’iscrizione. |
| `B-ACCOUNT-HISTORY` | Dopo accesso di B, il ritorno nella cronologia della scheda A mostrava ancora la bozza di A dalla cache del router. | Un confine limitato alle pagine Learning nasconde i contenuti finché una verifica server non conferma identità attesa e accesso al workspace. Ricontrolla su navigazione, ritorno alla pagina e riattivazione della scheda. |

Evidenze baseline: `browser-baseline-failures.json`, `idea-account-switch-failure.json`; screenshot originali in `screenshots/idea-account-switch-fail.jpg` e `screenshots/account-history-cache-fail.jpg`. Le fixture della baseline sono state conservate; il retest usa un corso distinto.

L’identità attesa è una **precondizione**, mai una fonte di autorizzazione. Lo stesso controllo è applicato all’avvio di un’attività e a tutte le richieste dell’amministrazione, comprese letture e importazione. Le istanze delle form includono l’autore nella propria identità React, così uno stato locale di A non può essere riutilizzato con props di B. Restano attivi gli accessi per workspace, corso, iscrizione, oggetto e ruolo, i grant espliciti e i ricontrolli SQL nelle mutazioni.

Il nuovo `POST /api/learning/session` restituisce soltanto un codice di stato, verifica origine esatta, JSON rigoroso, limite in streaming di 1 KiB, sessione e membership; non restituisce nomi, token, risposte o permessi. Le risposte non sono memorizzabili in cache. Un controllo precedente non autorizza una richiesta successiva: le API verificano comunque ogni operazione.

Quando la sessione non è confermata, React Activity nasconde il contenuto e sospende gli effetti, preservando lo stato della form in memoria per il ritorno dello stesso account. Le risposte obsolete ai controlli vengono ignorate. La guardia di abbandono copre anche l’attesa della verifica, dopo una segnalazione della review indipendente. Questo **non cancella dati già ricevuti dal browser** e non promette protezione da chi abbia accesso al processo o agli strumenti di sviluppo di quel browser. Non vengono scritte risposte in storage persistente del client.

## Survey già pubblicata: integrazione senza retrocessione

L’audit in sola lettura ha rilevato che il deploy attivo era stato prodotto da un checkout con modifiche non committate, non dal solo SHA dichiarato. Il confronto dei contenuti pubblicati ha trovato 328/328 file sorgente tracciati coincidenti con il checkout originale e ha confermato anche i due file nuovi `survey-track.ts` e `survey-track.test.ts`. Tutti i dieci file della modifica survey, incluso `package.json`, risultavano già pubblicati.

La candidata preserva quella fonte: **nove file coincidono esattamente**, mentre `package.json` conserva l’unione degli script survey e Learning. Il checkout originale non è stato modificato. La [provenienza pubblicabile](evidence/results/release-20261002/survey-integration-provenance.json) registra il confronto; i dettagli in sola lettura rimangono in `production-source-comparison.json` e `production-tracked-source-comparison.json`.

La differenza rispetto alla vecchia baseline Git contiene etichette dei percorsi, indicazioni di copertura e il default dei nuovi inviti mirati privi di track esplicito. È sorgente già online, non una nuova modifica della survey introdotta dalla formazione. Il salvataggio delle risposte, il sistema di autenticazione e le associazioni degli account non sono stati riscritti. Le risposte anonime non vengono collegate agli account Learning e il training non ripete la survey.

Un rollback basato soltanto sul vecchio commit ricostruirebbe una versione precedente alla survey attuale. Per il rollback applicativo va conservato il deploy immutabile attivo identificato dall’audit, inclusivo di quelle modifiche. Nessun rollback di produzione è stato eseguito.

## Ulteriori correzioni dopo il giro browser

È stato riprodotto un terzo FAIL: una proposta con titolo e problema validi, ma senza risultato desiderato, poteva arrivare alla conferma e riceveva un errore tecnico generico. Anche la singola richiesta HTTP riproduceva `503 technical`; la bozza rimaneva invariata e non veniva creato alcun record portfolio. Il requisito era di almeno cinque caratteri in titolo, problema e risultato desiderato, ma il client non lo evidenziava e il server confondeva un errore di validazione con un guasto. Prove: `idea-submit-investigation.json`, `idea-submit-field-lengths.json`, `idea-incomplete-failure.json`.

La correzione usa validazione Zod condivisa, risposta `422 invalid` e messaggi associati ai campi. L’interfaccia indica i tre campi necessari per inviare e gli altri facoltativi; prima della revisione e dell’invio mostra gli errori e porta il focus al riepilogo. Rimane possibile salvare bozze incomplete. A corso chiuso la pagina è di sola lettura; una form già aperta che riceve il rifiuto di chiusura conserva il testo e interrompe i comandi di scrittura.

Un quarto FAIL browser riguardava **Riprova**: dopo sospensione e riattivazione dell’assegnazione, il pulsante continuava a mostrare l’errore, mentre una ricarica completa recuperava la bozza. Le guide e il runtime Next installati distinguono `reset()` — solo rendering senza nuove letture — da `unstable_retry()` — nuova richiesta e rendering del segmento. Il confine Learning ora usa quest’ultima API. Nessuna modifica all’autenticazione condivisa.

La nuova build è stata riprovata: errore collegato al campo **prima della conferma**, poi compilazione valida, salvataggio e doppio clic d’invio con esito persistito. Il [controllo HTTP](evidence/results/release-20261002/idea-incomplete-fixed.json) conferma `422 invalid`, errore `desiredOutput`, bozza invariata e nessuna proposta portfolio; il [controllo dopo il browser](evidence/results/release-20261002/browser-idea-double-submit-final.json) conferma un solo record portfolio e un solo evento di promozione, autore originale e proiezione esatta dei soli campi dell’idea, senza risposte o grading. Il retest di **Riprova** dopo sospensione e riattivazione recupera la pagina senza ricarica manuale. Il corso chiuso mostra il messaggio previsto e non offre salvataggio.

Un quinto difetto, **preesistente nel portfolio**, è emerso dal percorso d’invito: anche un contributor vedeva il pannello “Team e modello di ranking”, aperto automaticamente al primo accesso. I comandi di salvataggio e ricalibrazione verificavano già il ruolo sul server e negavano il contributor prima di scritture o chiamate AI; non sono stati azionati durante la prova. La pagina serializzava però il campo `whatsappWebhookUrl` nelle props del pannello indipendentemente dal ruolo, con possibile esposizione di un endpoint riservato quando valorizzato. Non sono stati letti valori reali. La correzione minima verifica sul server l’accesso corrente al workspace, con priorità del ruolo organizzativo esistente, e rende pannello e props soltanto per `canManageWorkspaceSettings`. Un grant amministrativo Learning non attribuisce quel permesso. Il retest browser non mostra il pannello al partecipante; [sei controlli HTML/RSC](evidence/results/release-20261002/portfolio-settings-http.json) confermano marker assente per contributor e gestore Learning, presente per gestore workspace autorizzato. Il webhook sintetico non è mai stato chiamato e il campo della fixture è stato ripristinato. Questo è un difetto di prodotto distinto, non un errore del sistema di test.

## Risultati automatici verificati

I test applicativi sotto sono stati ripetuti sulla build finale locale; i risultati delle suite preesistenti, indicate separatamente, risalgono al primo giro integrato.

| Verifica | Esito della candidata locale | Ricevuta |
| --- | --- | --- |
| Build ottimizzata, TypeScript, lint completo finale | PASS | `build-validation-final.log`, `lint-release-complete.log`; [hash della fonte](evidence/results/release-20261002/tested-build-source.json) |
| Contratti, grading, privacy e logica Learning | 81 PASS, 0 FAIL; 7 test DB SKIP | [riepilogo con digest dei log](evidence/results/release-20261002/unit-database-summary.json) |
| Vincoli sul database PostgreSQL 16, eseguiti separatamente | 7 PASS, 0 FAIL, 0 SKIP | [riepilogo](evidence/results/release-20261002/unit-database-summary.json) |
| PostgreSQL 17.11: migrazioni su database vuoto e vincoli | 14 applicazioni PASS, inclusa 0012 due volte; 7 test PASS, 0 FAIL, 0 SKIP | [ricevuta sintetica](evidence/results/release-20261002/postgres17-synthetic.json) |
| Auth, collaborazione workspace, survey, portfolio, MCP e Slack — primo giro integrato | 115 PASS, 0 FAIL: rispettivamente 5, 4, 50, 16, 11 e 29 | [riepilogo storico](evidence/results/release-20261002/unit-database-summary.json) |
| Amministrazione HTTP, ambiti e cambio account | 40 PASS, 0 FAIL | [ricevuta](evidence/results/release-20261002/admin-acceptance-production-d4461c7e-09eb-4920-8594-99df4cca8731.json) |
| Percorso partecipante HTTP e avvio con identità attesa | 36 PASS, 0 FAIL | [ricevuta](evidence/results/release-20261002/http-acceptance-production.json) |
| Endpoint di controllo sessione, revoca e nuovo accesso | 8 PASS, 0 FAIL | [ricevuta](evidence/results/release-20261002/session-http.json) |
| Inviti workspace esistenti: scadenza, revoca, consumo, email diversa, anonimo, accettazione e replay | 8 PASS, 0 FAIL | [ricevuta](evidence/results/release-20261002/invite-http.json) |
| Pacchetto privato esatto: importazione, M1 completo, recupero e turni | 11 PASS, 0 FAIL; fixture proprie e pack locale di prova rimossi dal DB | [ricevuta senza contenuti](evidence/results/release-20261002/private-pack-http-results.json) |
| Query concorrenti reali: avvio/spostamento e riapertura/cancellazione | 4 PASS, 0 FAIL; fixture proprie rimosse | [ricevuta](evidence/results/release-20261002/admin-concurrency.json) |
| Props riservate portfolio per ruolo, HTML e RSC | 6 PASS, 0 FAIL | [ricevuta](evidence/results/release-20261002/portfolio-settings-http.json) |
| Ricerca di marker privati nel JavaScript pubblico, inclusi chunk differiti | 69 asset PASS | [ricevuta](evidence/results/release-20261002/all-client-bundles-final.json) |
| HTML/RSC partecipante prima dell’avvio e script iniziali | PASS | [ricevuta](evidence/results/release-20261002/client-scan-production.json) |
| Flag globale disabilitato e dati invariati | 3 PASS, 0 FAIL | [ricevuta](evidence/results/release-20261002/rollback-global-flag.json) |

I sette SKIP non sono stati contati come PASS: i sette esiti database derivano dalla successiva esecuzione dedicata. Le prove concorrenti usano un adapter di identità sintetica e query reali, senza pretendere di provare l’autenticazione HTTP.

Il nuovo cluster PostgreSQL 17 è stato creato vuoto con sole fixture casuali, poi arrestato; il cluster di test precedente è rimasto invariato. Questa compatibilità non è un backup o restore della produzione. Il primo wrapper del report PG17 cercava prefissi TAP mentre Node emetteva il formato spec: il processo dei test era già terminato con sette PASS; è stato corretto soltanto il lettore dei log, senza cambiare prodotto o ripetere il test.

Il primo giro admin aggiornato aveva **38 PASS e 2 FAIL di harness**. Le nuove prove d’identità avevano aggiunto una bozza, rendendo errato il numero fisso atteso dalla cancellazione; inoltre una verifica cercava il pulsante di esportazione nell’HTML iniziale, prima che il nuovo confine rendesse visibile l’interfaccia. Il test corretto misura i record del proprio corso prima del purge e ne verifica l’assenza dopo; esportazione autorizzata e assenza di permesso di revisione sono provate via HTTP, la visibilità del comando è demandata al browser. Il prodotto non è stato modificato per superare questi assert. Il FAIL storico rimane in `admin-acceptance-production-79fd0fed-2360-4d7e-8fe5-a83f4d06e28c.json`; il giro corretto è `admin-acceptance-production-f6edb1dc-9887-49e8-95d9-0e8cb01ab62c.json`.

## Browser, contenuti e prestazioni

La [ricevuta browser finale](evidence/results/release-20261002/browser-hardening-results.json) registra **31 osservazioni: 27 PASS, 3 PASS_AFTER_FIX e 1 BLOCKED**. Il primo giro ne comprendeva 24, con due difetti ancora da correggere e la riattivazione parziale; le prove iniziali restano conservate e i retest sono attribuiti alla build corretta. Il retest della proposta dopo cambio account è inoltre documentato nella [ricevuta](evidence/results/release-20261002/idea-account-switch-retest.json): una bozza appartiene ad A, nessuna a B. Sono PASS il ritorno nella cronologia con account diverso, la ripresa del testo dell’autore originario, il conflitto tra due schede con scelte locali conservate, reload delle risposte e doppia consegna con una sola ricevuta e un solo evento audit.

Sono stati osservati il caso nelle sue due fasi, la riflessione e la modalità senza AI salvate e recuperate, finale e recupero distinti nello storico, due attività richieste consegnate su due. Il testo contenente tag HTML rimane letterale sia nel riepilogo sia nella vista del formatore. La vista formatori rispetta il turno autorizzato ed è leggibile a 390 px senza scorrimento orizzontale. Inviti scaduti, revocati, consumati, email diversa, accesso anonimo, accettazione valida e replay sono stati verificati con account sintetici.

L’account con solo permesso di esportazione vede il pulsante CSV e il clic conferma la generazione; audit, contenuto e ambito del CSV sono provati anche [via HTTP](evidence/results/release-20261002/export-only-browser-http.json). **Il file scaricato nel browser non è verificato**: il tool di attesa del download è scaduto. La conferma nell’interfaccia non viene usata come prova di un file salvato sul dispositivo.

Ulteriori retest browser PASS sulla build finale: cambio account dell’amministratore nasconde il pannello e il ritorno all’identità iniziale recupera il titolo non salvato; pannello admin e form idea del partecipante a 390 px senza overflow; file JSON strutturalmente errato rifiutato prima dell’importazione; corso chiuso consultabile senza pulsante di salvataggio. La survey sintetica anonima è stata compilata, salvata automaticamente, ricaricata e inviata: il [controllo DB](evidence/results/release-20261002/survey-browser-database-final.json) conferma un solo rispondente e una sola risposta, identità nulla, audit senza account e nessun collegamento Learning. Il primo assert richiedeva erroneamente metadata vuoti; i metadata tecnici legittimi sono stati conservati e controllati per assenza di identità. È una correzione della prova, non del prodotto; [l’esito iniziale](evidence/results/release-20261002/survey-browser-check-initial.json) rimane disponibile. Non sono state aperte o alterate risposte reali.

Gli URL del corso sintetico usati nel browser sono locali e richiedono l’account del ruolo indicato; dopo l’arresto dei servizi non sono raggiungibili. Non sono URL del corso reale né contengono token d’invito o survey:

| Percorso verificato | URL locale |
| --- | --- |
| Proposta del partecipante: bozza, identità, invio e recupero | [La mia idea](http://127.0.0.1:53100/dashboard/b680e8f9-62e8-4c61-adb0-7b0850b4a475/learning/d477d4c3-762b-414d-b226-e8301a85343e/ideas) |
| Amministratore: assegnazioni, chiusura/riapertura, cambio account | [Gestione del corso](http://127.0.0.1:53100/dashboard/b680e8f9-62e8-4c61-adb0-7b0850b4a475/learning/d477d4c3-762b-414d-b226-e8301a85343e/admin) |
| Amministratore: controllo e rifiuto di file non conforme | [Catalogo amministrativo](http://127.0.0.1:53100/dashboard/b680e8f9-62e8-4c61-adb0-7b0850b4a475/learning/admin) |

Il pacchetto privato esatto è stato riprovato tramite CLI e gateway HTTP con utenti sintetici: checkpoint, caso in due fasi, riflessione senza AI, finale A con errore essenziale, recupero B e storico immutato. La [ricevuta](evidence/results/release-20261002/private-pack-http-results.json) pubblica hash, esiti e calendario, senza banca o risposte: M1 il **5 ottobre 2026, 14:30–16:30**, e il **7 ottobre 2026, 10:00–12:00**, entrambi `Europe/Rome`. Cinque tentativi consegnati e cinque audit; pack e fixture proprie rimossi dal DB al termine.

Il [carico finale](evidence/results/release-20261002/load-production-results.json) ha completato **450/450 richieste con 50 utenti concorrenti**, comprese 50 verifiche del nuovo confine di sessione. P95 caldo: controllo sessione **62,7 ms**, autosave combinato **89,7 ms** (peggior giro **90,0 ms**), invio **159,9 ms**, pagina avanzamento **290,3 ms**. Cinquanta ricevute, cinquanta proprietari e cinquanta audit; tutti i retry restituiscono la consegna originale. Fixture proprie rimosse. Prewarm distinto dai percentili: non è una misura di cold start, Neon remoto o infrastruttura di rilascio. Le precedenti latenze FAIL in sviluppo restano conservate in [evidence/load.md](evidence/load.md).

## Blocchi di rilascio e limiti reali

| Verifica richiesta | Stato | Motivo e condizione per completarla |
| --- | --- | --- |
| Preview remota con database separato | BLOCKED | L’audit della configurazione ha rilevato un solo record `DATABASE_URL` condiviso tra preview e produzione. La preview corrente non è un ambiente di test isolato. |
| Accesso sui provider reali e email reali | BLOCKED | Le prove usano emulatore e inviti sintetici, senza invii esterni. Configurazione Firebase della preview e verifica dei provider/domini effettivi ancora necessarie. |
| Backup completo di produzione e restore isolato | BLOCKED_AUTO_REVIEW | La revisione automatica ha rifiutato l’esportazione dell’intero database, che può includere risposte survey, perché manca consenso diretto per contenuto e destinazione locale. Il comando non è partito: nessun archivio o ripristino è stato creato. |
| Piano provider, finestra PITR e snapshot | BLOCKED | Accesso gestionale al provider non connesso/verificato. L’accesso SQL in sola lettura non prova recuperabilità o retention del provider. |
| Lettore di schermo | BLOCKED | Nessuna prova assistiva completa attestata; semantica, tastiera e controlli automatici non la sostituiscono. |
| Prova generale nel contesto reale | BLOCKED | Da svolgere con due partecipanti non amministrativi, responsabile della formazione e URL effettivi, dopo la preparazione autorizzata dell’ambiente. |

Per il backup sono pronti client compatibili e un piano di esportazione coerente, con directory e file privati, ma il dry-run non esporta dati. `backup-auto-review-block.json`, `backup-client-readiness.json`, `backup-dry-run.json` e `restore-preparation.json` mantengono separati preparazione ed esecuzione. Il vecchio backup/restore del database sintetico locale non è un backup della produzione. Nessun percorso alternativo di esportazione viene usato per aggirare il blocco.

Nel catalogo remoto letto dall’audit non erano presenti tabelle o trigger Learning; `LEARNING_ENABLED` era assente. Quindi codice, migrazione additiva, importazione privata, grant e assegnazioni richiedono ancora una procedura autorizzata. I percorsi partecipante verificati in questo giro sono locali; non esiste un URL o QR operativo di produzione attestato da questa nota.

Per ritirare la formazione non si deve sovrascrivere il database vivo della survey: usare disattivazione della feature o rollback applicativo secondo [RUNBOOK.md](RUNBOOK.md), conservando lo schema additivo e le risposte. Backup e restore sono operazioni separate. Restano applicabili [ADMIN.md](ADMIN.md) e [operations-review.md](operations-review.md), distinguendo le prove storiche dal presente stato di rilascio.

## Esito della review indipendente

Riletti il diff integrato, i nuovi endpoint e i flussi dei form. Le cinque anomalie di prodotto sopra descritte hanno correzioni e retest locali, compreso il difetto preesistente del portfolio. La guardia di abbandono durante la verifica è stata inoltre corretta dopo la review. Le precondizioni d’identità non sostituiscono autorizzazione o scope; le mutazioni mantengono i ricontrolli e i vincoli esistenti. Non sono emersi ulteriori finding bloccanti in questa review. La ricevuta post-commit collega la fonte verificata alla consegna; restano i blocchi dell’ambiente reale e i limiti indicati. La review non costituisce dichiarazione di prontezza della produzione.

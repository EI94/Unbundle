# Matrice P0 — evidenze locali e limiti

Data: 1 ottobre 2026, Europe/Rome. Branch `codex/m1-training`; base `e63a2a719410af77982c85522dad6339975f869e`. Verifiche sul working tree della feature: il report finale deve associare e ripetere i controlli sul commit consegnato. Nessuna migrazione, invito o deploy di produzione è stato eseguito.

**PASS** indica un comportamento verificato nel perimetro locale descritto, non una validazione di produzione. **FAIL** indica un criterio misurato non raggiunto. **BLOCKED** indica una prova completa mancante; le verifiche parziali sono indicate senza trasformarle in PASS. L'anteprima autorizzata, il provider di login reale, i destinatari reali e l'approvazione privacy/accessi restano fuori da queste evidenze.

**Trasporto JSON rivalidato:** per correggere O02 è stato introdotto un endpoint Learning che riusa validazione e autorizzazioni esistenti evitando il rendering del layout dopo un salvataggio. La prima esecuzione ha rilevato un rifiuto errato dell'Origin locale normalizzato da Next: 17 controlli falliti e 7 dipendenti non eseguiti, conservati nell'[esito iniziale](results/http-gateway-origin-failure.json). Dopo la correzione del confronto con l'Host effettivo, nuova esecuzione completa: **35 PASS, 0 FAIL**. I primi 11 controlli negativi non vengono presentati come prova delle autorizzazioni. O02 e D04 browser e il carico di 50 utenti sono stati ripetuti con esito PASS sul gateway finale, separatamente dalle prove del trasporto precedente.

Fonti ripetibili:

- **HTTP**: `scripts/learning-test/http-acceptance.mjs`, 35 controlli passati sul gateway JSON finale, con vere sessioni Firebase Auth emulator, validatori e DAL condivisi e PostgreSQL isolato; [risultato versionato](results/http-acceptance-production.json). Storici distinti: 25 controlli in sviluppo e 31 sul precedente trasporto Flight, conservati prima del gateway.
- **CLI/MIGRAZIONE**: [12 verifiche locali](results/learning-cli-results.json) di importazione/versione, iscrizione, grant, apertura, chiusura e disabilitazione; [applicazione delle migrazioni e secondo passaggio 0012](results/migration-results.json).
- **UNIT**: `npm run test:learning`; test puri del pack, grading, DTO, policy, idee, retention e confine HTTP. **CONTENT**: 35 reference test e 21 controlli sul pack riservato, documentati in [content.md](content.md); ulteriori [11 controlli HTTP sul pack effettivo](results/private-pack-json-precommit-results.json), con soli hash, esiti, calendario e conteggi nel report.
- **BROWSER**: [percorso osservato e screenshot](browser.md): caso, salvataggio/ripresa dopo reload, decisioni, esempio, riflessione senza AI, consegna/feedback, recupero, storico e formatore. Provati arresto/ripristino app, perdita/recupero sessione, ACK ritardato, DB indisponibile al submit e flag off/on durante esercizio; [controllo DB del submit recuperato](results/browser-unavailable-submit-db.json). Percorso completo del caso da tastiera ripetuto dopo correzione del focus: PASS. Screen reader, scadenza naturale del cookie e login provider non attestati.
- **REGRESSION**: [esecuzione sul nuovo codice](regressions.md): 109 test preesistenti passati, lint/typecheck passati; Learning 62 passati, 7 test DB saltati nella suite generica e verificati separatamente dove documentato.
- **CLIENT**: [scansione esposizione locale](local-integration.md): HTML/RSC, 8 script client in sviluppo e 23 nel runtime ottimizzato, effettivamente caricati e privi dei marker privati e delle chiavi; [risultato della build finale](results/client-scan-production.json).
- **RETENTION/BACKUP**: [retention](results/retention-acceptance.json), 5 controlli, e [backup/restore](results/backup-restore.json), 2 controlli: scadenza, dry run, ruoli, isolamento A/B, retry, conservazione portfolio e ripristino di snapshot coerente con conteggi/digest delle 48 tabelle pubbliche. Solo dati sintetici.
- **LOAD**: [gateway JSON finale](results/load-json-precommit-results.json): 50 utenti concorrenti, 400 richieste sul runtime Next ottimizzato locale, soglie calde e integrità PASS. Storici distinti: [Flight ottimizzato](results/load-production-precommit-results.json) e [sviluppo](results/load-results.json), con integrità PASS ma latenze FAIL; non cancellati o riclassificati. Build standard Turbopack della feature passata. Avvio a freddo e infrastruttura preview non misurati.
- **ROLLBACK/FLAG**: [flag globale](results/rollback-global-flag.json) e [build precedente](results/rollback-baseline.json): 3 controlli passati con flag globale disabilitato e 3 con e63 avviata sullo stesso DB additivo. Navigazione/azioni Learning bloccate, pagine portfolio/readiness accessibili e digest invariati. Verifica di compatibilità locale su processi separati, senza cutover di distribuzione né risposte della survey reale nella fixture.

## Accessi e isolamento

| ID | Esito locale | Evidenza e limite |
| --- | --- | --- |
| A01 | BLOCKED | HTTP verifica redirect del deep link con callback conservata; nuova sessione emulator funzionante. Login completo attraverso UI/provider reale e ritorno al link non provati. |
| A02 | PASS | HTTP nega il programma/workspace esterno; query e vincoli degli oggetti sono circoscritti. Nessun oggetto di B restituito all'account di A. |
| A03 | PASS | HTTP nega modifica e lettura del tentativo di un altro learner nello stesso workspace; export protetto da grant esplicito e test U04. |
| A04 | PASS | HTTP ottimizzato: lista e URL diretti del dettaglio formatori negano un'altra coorte e un altro workspace; export limitato alla coorte autorizzata e protetto da grant separato. Nessuna scrittura di revisione M1 esposta. |
| A05 | PASS | HTTP nega la vista nominativa a sponsor e manager privi di review; sponsor senza export negato. Il ruolo portfolio non attribuisce lettura didattica. |
| A06 | PASS | HTTP ottimizzato: dopo apertura del draft, revoca membership e tentativo di salvataggio/rilettura respinti; revoca del reviewer nega lista ed export anche con grant rimasti. Record preesistenti conservati; nessun dato del workspace restituito. |
| A07 | PASS | HTTP stesso account in due workspace, percorsi e storici distinti; nessun identificativo del tentativo B nello storico A. |
| A08 | BLOCKED | Non inviati o consumati inviti reali. Casi scaduto/revocato/esaurito/email diversa non verificati end-to-end nel flusso esistente. |
| A09 | PASS | HTTP rifiuta identity/score/role aggiunti al payload; UNIT rifiuta campi non ammessi, opzioni/ID e rubricVersion/confidenza come autorità di grading. |
| A10 | PASS | HTTP chiama direttamente il gateway JSON finale con sessioni distinte e payload manomessi. Origine esterna/assente, operation non ammessa, envelope extra e corpo oltre 64 KiB respinti; senza sessione restituisce JSON 401 no-store senza redirect. Nessuna dipendenza dal layout per autorizzare le mutazioni. |

## Salvataggio e concorrenza

| ID | Esito locale | Evidenza e limite |
| --- | --- | --- |
| D01 | PASS | HTTP + BROWSER: stato, revisione e ordine persistiti nel DB; ripresa con nuova sessione emulator e dopo reload. Sul gateway finale, Back/Forward dopo il primo avvio recupera la bozza in memoria anche quando la pagina ripresenta “Inizia”: il server autorizza lo stesso tentativo, poi salvataggio e reload conservano la scelta. |
| D02 | PASS | BROWSER su runtime ottimizzato: app realmente arrestata, tre scelte conservate dopo errore autosave senza falso ACK; backup/retry disponibili; dopo riavvio, retry e “Salvato” confermato. Provato server irraggiungibile, non interruttore offline del dispositivo. Screenshot connection-recovery.jpg. |
| D03 | PASS | HTTP due richieste contemporanee sulla stessa revisione: un successo, un conflitto esplicito e una sola nuova revisione nel DB. Interazione completa con due tab da aggiungere alla prova generale. |
| D04 | PASS | BROWSER ripetuto sul gateway JSON finale: salvataggio realmente committato, ACK trattenuto per 10 secondi; Back/Forward e nuova scelta prima della vecchia risposta. Dopo ACK e ulteriore Back/Forward la nuova scelta resta selezionata, con conflitto esplicito e download/confronto disponibili. Nessun arretramento o cancellazione della cache; screenshot delayed-ack-recovery.jpg. |
| D05 | PASS | HTTP e LOAD-DEV: invii concorrenti/retry restituiscono una sola consegna e audit, stessa ricevuta; controlli diretti nel DB. |
| D06 | PASS | HTTP nega modifiche dopo invio; trigger DB protegge consegna, versione e identità. Decisioni del caso congelate prima dell'esempio. |
| D07 | PASS | HTTP consegna incompleta respinta senza risultato; UNIT testo vuoto/spazi, limiti, campi/opzioni mancanti e modalità richiesta. Validazione client presente; accessibilità completa separata in U02. |
| D08 | PASS | HTTP ottimizzato: draft con due scelte già salvate, pubblicazione di una nuova versione con testo diverso e apertura del nuovo programma. Riprendendo il vecchio tentativo, risposte, revisione, ordine e contenuto sono identici; una versione attesa errata è respinta. |
| D09 | PASS | HTTP ottimizzato: programma chiuso/archiviato nega avvio e conserva feedback; sessione futura nega avvio e salvataggio del draft esistente. Data client manomessa respinta; finestre/minuti calcolati dal server e verificati nei test di policy. |
| D10 | PASS | Seed/schema conservano due repliche con unico programma/versione; iscrizione unica per persona/modulo, retry CLI idempotente, coorti diverse presenti nelle fixture. Non sono state iscritte persone reali. |

## Correzione e riservatezza della banca

| ID | Esito locale | Evidenza e limite |
| --- | --- | --- |
| G01 | PASS | UNIT/CONTENT tutte corrette, tutte incerte e soglia esatta; HTTP risultato 8/8 e caso 6/6 persistiti. Nessun LLM richiesto. |
| G02 | PASS | HTTP e UNIT: 7/8 con errore essenziale produce `needs_practice`, con dettaglio pertinente e recupero. |
| G03 | PASS | UNIT grading invariato su 100 permutazioni; CONTENT risposte tutte sulla seconda opzione non superano sistematicamente le prove. Correzione per ID, non posizione. |
| G04 | PASS | HTTP/CLIENT: HTML, RSC, DTO, 8 script in sviluppo e 23 nel runtime ottimizzato non contengono i sei marker privati della fixture né correct_option_ids; esempio del caso solo dopo commit delle decisioni. Copertura dei percorsi eseguiti, non promessa universale di assenza di fughe. |
| G05 | PASS | UNIT rifiuta confidenza come campo di grading; nessun punteggio derivato da autovalutazione, mode o lunghezza della riflessione. |
| G06 | PASS | HTTP consegna incompleta mantiene `draft` e `result=null`; aggregati includono soltanto consegne valide, non assenti/incompleti come zero. |
| G07 | PASS | HTTP mantiene tentativo originale e recupero distinto nel DB; UI mostra storico. BROWSER verifica A errata, recupero B consegnato e storico distinto; nessuna promessa di guadagno causale o prova equivalente. |
| G08 | PASS | CONTENT reference: caso sintetico negativo senza falso match e variante positiva limitata a tratta/giorno. Nessun matcher operativo o assegnazione implementato. |

## Idee volontarie e portfolio

| ID | Esito locale | Evidenza e limite |
| --- | --- | --- |
| P01 | PASS | HTTP quattro invii concorrenti + retry: una sola voce `source=learning`, collegamento alla bozza verificato nel DB. |
| P02 | PASS | HTTP caso completo in due fasi e senza AI: conteggio portfolio invariato. Nessuna promozione implicita delle risposte. |
| P03 | PASS | HTTP altro autore respinto; DTO e mapping idea consentono solo campi espliciti, nessuna risposta/chiave/score copiata. Vincoli di workspace e identità nel DB. |
| P04 | PASS | HTTP promozione persistita senza provider LLM/notifiche; tentativo duplicato/retry riconciliato sullo stesso UUID. Il quiz non dipende da quel flusso. |

## Regressioni e distribuzione

| ID | Esito locale | Evidenza e limite |
| --- | --- | --- |
| R01 | BLOCKED | Suite readiness baseline 44/44; nessun file della survey modificato dalla feature e nessuna associazione anonimo/account introdotta. Campagna in corso e link reali deliberatamente non interrogati: smoke test autorizzato ancora necessario. |
| R02 | PASS | REGRESSION sul nuovo codice: sei suite preesistenti 109/109, lint/typecheck PASS; Learning 62 PASS, 7 DB saltati nel comando generico e non contati come passati. Nessun cambiamento del lavoro survey non committato nell'originale. Associazione al commit finale ancora necessaria. |
| R03 | PASS | Migrazione applicata due volte su DB isolato; build precedente e63 realmente avviata sullo stesso DB/schema additivo, senza reset/drop. Workspace, portfolio e readiness accessibili; conteggi/digest di Learning e portfolio identici. Compatibilità locale del rollback, non deploy/cutover autorizzato. |
| R04 | PASS | HTTP flag del programma B disabilitato: richieste negate e programma A accessibile; CLI `disable` e riabilitazione controllate. |

## Interfaccia, esportazioni e calendario

| ID | Esito locale | Evidenza e limite |
| --- | --- | --- |
| U01 | PASS | BROWSER desktop e mobile 360×800 senza overflow; dopo ingresso nell'attività, caso completo con Tab/Freccia/Spazio/Invio e digitazione: sei gruppi radio, riepilogo, ritorno, consegna decisioni, riflessione, modalità senza AI e feedback 1/6. Focus verificato sulle intestazioni della fase corretta; screenshot keyboard-feedback.jpg. Il FAIL iniziale del focus sul body è stato corretto e la sequenza ripetuta. Nessuna attestazione screen reader. |
| U02 | BLOCKED | BROWSER invio incompleto: riepilogo errori con focus e collegamenti verificato; aria-live e testo non affidato al colore presenti. Sessione completa con screen reader/errore di rete non eseguita. |
| U03 | PASS | BROWSER riflessione contenente un tag script resa letteralmente nel learner e nel dettaglio formatore, senza esecuzione; UNIT input preservato come stringa. Variante del nome utente con script non eseguita. |
| U04 | PASS | HTTP export con grant, scope e audit; celle formula con whitespace neutralizzate; UNIT prefissi `=,+,-,@`, controlli e whitespace. Nessun URL pubblico permanente. |
| U05 | PASS | HTTP gruppo sotto soglia senza nominativi/testi; UNIT soppressione di celle complementari 6/5, 9/5, 10/5 e confini 0/tutti. Perimetro grant fisso, nessun filtro liberamente combinabile. |
| U06 | PASS | UNIT/CONTENT tutte le sei date in Europe/Rome con offset estivo/invernale, durate, date impossibili e ore DST ambigue respinte; controllo apertura lato server. |
| U07 | PASS | BROWSER sulla build finale: logout da altra scheda, errore esplicito con pagina e testo intatti e link per accedere in una nuova scheda visibile; nuovo login tramite helper emulator, retry nella pagina originale confermato. Screenshot session-recovery.jpg. Prova locale di perdita/recupero auth; non attesi 14 giorni né esercitata la UI/provider reale. |

## Operatività

| ID | Esito locale | Evidenza e limite |
| --- | --- | --- |
| O01 | PASS | LOAD del gateway JSON finale ottimizzato locale, 50 utenti/400 richieste: p95 autosave 94,8 ms <1500, submit 157,5 ms <2000, progressi 272,0 ms; 50 tentativi/50 audit, ricevute e isolamento corretti. Storico DEV resta FAIL (8007,8/6880,1 ms), distinta anche la misura Flight precedente. Solo runtime caldo locale; cold start, login provider reale e infrastruttura preview non coperti. |
| O02 | PASS | BROWSER sul gateway JSON finale: DB indisponibile al submit, stessa pagina di riepilogo con otto risposte intatte, errore esplicito e download/confronto/login disponibili; dopo ripristino, stesso invio restituisce feedback 0/8. DB: una consegna e un audit. Storico FAIL precedente conservato: le Server Actions causavano redirect al login e ritorno a pagina vuota, senza recupero attestato. HTTP prova inoltre rollback atomico su errore dell'audit e retry riuscito. |
| O03 | PASS | RETENTION/BACKUP: dry run senza mutazioni, utente vietato, programma non scaduto, eliminazione atomica del solo programma scaduto, portfolio/altro workspace preservati, retry zero. Snapshot coerente e restore verificati su tutte le 48 tabelle. Nessuna garanzia sul backup reale o sulla cancellazione delle copie esterne. |
| O04 | PASS | BROWSER finale: programma disabilitato durante l'esercizio, salvataggio negato senza lasciare la pagina o perdere la scelta; dopo riabilitazione e Back/Forward, bozza recuperata, salvataggio e reload confermati. Screenshot program-disabled-recovery.jpg. Flag globale off e build e63 sullo stesso DB preservano dati e pagine portfolio/readiness; risposte anonime della fixture vuote. Nessun cutover/deploy di produzione provato. |

## Stato di accettazione

Matrice completa: **47 righe, 43 PASS locali, 0 FAIL correnti, 4 BLOCKED**. Rimangono registrati il FAIL browser O02 precedente alla correzione, i FAIL iniziali del controllo Origin e del focus tastiera e le misure FAIL del server di sviluppo; sono affiancati dalle rispettive prove successive, senza cancellare gli esiti precedenti. Le righe ancora BLOCKED sono A01, A08, R01 e U02, con controlli parziali passati esplicitati sopra. Questa matrice non autorizza il debutto: il criterio del piano richiede tutti i P0 provati, nessun difetto critico aperto, configurazione approvata e prova generale sull'ambiente effettivamente autorizzato.

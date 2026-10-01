# Prove locali di integrazione

Esecuzione del 1 ottobre 2026 nel checkout isolato, prima del commit finale. Questi risultati devono essere associati al commit di consegna e ricontrollati dopo ulteriori modifiche. Non sono test di produzione o un'autorizzazione al rilascio.

Ambiente: Next 16.2.3, prima in sviluppo e poi build ottimizzata in modalità produzione locale, PostgreSQL 16.14 dedicato su loopback, Firebase Auth emulator 14.15.1 con progetto `demo-unbundle-learning`; nessuna credenziale reale o dipendenza LLM. Il gateway JSON reale `/api/learning` richiama le stesse azioni, validazione e DAL, verificando il cookie prodotto dal vero endpoint `POST /api/auth/session`. L'adattatore inoltra SQL e parametri al database reale locale, mantenendo vincoli, trigger e atomicità. La build finale pre-commit è passata; un tentativo nella sandbox non poteva recuperare i font pubblici ed è registrato separatamente dal retry autorizzato riuscito.

## HTTP e database: 35 PASS, 0 FAIL in produzione locale

Comando finale: `LEARNING_TEST_OUTPUT=/private/tmp/unbundle-m1-evidence LEARNING_TEST_RUNTIME=production node --no-warnings scripts/learning-test/http-acceptance.mjs`. I giri precedenti con chiamate dirette Server Actions avevano 25 PASS in sviluppo e 31 PASS in produzione locale; restano separati dal gateway usato dall'interfaccia finale.

| Prova eseguita | Esito |
| --- | --- |
| Deep link senza sessione conserva callback nel redirect login | PASS, porzione A01; login provider browser ancora separato |
| HTML/RSC prima dell'invio privi di marcatori della banca e `correct_option_ids` | PASS |
| Workspace/program estranei e identità/score/ruolo contraffatti | PASS |
| Chiamata diretta cross-origin al gateway JSON | PASS: rifiutata |
| Gateway senza sessione: JSON 401, nessun redirect e `no-store` | PASS |
| Gateway senza Origin anche con cookie valido | PASS: 403 |
| Media type, JSON malformato, operazione sconosciuta e campi extra nell'envelope | PASS: 415/400 |
| Corpo JSON oltre 64 KiB | PASS: 413 prima della lettura completa |
| Avvio autenticato, proprietario verificato, tentativo persistito | PASS |
| Altro learner dello stesso workspace non modifica né legge il tentativo | PASS |
| Due salvataggi concorrenti: uno accettato, uno conflitto esplicito | PASS |
| Nuova sessione ripristina risposte, revisione e ordine opzioni | PASS |
| Cinque submit concorrenti con stessa chiave e retry: una ricevuta, un risultato 8/8, un audit verificato SQL | PASS |
| Tentativo inviato immutabile; recupero distinto, prima prova conservata | PASS |
| Recupero 7/8 con errore essenziale restituisce `needs_practice` e motivo | PASS |
| Prova incompleta resta draft senza risultato | PASS |
| Errore SQL nell'audit di invio: rollback di risultato/revisione, retry poi valido | PASS; non simula ogni forma di indisponibilità DB |
| Caso: sei decisioni congelate prima dell'esempio; modifica successiva negata; riflessione/modalità e invio 6/6 | PASS |
| Completare il caso non crea voci portfolio | PASS |
| Chiusura programma nega nuove scritture e conserva feedback già inviato | PASS |
| Idea volontaria, autore estraneo negato, quattro invii concorrenti/retry: una voce `source=learning`, collegamento corretto, nessun voto/risposta privata | PASS senza chiavi LLM |
| Reviewer limitato alla coorte assegnata e negato nell'altro workspace | PASS |
| Sponsor e manager senza review grant non leggono risultati nominativi | PASS |
| Export con grant distinto/audit, dati nel perimetro e formula con whitespace neutralizzata | PASS |
| Aggregato piccolo soppresso, senza nomi o testi liberi | PASS |
| Account iscritto a due workspace mantiene programmi/progressi distinti | PASS |
| Revoca membership efficace alla prossima chiamata | PASS |
| Flag del programma disabilitato blocca le scritture e non interrompe l'altro workspace | PASS |
| URL nominativo del formatore nega l'altra coorte e workspace; CSV esclude l'altra coorte e nega il workspace estraneo | PASS |
| Membership learner revocata nega lettura ricevuta e salvataggio della bozza | PASS |
| Membership reviewer revocata nega lista ed export, anche con grant ancora presente | PASS |
| Nuova versione pubblicata durante una bozza con due scelte salvate: risposte, revisione, ordine e contenuto precedenti invariati; versione attesa errata dà conflitto | PASS |
| Finestra futura: server nega avvio e salvataggio; timestamp client contraffatto rifiutato | PASS |
| Programma archiviato: scritture negate, feedback già inviato leggibile | PASS |

I test combinati condividono alcuni ID del piano: il totale 35 indica asserzioni di integrazione registrate, non 35 intere righe P0 dimostrate in ogni variante. Il [risultato JSON finale](results/http-acceptance-production.json) è allegato senza credenziali o contenuti del pacchetto; il log dettagliato `http-acceptance-gateway-production.log` e i risultati sviluppo/Server Actions precedenti restano fuori Git. Il primo giro con ID generici non allineati aveva un errore di fixture nella finestra attività; i programmi corretti sono stati pubblicati come una nuova versione, conservando disabilitati i precedenti. Il parser Flight del precedente harness è stato corretto per CSV lunghi. D08 precede l'invio atomico O02 affinché usi una vera bozza con due scelte, non una consegna già congelata.

Durante O02 browser, il trasporto Server Actions originale consentiva al rerender del layout di reindirizzare al login durante un guasto DB: questo è un errore reale, registrato prima della correzione con gateway JSON. Il primo test del gateway ha poi rilevato che Next normalizza l'hostname interno a `localhost`; il confronto Origin respingeva il browser legittimo su `127.0.0.1`. Il confronto ora usa Host effettivo e protocollo Next, non forwarded-host. I test origin/missing origin e l'intera suite finale 35/35 passano; il log del fallimento iniziale rimane `http-gateway-origin-failure.log`. Autenticazione, proxy e survey restano invariati. Le prove browser successive distinguono l'errore iniziale dal risultato del nuovo trasporto.

## Esposizione client: PASS

`client-scan.mjs` ha scaricato la pagina learner non ancora iniziata, il suo RSC e **23 script client della build finale realmente referenziati dall'HTML** (8 nel precedente giro sviluppo). Nessuno conteneva i sei marcatori privati della fixture o `correct_option_ids`. Evidenza: `client-scan-production.json`, distinto da `client-scan.json`. Questo attesta la proiezione delle fixture attraverso i percorsi eseguiti, non l'assenza universale di qualunque forma di fuga dati.

## Retention: 5 PASS, 0 FAIL

`retention-acceptance.mjs` esegue il CLI reale su due programmi sintetici dedicati: dry-run senza cancellazione; utente senza grant manager negato; periodo non scaduto nell'altro workspace negato; programma scaduto elimina atomicamente due tentativi (con relazione padre/recupero) e una bozza già promossa, conservando l'altro workspace e la voce portfolio; nuova esecuzione elimina zero record e conserva l'iscrizione. I conteggi audit sono verificati direttamente sul DB. Evidenza: `retention-acceptance.json`.

## Backup e ripristino: 2 PASS, 0 FAIL

`backup-restore.mjs` esporta uno snapshot PostgreSQL consistente, esegue `pg_dump`, ripristina in un database locale nuovo e confronta **48 tabelle**: conteggio e digest di ogni riga coincidono con lo stesso snapshot. I programmi, i tentativi, le ricevute, gli audit e i collegamenti portfolio sono inclusi. Dump sintetico e prove restano fuori Git; evidenza: `backup-restore.json`. Il test non copre retention dei backup o il servizio backup di produzione.

## Limiti ancora separati

Login Google/email reale, inviti reali, accessibilità completa con lettore di schermo e prova generale su anteprima autorizzata non possono essere dichiarati superati da queste prove. Le prove browser di interruzione connessione, perdita della sessione e ripresa sono descritte nel report browser; non equivalgono alla scadenza temporale reale del provider. I risultati di carico hanno un report distinto, che separa integrità e latenze: lo sviluppo non ha rispettato i target, la build ottimizzata locale sì. Nessun token/cookie è incluso nei documenti versionati; il manifesto temporaneo degli account è riservato al test locale.

## Disabilitazione e rollback effettivo: 6 PASS, 0 FAIL

La stessa build finale su porta 53103 con `LEARNING_ENABLED=false` nasconde la voce formazione, nega una vera richiesta diretta al gateway JSON con 503 e mantiene disponibili home workspace, portfolio e pagina AI Readiness. Conteggi e digest di tutte le tabelle Learning e portfolio nei due workspace sintetici, più tutte le risposte anonime del DB isolato, restano identici: [rollback-global-flag.json](results/rollback-global-flag.json), 3 PASS.

Il codice precedente **e63a2a719410af77982c85522dad6339975f869e**, costruito prima della feature e avviato separatamente su porta 53104 con lo stesso DB e schema additivo 0012 conservato, serve home, portfolio e AI Readiness; la route Learning risponde 404 e la navigazione non la presenta. Il confronto esatto degli stessi dati prima/dopo coincide: `rollback-baseline.json`, 3 PASS. Non sono stati cancellati dati o tabelle per fare funzionare il vecchio codice. Questa è una prova reale di compatibilità del rollback locale; il rollback di una distribuzione autorizzata e la risposta alla survey in produzione restano da verificare nell'ambiente reale.

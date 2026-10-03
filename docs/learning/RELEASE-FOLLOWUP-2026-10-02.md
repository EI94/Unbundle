# Aggiornamento del rilascio — 2 ottobre 2026

**Backup, ripristino isolato, CSV e ritorno al percorso dopo login email/password sono PASS nei rispettivi perimetri verificati. Il rilascio rimane condizionato ai controlli ancora aperti.** Questo aggiornamento prevale sui punti superati del [report precedente](RELEASE-HARDENING-2026-10-02.md), conservandone gli esiti storici. Non certifica prove non eseguite e non autorizza a saltare i gate del [runbook](RUNBOOK.md).

La base di prodotto è **`90787d5ecb5a3070171b217187eb01dfb3a23b31`**. La correzione successiva modifica due file per conservare la destinazione dopo il login ed è stata verificata sulla build ottimizzata **webpack `S0RWxV0r-g7InIbYPRtZP`**. Gli hash dei due file e del test ripetibile sono nella [ricevuta di build](evidence/results/release-followup-20261002/callback-fixed-build.json); la loro corrispondenza con il working tree è stata ricontrollata. La build precedente `mLKpQvP1366UJpxhqoHjS` e i suoi risultati restano distinti. **Il nuovo commit finale e l’associazione a queste prove restano da registrare**: il solo SHA di base non comprende la correzione. La ricevuta locale post-commit `../../release-followup-verification.private.json`, esclusa da Git e compilata alla chiusura, identificherà il commit effettivo, il confronto con la fonte della build e i controlli finali; non fa parte del commit che attesta.

## Backup autorizzato e ripristino

Dopo il precedente rifiuto della revisione automatica, il 2 ottobre è stato ricevuto il consenso diretto dell’utente al backup completo locale e al ripristino isolato. Il blocco di consenso è quindi risolto; il rifiuto iniziale resta nella cronologia.

Il backup ha usato una connessione TLS verificata e uno snapshot PostgreSQL esportato mantenuto in una transazione `REPEATABLE READ READ ONLY`. Sono stati rispettati il limite di attesa dei lock di 5 secondi, i timeout delle verifiche e il limite del processo di esportazione. La verifica non ha eseguito scritture sul database sorgente. L’archivio completo è leggibile da `pg_restore --list`, misura **265.169 byte** ed è identificato dalla ricevuta SHA-256; archivio e contenuti restano fuori Git, nella destinazione privata autorizzata. [Ricevuta sanificata](evidence/results/release-followup-20261002/production-backup-restore.json).

| Verifica | Esito e perimetro |
| --- | --- |
| Ripristino dell’archivio | **PASS**, nuovo PostgreSQL 17.11 locale, stessa estensione `vector` 0.8.0 compilata dal tag ufficiale. |
| Dati ripristinati | **PASS**, conteggi e digest completi delle righe coincidenti per **47/47 tabelle** dello snapshot. Nessuna riga o risposta reale pubblicata. |
| Schema confrontato | **PASS**, sette sezioni di catalogo identiche; nomi, etichette e ordine logico degli enum identici, normalizzando soltanto i numeri interni di ordinamento ricreati dal restore. |
| Migrazione 0012 sulla copia | **PASS**, applicata due volte in transazioni con timeout: sette tabelle e quattro trigger Learning, nessun dato didattico importato. Dopo ogni passaggio, schema preesistente e conteggi/digest delle 47 tabelle restano invariati. |
| Arresto e permessi locali | **PASS**, tutti e tre i cluster di ripristino arrestati; 93 directory controllate a `0700`, 4.570 file regolari a `0600`, zero anomalie e nessun file temporaneo di password residuo. |

La migrazione ha mantenuto SHA-256 `d39f2caee006ae392684110a0de169738f81e2c573a0856f00686dbee725b09f`. È stata applicata **soltanto alla copia isolata**, senza collegarvi l’applicazione o usarla per prove con account. Il database di produzione non è stato migrato. [Controlli di riservatezza](evidence/results/release-followup-20261002/production-backup-privacy.json).

Il restore locale ha escluso l’applicazione di ownership e ACL: le relative istruzioni rimangono nell’archivio, ma il recupero dei ruoli e dei privilegi **non è attestato**. Non sono attestati neppure PITR, retention o ripristino della configurazione esterna del provider. Il confronto copre le sezioni di catalogo descritte e i dati delle tabelle; non equivale a una prova completa di disaster recovery del servizio.

## Errori operativi conservati

Le verifiche non hanno cancellato i fallimenti intermedi:

- Il primo collegamento ha ricevuto `08P01`: il pooler non accettava il timeout dei lock nei parametri di avvio. Nessun archivio era stato creato. Il parametro è stato spostato in `SET LOCAL` nella transazione in sola lettura, senza indebolire TLS.
- Il primo helper di confronto conteneva una sintassi `BEGIN` non valida. Il restore era terminato, il confronto non era passato e il cluster era stato arrestato. La sintassi è stata corretta prima di ripetere la verifica.
- Il confronto iniziale degli enum comprendeva i valori numerici interni, che il restore può rinumerare. Il PASS successivo richiede gli stessi nomi, etichette e ordine; l’impronta dei metadati sorgente riletti coincideva ancora con quella dello snapshot.
- Un riavvio diagnostico ha omesso le opzioni originarie e ha brevemente usato i default locali, incluso l’ascolto TCP. La connessione al socket previsto è fallita e il cluster è stato immediatamente arrestato. Nessuna app è stata collegata dalla procedura. Per gli avvii successivi la configurazione socket privato e TCP disabilitato è stata resa persistente. Non si dichiara quindi che ogni avvio storico sia stato esclusivamente su socket.

I log integrali, gli archivi e i dati ripristinati sono privati. Le ricevute pubbliche conservano esiti, conteggi, impronte e limiti senza credenziali, percorsi dei dati privati o risposte individuali.

## CSV e osservazioni browser precedenti

Il controllo del download CSV, inizialmente **BLOCKED** per timeout dell’evento browser, è stato completato successivamente sul file effettivamente scaricato. Dimensione (**751 byte**) e SHA-256 coincidono byte per byte con l’esportazione HTTP autenticata già verificata; le quattro righe riguardano soltanto partecipante e coorte sintetici autorizzati. È una verifica del download originale, non una nuova esportazione dichiarata. [Ricevuta CSV](evidence/results/release-followup-20261002/browser-csv-file-verified.json).

Le **31 osservazioni del giro browser precedente risultano ora tutte verificate con esito positivo**, includendo i tre PASS dopo correzione già documentati. Il conteggio storico era 27 PASS, tre PASS dopo correzione e un BLOCKED; il file storico resta conservato. Questo conteggio non include le nove nuove osservazioni sul provider reale riportate sotto e non risolve le prove assistive ancora mancanti.

## Provider reale, preview e gate residui

La baseline aveva confermato l’accesso tramite provider reale email/password ma aveva prodotto un **FAIL** nel ritorno alla destinazione iniziale dopo il rifiuto server di un cookie non scaduto. Quel fallimento resta conservato. La correzione usa il controllo di sessione condiviso nel layout e un callback interno validato; non cambia la verifica delle credenziali o della sessione.

Il retest browser usa **Firebase email/password reale, due identità temporanee di test, applicazione locale e database PostgreSQL sintetico**. Dopo la revoca del token alle 13:54:26 UTC, A è stato portato al login con marker di sessione scaduta e destinazione dell’attività conservata; il nuovo accesso è tornato esattamente a quell’attività. L’interfaccia ha mostrato “Bozza caricata dal server”, con tre risposte “Not sure yet” e lo stesso ordine. Revisione e doppio clic di invio hanno mostrato il primo tentativo completato, risultato **0/3**. Dopo logout, B ha eseguito l’accesso alla pagina amministrativa richiesta; la modifica del titolo sintetico è rimasta dopo reload. La vista formatori mostrava A completato a 0/3 e B non iniziato. **Nove osservazioni browser PASS**, con hash delle tre immagini nella [ricevuta](evidence/results/release-followup-20261002/real-provider-browser-final.json); le immagini restano fuori Git.

La successiva lettura del solo database locale ha dato **10/10 PASS**: un tentativo inviato di A, tre risposte della fixture, un solo audit di invio, nessun tentativo di B, titolo persistito e un solo audit delle impostazioni attribuito a B. Proprietario e iscrizione sono conservati. La prima asserzione del controllo database usava per errore l’ID `not_sure`; la fixture pubblica usa `unsure` con etichetta “Not sure yet”. Il FAIL di harness resta conservato; la verifica è stata corretta senza cambiare prodotto o dati. [Ricevuta database sanificata](evidence/results/release-followup-20261002/browser-real-provider-database.json).

| Controllo dopo la correzione | Esito e prova |
| --- | --- |
| Build ottimizzata webpack | **PASS**, build `S0RWxV0r-g7InIbYPRtZP`, hash della fonte e del test registrati. |
| Callback HTTP | **7 PASS, 0 FAIL**; [script ripetibile](../../scripts/learning-test/auth-callback.mjs) e [ricevuta](evidence/results/release-followup-20261002/auth-callback-fixed.json). Richieste GET con cookie sintetico rifiutato: callback, marker stale, rimozione cookie e header contraffatti. Non sostituisce la prova UI del provider. |
| Review indipendente | **PASS**, controllo della fonte e della ricevuta HTTP, nessun rilievo aperto; [ricevuta](evidence/results/release-followup-20261002/callback-independent-review.json). |
| Regressioni preesistenti | **115 PASS, 0 FAIL correnti**, lint completo e TypeScript PASS; [ricevuta](evidence/results/release-followup-20261002/auth-fix-regressions.json). |

Rimangono distinti i fallimenti storici: il probe callback sulla baseline aveva **3 PASS e 4 FAIL**; due ricostruzioni **Turbopack sono fallite nel recupero di font esterni**. Il PASS della build finale riguarda webpack, senza bypass TLS, font simulati o modifica del prodotto per aggirare il problema. La prima esecuzione MCP era inoltre bloccata dal sandbox sul socket locale; la ripetizione autorizzata ha superato tutti gli 11 test. Questi errori non sono cancellati né riclassificati come build riuscite.

Le due identità temporanee usate nel provider sono state revocate ed eliminate; la rilettura ha confermato `auth/user-not-found` per entrambe. **Cleanup PASS, due su due**, senza email inviate o modifica della configurazione del provider o del database applicativo. [Ricevuta sanificata](evidence/results/release-followup-20261002/temporary-accounts-cleanup.json).

Gli URL effettivamente usati sono **locali e temporanei**, con workspace e corso sintetici. I servizi vengono arrestati alla consegna; le identità di test sono già state eliminate. Non sono indirizzi operativi per i partecipanti al training:

| Vista verificata | URL locale |
| --- | --- |
| Partecipante, checkpoint | `http://localhost:53110/dashboard/fe3d5e31-36dd-4b8f-8c91-2e96a64b6e84/learning/3b7da0a6-0b3e-420d-8147-366b0ddf9456/activities/m1-check` |
| Amministrazione | `http://localhost:53110/dashboard/fe3d5e31-36dd-4b8f-8c91-2e96a64b6e84/learning/3b7da0a6-0b3e-420d-8147-366b0ddf9456/admin` |
| Formatori | `http://localhost:53110/dashboard/fe3d5e31-36dd-4b8f-8c91-2e96a64b6e84/learning/3b7da0a6-0b3e-420d-8147-366b0ddf9456/manage` |

Il PASS ora copre login email/password e ripresa del percorso nella combinazione provider reale/app locale/database sintetico descritta. **Non prova Google OAuth, una preview remota, la produzione o la prova generale con partecipanti reali.**

È stata creata una nuova risorsa **Neon Free**, destinata a una preview separata. La creazione è confermata; **lo stato vuoto del database non è stato verificato**. L’accesso ai dati di connessione tramite Vercel si è fermato a `403 challenge_required`: occorre completare il passaggio previsto dal provider, senza aggirarlo. La risorsa non prova ancora l’isolamento o l’operatività della preview. Non sono state applicate configurazioni d’ambiente al branch, distribuzioni, merge o modifiche al database di produzione.

| Gate | Stato alla stesura |
| --- | --- |
| Backup completo autorizzato e restore isolato | **PASS**, con i limiti ACL/owner/PITR sopra indicati. |
| Callback e ritorno al percorso dopo login email/password | **PASS** sulla build webpack locale con provider reale; nove osservazioni browser e dieci controlli DB. Baseline **FAIL** conservata. |
| Google OAuth | **BLOCKED**, accesso completo e ritorno al percorso non attestati. |
| Preview remota isolata e verificata | **BLOCKED**, risorsa creata ma collegamento e database vuoto non attestati. |
| Prova generale con partecipanti non amministrativi e formatori, URL effettivi | **BLOCKED**, ancora da svolgere nel contesto autorizzato. |
| Lettore di schermo | **BLOCKED**, prova completa non attestata; i PASS di tastiera e mobile non la sostituiscono. |
| Versione finale del rilascio | **IN ATTESA** del commit finale e dell’associazione esplicita alle prove aggiornate. |
| Rilascio e verifica della produzione | **BLOCKED**, nessun merge, deploy o migrazione di produzione eseguiti; condizioni residue da completare. |

L’autorizzazione umana al rilascio è già registrata ed è condizionata al completamento dei controlli. Non viene richiesta nuovamente; i gate ancora aperti impediscono di dichiarare pronta la produzione. Il rollback applicativo resta ancorato al deploy immutabile già pubblicato e comprensivo della survey attuale, come specificato nel [runbook](RUNBOOK.md), senza sovrascrivere il database vivo della survey.

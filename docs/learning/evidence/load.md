# O01 · carico e integrità locale

**Esiti distinti: PASS sul gateway JSON finale nel runtime locale ottimizzato; FAIL di latenza storico in modalità sviluppo; anteprima reale non verificata.** I risultati locali non autorizzano il debutto e non costituiscono una misura dell’infrastruttura di produzione.

## Gateway JSON finale · PASS locale

Il 1 ottobre 2026 alle 21:23 Europe/Rome, dopo la build finale del gateway e il completamento delle prove browser con fault, la prova ha usato 50 nuovi account sintetici e un workspace temporaneo dedicato. Nessun altro test di rete/database era in corso. Le mutazioni hanno attraversato il reale endpoint `POST /api/learning`, con cookie di sessione e origine legittima `http://127.0.0.1:53100`; non sono stati usati identificatori di Server Actions o risposte simulate.

| Fase calda | Richieste confermate | p50 | p95 | Esito |
| --- | ---: | ---: | ---: | --- |
| Sessione tramite endpoint reale | 50/50 | 19,8 ms | 36,2 ms | PASS funzionale |
| Avvio tentativo | 50/50 | 90,0 ms | 101,3 ms | PASS funzionale |
| Salvataggio, tre ondate da 50 | 150/150 | 84,1 ms | **94,8 ms** | **PASS: <1500 ms** |
| Invio oggettivo | 50/50 | 150,2 ms | **157,5 ms** | **PASS: <2000 ms** |
| Dashboard progressi del partecipante | 50/50 | 267,3 ms | 272,0 ms | PASS funzionale |
| Retry dopo ricevuta simulata persa | 50/50 | 63,2 ms | 66,4 ms | PASS integrità |

**400/400 richieste confermate**. PostgreSQL verifica 50 consegne finali di 50 autori distinti, esattamente 50 audit di invio, revisione 5, risposte attese e score server 8/8. Tutti i retry restituiscono la ricevuta originale; tutte le viste progressi mostrano il tentativo del rispettivo autore. Pulizia delle sole fixture DB/Auth create dalla prova: **PASS**.

Riscaldamento separato ed escluso dai percentili: sessione 2,8 ms; pagina attività 14,6 ms; sequenza avvio/salvataggio/invio 20,2 ms; progressi 10,3 ms. Non sono misure di compilazione a freddo o cold start serverless.

Evidenze conservate prima del commit: `/private/tmp/unbundle-m1-evidence/load-json-precommit-results.json` e `load-json-precommit-run.log`; run `e852d4da-8fd8-4fd0-ace7-b432970791cc`. Il JSON registra il trasporto effettivo, SHA del checkout e hash dei sorgenti inclusi route e controllo HTTP. Questa prova precede il commit finale: il relativo rerun deve registrare lo SHA consegnato.

## Storico Server Actions, runtime locale ottimizzato · PASS

Il 1 ottobre 2026 alle 20:43 Europe/Rome, dopo la build Next di produzione e l’avvio locale con `next start`, la stessa prova ha usato 50 nuovi account sintetici e un workspace temporaneo dedicato. Nessun altro test di rete/database era in corso. Il DAL, schema, Server Actions e grader hanno gli stessi SHA-256 delle prove DEV: non sono state effettuate modifiche applicative per ottenere questo esito.

| Fase calda | Richieste confermate | p50 | p95 | Esito |
| --- | ---: | ---: | ---: | --- |
| Sessione tramite endpoint reale | 50/50 | 25,7 ms | 38,8 ms | PASS funzionale |
| Avvio tentativo | 50/50 | 283,7 ms | 285,8 ms | PASS funzionale |
| Salvataggio, tre ondate da 50 | 150/150 | 229,8 ms | **241,1 ms** | **PASS: <1500 ms** |
| Invio oggettivo | 50/50 | 268,7 ms | **271,2 ms** | **PASS: <2000 ms** |
| Dashboard progressi del partecipante | 50/50 | 249,1 ms | 251,1 ms | PASS funzionale |
| Retry dopo ricevuta simulata persa | 50/50 | 205,9 ms | 207,9 ms | PASS integrità |

**400/400 richieste confermate**. Verifica diretta PostgreSQL: 50 consegne finali, 50 autori distinti, esattamente 50 audit di invio, revisione 5, risposte attese e score server 8/8. Le ricevute dei 50 retry corrispondono alle originali. Tutte le 50 viste progressi includono il rispettivo tentativo confermato. Pulizia delle sole fixture DB/Auth di questa prova: PASS.

Riscaldamento escluso dai percentili: sessione singola 27,6 ms; pagina attività 119,3 ms; sequenza singola avvio/salvataggio/invio 65,8 ms; pagina progressi 19,5 ms. Il log `feature-build-production.log` registra separatamente la build riuscita (compilazione circa 5 s, TypeScript circa 4,4 s): questi tempi non sono latenza per utente né un cold start serverless misurato.

Evidenze storiche conservate: `/private/tmp/unbundle-m1-evidence/load-production-precommit-results.json` e `load-production-precommit-run.log`; run `b51bd81f-4a5c-4f58-ac5c-fcff373bd480`. Queste misure riguardano il precedente trasporto Server Actions, non il gateway JSON finale. La modalità DEV sotto è conservata come risultato distinto, non cancellata o riclassificata.

## Runtime di sviluppo · FAIL di latenza

Il 1 ottobre 2026, alle 20:35 Europe/Rome, è stata eseguita una seconda prova con **50 partecipanti sintetici concorrenti** su un workspace e programma temporanei indipendenti dalle altre fixture. La suite funzionale QA aveva terminato e gli altri test di rete/database erano sospesi. Applicazione Next in modalità `dev --webpack`, Firebase Auth emulator e PostgreSQL 16 locali; SQL Neon/Drizzle reale instradato esclusivamente al database isolato tramite il trasporto di test. Nessuna chiamata LLM, notifica, invito o credenziale di produzione.

| Fase calda | Richieste confermate | p50 | p95 | Obiettivo | Esito |
| --- | ---: | ---: | ---: | --- | --- |
| Sessione tramite endpoint reale | 50/50 | 95,3 ms | 160,3 ms | Nessuna soglia numerica nel piano | PASS funzionale |
| Avvio tentativo | 50/50 | 9584,6 ms | 9614,9 ms | Nessuna soglia numerica nel piano | PASS funzionale, latenza elevata |
| Salvataggio, tre ondate da 50 | 150/150 | 6854,9 ms | **8007,8 ms** | p95 <1500 ms | **FAIL** |
| Invio oggettivo | 50/50 | 6870,0 ms | **6880,1 ms** | p95 <2000 ms | **FAIL** |
| Retry dopo ricevuta simulata persa | 50/50 | 5160,4 ms | 5169,7 ms | Stessa ricevuta, nessun duplicato | PASS integrità |

Verifica diretta PostgreSQL prima della pulizia: esattamente 50 tentativi finali, 50 autori distinti, 50 eventi `attempt_submitted`, revisione 5 per ogni tentativo, tutte le risposte attese e risultato 8/8 calcolato dal server. Ogni retry ha restituito una ricevuta identica. I 350 scambi misurati sono terminati senza errori applicativi. Le fixture DB e i 50 account dell’emulatore creati da questa prova sono stati rimossi; nessun account delle altre prove è stato modificato.

Il riscaldamento è escluso dalle distribuzioni sopra: sessione singola 45,9 ms, pagina 166,5 ms, sequenza singola avvio/salvataggio/invio 218,5 ms. **La compilazione a freddo non è stata misurata**: il server condiviso aveva già compilato le route. La prima misura non va presentata come cold start.

Una prima esecuzione, parzialmente sovrapposta alla fine della suite QA, aveva già fallito: p95 salvataggio 6916,4 ms e invio 5314,3 ms, con integrità corretta. È conservata separatamente; la tabella usa la seconda prova senza quel carico concorrente. Non sono state apportate ottimizzazioni al prodotto tra le due misure. Le cause della latenza non sono state isolate e non vengono attribuite al database o a Next senza ulteriori misure.

Riproduzione dopo aver avviato l’ambiente descritto in `scripts/learning-test/README.md`:

```sh
LEARNING_TEST_OUTPUT=/private/tmp/unbundle-m1-evidence \
LEARNING_TEST_ISOLATED=true \
LEARNING_LOAD_USERS=50 \
LEARNING_LOAD_RUNTIME=production \
node --no-warnings scripts/learning-test/load.mjs
```

Per ripetere la modalità DEV, avviare il server di sviluppo e omettere `LEARNING_LOAD_RUNTIME=production`; i JSON vengono salvati con nomi distinti.

Lo script fallisce se la directory di evidenze non è temporanea o manca l’autorizzazione esplicita all’ambiente isolato. Destinazioni DB, app ed emulatore sono loopback; usa account e workspace casuali, non legge i seed cliente e non salva token/cookie nelle evidenze. Le soglie fallite producono exit code 1.

Prove locali complete: `/private/tmp/unbundle-m1-evidence/load-results.json`, `load-run.log`, `load-first-shared-results.json`, `load-first-shared-run.log`. Run ripetuta: `8f402e47-867c-4429-a1ee-41a35a992dee`. Il JSON registra SHA del checkout base, stato dirty e SHA-256 dei sorgenti effettivamente provati; il sorgente DAL aveva SHA-256 `862a330b124eebdb7d8f3a6c788d717d46b68a7398c34ff15dd5b8dec3cbba8c`. La prova precede il commit finale delle modifiche; non è ancora una verifica del commit finale.

Restano da provare: avvio a freddo nel contesto di rilascio, dashboard formatori sotto carico, browser login reale, trasporto Neon e infrastruttura dell’anteprima autorizzata. Il carico della dashboard verificato sopra riguarda la vista personale dei progressi. Nessun esito locale sostituisce la verifica delle soglie sul contesto di rilascio.

# Formazione: riuso, confini e rischi

Verifica iniziale: `e63a2a719410af77982c85522dad6339975f869e`, Next 16.2.3 e React 19.2.4. Il checkout originale contiene modifiche in corso alla survey; il lavoro Formazione parte da una copia Git isolata e non le incorpora né le modifica. La verifica del codice non attesta il commit distribuito in produzione.

## Componenti riutilizzati

| Area | Implementazione esistente | Scelta Formazione |
| --- | --- | --- |
| Identità e sessione | `src/lib/auth.ts`, Firebase Admin, tabella `users`, cookie `__session` | Riutilizzo della sessione verificata; nessun nuovo provider o account didattico parallelo |
| Ritorno dopo login | `src/proxy.ts`, `src/lib/auth/redirect-to-login.ts`, callback interna validata | Deep link sotto il dashboard esistente |
| Workspace | `src/lib/workspace-access.ts`, membership organizzativa e specifica | Membership corrente necessaria a ogni richiesta; i grant didattici restringono ulteriormente lo scopo |
| Inviti | `src/lib/actions/workspace-collaboration.ts`, token con hash, scadenza, revoca, email e limiti d'uso | Riutilizzo del processo esistente; nessuna comunicazione automatica introdotta |
| Interfaccia | Layout workspace, sidebar, topbar, componenti `src/components/ui` | Sezione Formazione nel workspace; nessuna seconda applicazione |
| Persistenza | Drizzle + Neon HTTP, PostgreSQL | Migrazione additiva dedicata applicata prima dell'attivazione; nessun aggiornamento del provider |
| Portfolio | `use_cases` e servizio portfolio esistente | Solo invio esplicito di un'idea, provenance `learning`, collegamento univoco; nessuna copia di risposte o voti |
| Test | `node --test`, lint, typecheck e build | Fixture pubbliche generiche, suite di regressione e prove SQL su PostgreSQL locale isolato |

## Autorizzazione e dati

L'accesso workspace non autorizza a leggere i risultati di altre persone. La risoluzione attuale privilegia la membership organizzativa rispetto a quella workspace: le etichette `exec_sponsor`, `function_lead` e `analyst` non attribuiscono per questo un diritto didattico nominativo. Ogni lettura, modifica, feedback, export e download deve verificare sessione, membership attuale, workspace dell'oggetto, programma, iscrizione/utente e grant/coorte pertinenti.

Le guide installate Next su sicurezza e Route Handlers richiedono controlli nel livello dati e negli endpoint: il layout non protegge da chiamate dirette alle azioni. La DAL restituisce DTO minimi. Il pacchetto privato, le chiavi, le rubriche riservate e le spiegazioni anticipatorie non devono essere passati a componenti client, HTML/RSC o asset pubblici. La risposta di un'azione server è anch'essa un payload client.

Le scritture del browser passano per `/api/learning`: il gateway JSON richiama gli stessi wrapper di validazione, sessione e DAL delle azioni, limita il corpo a 64 KiB e richiede origine esatta. Le risposte sono `no-store` e gli errori restano strutturati nella pagina corrente. Durante un guasto DB, il rerender Flight di una Server Action poteva coinvolgere il layout esistente e reindirizzare al login: separare il trasporto della scrittura preserva la bozza e il retry senza modificare autenticazione, proxy o survey.

AI Readiness resta un dominio distinto: respondent e response hanno token e identificatori propri, senza FK verso gli account. Nessun import, join o backfill Formazione collega la survey agli utenti. I percorsi pubblici esistenti `/a/[token]`, `/s/[token]`, privacy ed export restano invariati.

## Concorrenza e correzione

Il driver esistente `drizzle-orm/neon-http` non supporta `db.transaction(callback)`: l'implementazione installata lancia un errore. `db.batch` supporta transazioni non interattive. Le operazioni atomiche con dipendenze usano una singola istruzione SQL parametrizzata/CTE, vincoli DB e revisione attesa. Una consegna valida produce un solo risultato e una ricevuta ripetibile; una consegna già effettuata è immutabile. Nessuna richiesta LLM fa parte dell'apertura, del salvataggio, dell'invio o della correzione M1.

Il tentativo conserva versione, hash e ordine delle opzioni. La correttezza dipende dagli ID delle opzioni, non dalla posizione. Recupero e ripetizione creano una nuova evidenza conservando la prima; completamento, esito, presenza e confidenza restano distinti.

## Rischi individuati prima dell'implementazione

- `ensureDbSchema()` esistente esegue DDL additivo anche da query apparentemente di sola lettura, compresi oggetti readiness. La migrazione Formazione non viene aggiunta a questo percorso; i test non caricano `.env.local` o configurazioni di produzione.
- Il journal Drizzle del baseline termina a `0008`, mentre esistono anche SQL `0009`–`0011`. La procedura operativa deve specificare esattamente le migrazioni applicate: non presumere che il comando standard le abbia tutte applicate.
- L'invio portfolio web esistente tenta AI scoring e notifiche. Il percorso didattico non deve dipendere da queste operazioni per confermare una consegna o creare duplicati al retry.
- Gli inviti workspace hanno un limite massimo di 25 utilizzi e una procedura di accettazione a più query. Il limite non viene ampliato e quel flusso non è un modello per la consegna atomica.
- Il client Firebase esistente non si connette automaticamente all'Auth emulator. I test locali possono esercitare l'endpoint sessione reale con un ID token dell'emulatore, ma questo non prova da solo la UI completa Google/email in anteprima.
- I test unitari esistenti sugli inviti coprono token e lifecycle, non l'isolamento SQL o la concorrenza delle iscrizioni.

## Ambiente di verifica

La baseline è stata estratta dal commit in una directory temporanea, senza file ambiente. Le suite pure e i controlli statici sono distinti dalle prove di integrazione. L'ambiente locale usa un cluster PostgreSQL nuovo e un Firebase Auth emulator con soli utenti sintetici. Un adattatore di test esterno all'app inoltra le query Neon parametrizzate al solo database loopback autorizzato; non sostituisce SQL, autorizzazioni o risultati con mock.

Questa verifica locale non costituisce deploy, prova di accessibilità completa, prova generale con partecipanti o autorizzazione alla produzione. La matrice di accettazione deve mantenere `PASS`, `FAIL` e `BLOCKED` separati, con evidenza e commit effettivamente provato. Senza tutti i P0 dimostrati il rilascio resta no-go.

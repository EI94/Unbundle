# Verifica operativa: ciclo di vita, rollback e conservazione

Revisione del codice del 1 ottobre 2026. Nessuna azione è stata eseguita su un ambiente esterno o su dati reali. Questo documento separa le procedure disponibili dalle verifiche ancora necessarie; non è un'attestazione di rilascio.

## Comportamenti implementati

- Il flag d'ambiente `LEARNING_ENABLED=true` è necessario per usare Formazione. Ogni programma richiede anche `feature_enabled=true`; l'importazione iniziale crea il programma disabilitato.
- La chiusura del programma o della sessione impedisce nuovi tentativi e modifiche. Le evidenze già consegnate restano leggibili agli account ancora autorizzati quando i flag consentono l'accesso.
- Il pacchetto pubblicato, l'identità del tentativo, il suo ordine e una consegna definitiva sono protetti da trigger. La versione iniziale rimane consultabile quando si importa un'altra versione come nuovo programma.
- Gli aggiornamenti dello schema sono additivi e si applicano esplicitamente; la feature non esegue DDL al primo accesso dei partecipanti.
- L'importazione e gli altri comandi amministrativi sono in `scripts/learning-admin.ts`. Il comando senza `--apply` è un dry run senza accesso al database. L'applicazione richiede un database indicato separatamente, il suo identificatore esatto, l'ambiente e la conferma di autorizzazione. Le migrazioni sui dati reali richiedono approvazione del responsabile.

## Rollback applicativo proposto

1. Conservare il commit/build precedente verificato e le configurazioni precedenti in un registro privato prima dell'abilitazione.
2. Se serve bloccare soltanto nuove scritture, usare la chiusura autorizzata del programma/sessione. Non cancellare tentativi, risultati o idee per gestire un incidente.
3. Se serve disabilitare l'intera feature, impostare `LEARNING_ENABLED=false` mediante la gestione autorizzata dell'ambiente e ripristinare la build precedente. Il comando amministrativo `disable` disabilita il singolo programma; `close` mantiene invece la consultazione delle evidenze pregresse. Non confondere la chiusura con un flag disabilitato.
4. Lasciare le tabelle additive nel database. Non fare una migrazione inversa con `DROP`, reset o cancellazioni: la build precedente non deve usarle, mentre le nuove evidenze restano conservate.
5. Verificare che i link e gli invii della survey anonima, login/inviti, portfolio, MCP e Slack funzionino ancora. Verificare sul database isolato che conteggi, revisioni, risposte e legami delle idee siano identici a quelli precedenti al rollback.
6. Riabilitare soltanto dopo diagnosi e prova ripetuta del percorso. La perdita della conferma di invio richiede una verifica/idempotenza della ricevuta, mai una ricostruzione arbitraria del risultato.

Il flag globale disabilitato è stato provato su un secondo runtime locale ottimizzato: tre controlli passati su navigazione nascosta/azioni bloccate, pagine portfolio e readiness accessibili, digest training e portfolio invariati. È stata inoltre avviata realmente la build precedente `e63a2a719410af77982c85522dad6339975f869e` sullo stesso DB, conservando lo schema additivo: altri tre controlli passati su assenza della feature, disponibilità delle pagine preesistenti e identità dei dati. Nessun reset/drop o ripristino distruttivo è servito per avviare il vecchio codice. La tabella delle risposte anonime è rimasta invariata ma era vuota nella fixture; nessuna campagna reale è stata interrogata. Evidenze versionate: [flag globale](evidence/results/rollback-global-flag.json) e [build precedente](evidence/results/rollback-baseline.json), documentate in [integrazione locale](evidence/local-integration.md).

È stata poi verificata nel browser la disabilitazione del programma durante un esercizio: salvataggio negato con scelta intatta, pagina preservata e download della bozza; dopo riabilitazione e Back/Forward, recupero del tentativo esistente, salvataggio confermato e reload con la stessa risposta. Evidenza `program-disabled-recovery.jpg` e [report browser](evidence/browser.md). R03 e O04 sono passati nel perimetro locale. Queste prove non sono un cutover di distribuzione: la procedura completa resta da ripetere sull'anteprima autorizzata e poi nell'ambiente effettivo secondo l'approvazione richiesta.

## Migrazione e secondo passaggio

Applicare il file di migrazione in una singola transazione con arresto al primo errore, per evitare finestre fra rimozione e ricreazione dei trigger durante una seconda applicazione. Esempio per un database esplicitamente autorizzato:

```sh
psql "$LEARNING_MIGRATION_DATABASE_URL" --single-transaction --set ON_ERROR_STOP=1 --file drizzle/0012_learning.sql
```

L'URL resta una variabile privata dell'operatore. Non usare automaticamente `.env.local`, non stampare credenziali e non applicare questo comando alla produzione senza l'approvazione richiesta.

## Backup e ripristino: prova locale eseguita

Il test locale O03 ha usato un database isolato con due workspace sintetici. Uno snapshot PostgreSQL coerente è stato esportato con pg_dump e ripristinato in un secondo database isolato: conteggi e digest completi delle 48 tabelle pubbliche coincidono. Due controlli passati; [evidenza di integrazione](evidence/local-integration.md). Per l'ambiente effettivo occorre ripetere la procedura autorizzata, registrando conteggi e revisioni e verificando vincoli e accessi dopo il ripristino. Il backup completo contiene chiavi del pacchetto privato, informazioni sugli account e risposte: deve seguire la stessa politica di accesso e conservazione del database.

Dopo il ripristino, controllare almeno: appartenenza workspace/program/enrollment, primi e ultimi tentativi, ordini congelati, timestamp delle decisioni e consegne, revisioni, risultati ricalcolabili, grant revocati e perimetro di coorte, audit e collegamenti al portfolio. Riprovare con due account non amministrativi. Non collegare l'ambiente ripristinato a email, Slack o altri canali reali.

Nessun backup/ripristino di produzione è stato eseguito o richiesto. Il database del test locale è reale PostgreSQL, popolato esclusivamente da fixture sintetiche.

## Conservazione: procedura implementata e limiti

`retention_days` impone una configurazione esplicita e l'informativa è conservata nel programma. La chiusura registra `closed_at`; il termine usa giorni trascorsi di 24 ore da quell'istante UTC, senza cambiare durata al passaggio all'ora solare. Un programma pubblicato o privo della data di chiusura non è eliminabile. La riapertura esplicita azzera la chiusura precedente: una futura chiusura fa partire un nuovo termine.

`scripts/learning-retention.ts` è una procedura manuale, senza scheduler o collegamenti automatici alla produzione. Richiede un gestore con grant `manage` per l'intero programma e membership attuale. Il dry run legge solo metadati e conteggi nel workspace/programma dichiarato; non mostra risposte. `--apply --confirm-authorized` autorizza l'applicazione esplicita dopo revisione del dry run. La produzione richiede inoltre `--production-approved` e l'approvazione reale del responsabile, non soltanto la presenza del flag.

Esempio di verifica per ambiente isolato autorizzato, con variabili valorizzate privatamente:

```sh
node --no-warnings scripts/learning-retention.ts \
  --workspace "$LEARNING_WORKSPACE_ID" \
  --program "$LEARNING_PROGRAM_ID" \
  --actor "$LEARNING_MANAGER_USER_ID" \
  --environment preview \
  --confirm-database "$LEARNING_DATABASE_FINGERPRINT"
```

La connessione viene letta esclusivamente da `LEARNING_ADMIN_DATABASE_URL`; nessun caricamento automatico di `.env`. L'identificatore confermato deve corrispondere esattamente a `hostname[:port]/database`. Lo stesso comando con `--apply --confirm-authorized` elimina i dati solo se il programma è ancora chiuso/archiviato, scaduto e autorizzato. Il controllo viene ripetuto nella stessa istruzione atomica che elimina e registra l'audit, con lock del programma. Se il commit fallisce, eliminazione e audit vengono annullati insieme.

**Dati eliminati:** tutti i tentativi del programma (bozze, decisioni, riflessioni, risultati e ordine congelato) e tutte le bozze idea, compresi i record privati già promossi. Genitori e recuperi sono eliminati insieme. **Dati conservati:** account già esistenti, iscrizioni/assegnazioni, metadati e pacchetto privato del programma, sessioni, grant e audit minimale; le proposte già inviate volontariamente al portfolio restano soggette alla politica del portfolio. L'iscrizione conservata attesta soltanto un'assegnazione, non presenza, completamento o superamento della prova. Dopo la cancellazione non si ricostruiscono risultati o voti zero dagli oggetti mancanti.

L'audit `retention_purged` contiene soltanto numero di tentativi e bozze eliminati, durata configurata e base temporale. Un secondo passaggio non ricrea dati e registra conteggi zero. Non invoca LLM, notifiche o cancellazioni del portfolio. Non agisce su un altro programma/workspace.

**Verifica effettuata:** cinque test unitari del termine e dei casi di inammissibilità, inclusi confine esatto e cambio ora, più lint; cinque controlli di integrazione passati sul CLI reale e PostgreSQL isolato. Provati dry run senza mutazioni, grant insufficienti, programmi scaduti/non scaduti in due workspace, eliminazione di parent/retake e bozza privata, isolamento, retry con zero eliminazioni e conservazione della proposta portfolio e dell'iscrizione. Conteggi audit verificati nel DB; [evidenza locale completa](evidence/local-integration.md).

Questa procedura non elimina le copie nei backup. Prima di utilizzare dati reali devono essere concordati scopo, categorie e tempi separati di conservazione, responsabile e trattamento di backup/allegati. La prova locale di ripristino è passata; gestione, scadenza ed eliminazione delle copie nell'ambiente effettivo restano da approvare e verificare separatamente.

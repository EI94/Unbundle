# Prove di concorrenza dell’amministrazione

`admin-concurrency.mjs` verifica quattro ordinamenti concorrenti con connessioni PostgreSQL separate e attese sui lock osservate tramite `pg_stat_activity`:

1. Avvio del partecipante prima dello spostamento: l’amministratore attende il commit e lo spostamento viene negato perché esiste lavoro.
2. Spostamento prima di un avvio con la vecchia assegnazione: il partecipante attende e non viene inserito alcun tentativo nella vecchia coorte.
3. Riapertura prima della cancellazione per conservazione: la cancellazione attende, legge lo stato aggiornato e viene negata.
4. Cancellazione eleggibile prima della riapertura: viene cancellato un solo tentativo sintetico, quindi il percorso riapre conservando l’iscrizione.

Lo script compila il file corrente `src/lib/learning/admin.ts` ed esegue il suo SQL reale. Estrae dal file corrente `src/lib/learning/server.ts` l’espressione SQL di `learningWriteGuard`; un cambiamento della struttura non riconosciuto fa fallire la prova. L’adattatore di `db.batch` esegue comandi distinti nella stessa transazione PostgreSQL, come richiesto dal protocollo di blocco e dalla lettura aggiornata del secondo comando.

L’identità e la sessione sono **sintetiche**. Queste prove dimostrano la concorrenza dei comandi SQL; non sostituiscono le prove HTTP di autenticazione, autorizzazione, origine della richiesta o isolamento tra coorti. Non usano la survey né il pacchetto didattico riservato.

## Riproduzione

Prerequisiti: dipendenze del repository installate, PostgreSQL locale isolato già avviato e migrazioni del repository già applicate. Lo script non avvia servizi e non applica migrazioni. Non puntarlo a un tunnel verso ambienti condivisi. Il database deve essere dedicato alle prove sintetiche.

Dalla radice del checkout, adattare porta, utente, nome del database e cartella di evidenza alla propria installazione isolata:

```sh
LEARNING_TEST_ISOLATED=true \
LEARNING_TEST_DATABASE_URL='postgresql://learning_test@127.0.0.1:55439/unbundle_learning_test' \
LEARNING_TEST_OUTPUT='/tmp/unbundle-admin-evidence' \
node scripts/learning-test/admin-concurrency.mjs
```

Sono obbligatori il marcatore esplicito di isolamento, l’URL PostgreSQL con host letterale di loopback e una cartella di output assoluta esterna al checkout. Sono respinti URL con parametri che potrebbero alterare la destinazione. L’URL e le eventuali credenziali non sono riportati nel risultato. Le connessioni e le attese hanno un limite di tempo.

Ogni esecuzione crea UUID casuali per organizzazione, workspace, utenti, corso e iscrizione. Il cleanup elimina soltanto questi oggetti e i loro record formativi. `fixtureCleanup` deve essere `completed`; un errore di cleanup produce un codice di uscita non zero. Non usare fixture di un altro test o un account reale.

Il file `admin-concurrency.json` contiene solo risultati, numero di prove non eseguite, stato del cleanup e hash SHA-256 dei sorgenti testati. Esito completo: quattro `PASS`, `unrun: 0`, `failure: null`, `fixtureCleanup: "completed"` e codice di uscita zero. Un errore interrompe le prove successive; le prove non eseguite non devono essere conteggiate come passate. Conservare il risultato insieme al commit verificato.

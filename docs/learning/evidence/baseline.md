# Baseline di regressione

Data: 1 ottobre 2026. Commit: `e63a2a719410af77982c85522dad6339975f869e`. Esecuzione su snapshot isolato, senza `.env` o credenziali reali. Log completi locali: `/private/tmp/unbundle-m1-evidence/baseline-*.log`.

| Comando | Esito finale | Test |
| --- | --- | --- |
| `npm run test:auth` | PASS | 5/5 |
| `npm run test:workspace-collaboration` | PASS | 4/4 |
| `npm run test:ai-readiness` | PASS | 44/44 |
| `npm run test:portfolio` | PASS | 16/16 |
| `npm run test:mcp` | PASS | 11/11 |
| `npm run test:slack` | PASS | 29/29 |
| `npm run lint` | PASS | Nessun errore |
| `npm run typecheck` | PASS | Nessun errore |
| `npm run build` | BLOCKED | Turbopack rifiuta il symlink dei moduli esterno alla root del checkout temporaneo |
| `npm run build -- --webpack` | PASS | Build di produzione completata, 34 pagine statiche generate |

Totale suite finali: **109 test passati, 0 falliti**. Il primo tentativo MCP aveva 10 passati e 1 bloccato da `listen EPERM`; il riavvio con autorizzazione ad aprire una porta HTTP loopback ha superato anche l'undicesimo test. Il primo tentativo Webpack era bloccato dalla risoluzione dei font Google; il retry autorizzato a scaricare i font pubblici è riuscito. Sono stati forniti esclusivamente identificatori Firebase inventati per la compilazione, non una configurazione di produzione. Nessuna regressione applicativa è stata dedotta da questi ostacoli ambientali.

I risultati riguardano soltanto il commit baseline, non le modifiche Formazione né il checkout originale con cambiamenti survey non committati. Non provano login browser, persistenza, permessi reali di produzione o il piano P0.

La creazione di un database PostgreSQL locale vuoto, l'applicazione degli SQL `0000`–`0011` e due applicazioni consecutive di `0012_learning.sql` sono riuscite. Log: `/private/tmp/unbundle-m1-evidence/migration-results.json`. Il test copre idempotenza della migrazione sullo stato sintetico; non è una migrazione autorizzata di dati reali né una prova completa di ripristino.

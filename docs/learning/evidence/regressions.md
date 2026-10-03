# Regressioni sul nuovo codice

1 ottobre 2026, checkout isolato `codex/m1-training`, base `e63a2a719410af77982c85522dad6339975f869e`.

| Comando | Esito |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test:auth` | PASS 5/5 |
| `npm run test:workspace-collaboration` | PASS 4/4 |
| `npm run test:ai-readiness` | PASS 44/44 |
| `npm run test:portfolio` | PASS 16/16 |
| `npm run test:mcp` | PASS 11/11 |
| `npm run test:slack` | PASS 29/29 |
| `npm run test:learning` | PASS 62; 7 test DB saltati senza connessione esplicita |

Totale regressioni preesistenti: 109 test passati. I 7 test DB saltati nella suite generica non vengono contati come passati; sono eseguiti separatamente sull'ambiente isolato (vedere evidenza di integrazione). I 21 controlli sul pacchetto privato e i 35 test del correttore di riferimento sono separati dalle prove dell'applicazione.

La prima esecuzione MCP è stata bloccata dal sandbox (`listen EPERM` su loopback). Rieseguita con permesso di apertura del server HTTP sintetico: 11/11. Non è stata necessaria alcuna modifica al test o al prodotto.

Il checkout originale mantiene gli stessi 8 file modificati e 2 non tracciati relativi alla survey rilevati all'inizio. Non sono inclusi in questo branch. Questi risultati verificano la base committata più Learning; occorre ripetere le regressioni sul futuro commit che integrerà anche il lavoro survey in corso.

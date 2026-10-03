# M1: miglioramenti dell’esperienza e verifica della PR

Data: 3 ottobre 2026. Branch: `codex/m1-ux-refinements`. Base: `b768000eb862ab4615981c0f19f66064673e84b0` (main verificato prima della PR).

**Stato: PR in bozza per revisione; nessun merge o rilascio.** Le verifiche automatizzate sotto indicate passano. Le conferme native di uscita e l’autenticazione con i provider reali restano da provare manualmente. Non è una dichiarazione di assenza assoluta di difetti.

## Che cosa cambia nell’uso quotidiano

- **Partecipante:** le attività indicano quando saranno disponibili e perché non sono accessibili. Prima dell’apertura non vengono inviate le domande al browser. Una bozza già iniziata resta leggibile dopo la chiusura del turno, con salvataggio e invio disabilitati; le modifiche locali possono essere scaricate. “Controlla disponibilità” aggiorna la pagina dal server quando il formatore riapre il turno.
- **Salvataggio:** le risposte agli esercizi mantengono il salvataggio automatico esistente; le idee conservano il salvataggio manuale esplicito. Solo la conferma “Salvato” attesta la persistenza sul server. La chiusura del browser non può garantire di conservare modifiche mai confermate. Errori e conflitti mantengono il testo nella scheda e offrono una copia scaricabile.
- **Consegna e recupero:** il riepilogo rispetta la fase corrente del caso. Le decisioni si bloccano prima di mostrare l’esempio; riflessione e modalità si possono riprendere dopo un ricaricamento. Il feedback distingue completamento ed esito. Il checkpoint non promette un recupero inesistente; il caso consente di aprire un nuovo tentativo conservando quello consegnato.
- **Proposte:** dopo l’invio è disponibile “Vedi la proposta nel portfolio”. La pagina mostra una ricevuta della propria proposta formativa e lo stato di revisione, anche quando non ha ancora un punteggio per la matrice. La ricevuta non avvia valutazioni AI né espone la proposta di un altro utente tramite URL.
- **Amministratore:** avviso di modifiche non salvate, scarto esplicito, conferme con destinatario e operazione, copia del link del corso, stato degli invii e protezione da clic ripetuti. Due amministratori che modificano le stesse impostazioni non si sovrascrivono: il secondo conserva il proprio testo e riceve un conflitto. Modifiche indipendenti a turni e ruoli non generano falsi conflitti sulle impostazioni.
- **Formatori:** nomi leggibili delle attività, storico dei tentativi, distinzione tra checkpoint completato ed esito da consolidare e aggiornamento esplicito della vista. Le bozze mostrano lo stato, non le risposte; evidenze e feedback sono disponibili solo sulle consegne e nel perimetro autorizzato.
- **Telefono:** menu del workspace accessibile dalla barra superiore; il menu si chiude quando una navigazione viene accettata. Verificata larghezza 360 px senza scorrimento orizzontale nella pagina del corso.

Sono riutilizzati autenticazione, workspace, sidebar, componenti e portfolio esistenti. Nessuna nuova dipendenza, migrazione, piattaforma di form o chiamata LLM obbligatoria. La protezione delle modifiche usa un piccolo hook condiviso e i dialoghi nativi del browser. Il pulsante Indietro delle navigazioni SPA non è intercettato: non viene simulata una cronologia alternativa. Le bozze learner non confermate possono essere recuperate in memoria nella stessa scheda, ma questo non equivale a un salvataggio persistente.

## Ambiente e prove

Database PostgreSQL 16 nuovo, su loopback; Firebase Auth emulator con account sintetici; applicazione Next ottimizzata avviata con ambiente ripulito e senza file `.env`. I token dell’emulatore sono scambiati tramite il vero endpoint della sessione. Le richieste attraversano l’autorizzazione reale. L’adattatore Neon del solo harness esegue SQL e transazioni reali sul database locale; non simula risultati o punteggi.

La configurazione preview disponibile condivideva il database di produzione: il deploy automatico è disabilitato **solo per questo branch** in `vercel.json`. Main e cron restano invariati. Non sono state eseguite richieste applicative o scritture al database di produzione. I test non usano dati della survey in corso.

| Verifica | Esito | Evidenza |
| --- | --- | --- |
| Regressioni survey, autenticazione, workspace, portfolio, Slack e MCP | PASS 115/115 | Ricevuta regressions |
| Test Learning senza database | PASS 90/90 | Ricevuta learning-pure; i 7 test DB saltati in questa esecuzione sono eseguiti separatamente |
| Integrazione PostgreSQL | PASS 7/7, zero skip | Ricevuta database |
| Percorso learner HTTP | PASS 36/36 | Ricevuta learner |
| Amministrazione HTTP | PASS 40/40 | Ricevuta admin |
| Nuove valutazioni UX/autorizzazione/concorrenza | PASS 25/25 | Ricevuta UX |
| Build ottimizzata, lint e TypeScript | PASS | Ricevute con hash delle sorgenti |
| Conferme native OK/Annulla, logout con modifiche e avviso durante invio | BLOCCATO nell’automazione | Il browser mostra la conferma, ma lo strumento va in timeout nel gestirla; accettazione/annullamento non certificati |
| Google/password con provider reali e cookie su HTTPS pubblicato | BLOCCATO: manca un ambiente cloud isolato autorizzato | La sessione locale con Auth emulator non prova il login reale |
| Browser Indietro/Avanti con modifiche, perdita totale di rete e chiusura forzata | NON VERIFICATO in questa PR | Non incluso nei PASS browser riportati sotto |

Totale: **313 valutazioni automatizzate superate**, senza sommare le ripetizioni. I conteggi non includono le verifiche browser manualmente guidate né build/lint/tipi. Il trasporto Neon su cloud, Safari/Firefox e un audit completo con screen reader non sono certificati da questo ambiente.

Le nuove valutazioni comprendono due amministratori simultanei con un solo aggiornamento e un solo audit, revoca dell’iscrizione mentre il salvataggio attende un vero lock SQL, invii concorrenti con la stessa chiave, revisioni obsolete, separazione fra utenti/workspace/coorti, ricevute portfolio proprie/altrui, protezione delle risposte corrette e soppressione dei piccoli aggregati. È verificata l’invarianza di una survey anonima sintetica non vuota, senza collegarne le risposte agli account.

## Verifiche browser osservate

Le verifiche sono state effettuate su account e contenuti interamente sintetici. Sviluppo e build ottimizzata sono distinti: le prove complete iniziali sono state effettuate in sviluppo; ricevuta portfolio, riapertura della bozza, fase di riflessione, invio, recupero e vista formatori anche sulla build ottimizzata. Le ricevute indicano gli hash effettivamente provati. La build finale è `ED7ddM0_nZ4ey166viTWT`; rispetto alla precedente `RQC0HUMdQZa9oZod3o7Em` cambia solo la condizione che nasconde il riepilogo della riflessione prima della consegna delle decisioni. Questa condizione è stata verificata nel browser sulla build finale; le 101 prove HTTP sono state ripetute e superate. Il dettaglio è in [browser-checks.json](evidence/ux-20261003/browser-checks.json).

| Percorso osservato | Risultato |
| --- | --- |
| Apertura checkpoint senza risposte preselezionate; invio incompleto | PASS: errori per campo e focus sul riepilogo errori |
| Risposte, conferma del salvataggio, ricaricamento | PASS: tutte le risposte confermate ricompaiono |
| Riepilogo, invio checkpoint, feedback e progressi | PASS: consegna immutabile, titolo leggibile, nessun recupero del checkpoint |
| Idea: compilazione, salvataggio manuale, ricaricamento, invio | PASS: campi ripristinati; dopo invio sola lettura |
| Ricevuta portfolio | PASS: propria proposta visibile con stato “Dati mancanti”, prima di comparire nella matrice |
| Menu mobile e pagina corso a 360×800 | PASS: navigazione accettata chiude il menu; nessun overflow orizzontale |
| Admin: copia del link | PASS: link del corso corretto negli appunti, nessun invio email |
| Admin: modifiche simultanee in due schede | PASS: primo salvataggio accolto, secondo conflitto, testo preservato e avviso focalizzato |
| Attività futura | PASS: data/ora esplicita, nessuna domanda né comando di avvio |
| Chiusura del turno mentre la bozza è aperta | PASS: richiesta respinta, risposte locali preservate, controlli disabilitati |
| Download della bozza | PASS: il file scaricato contiene le sole risposte personali, compresa quella non confermata; nessuna soluzione |
| Riapertura del turno e “Controlla disponibilità” | PASS su build ottimizzata: controlli riabilitati, risposta salvata preservata |
| Consegna delle decisioni del caso | PASS: decisioni bloccate, esempio disponibile solo dopo la consegna |
| Riflessione senza AI, salvataggio e ricaricamento | PASS su build ottimizzata: testo e modalità ripristinati, decisioni ancora bloccate |
| Invio finale e recupero immediato | PASS su build ottimizzata: feedback, nuovo tentativo vuoto, precedente consegna preservata |
| Formatore: aggiornamento e dettaglio consegna | PASS su build ottimizzata: stato del recupero senza accesso alle risposte della bozza, dettaglio della consegna con riflessione |

Screenshot: [mobile](evidence/ux-20261003/learner-mobile.jpg), [conflitto admin](evidence/ux-20261003/admin-conflict.jpg), [attività futura](evidence/ux-20261003/future-activity.jpg), [bozza chiusa](evidence/ux-20261003/draft-read-only.jpg), [ricevuta portfolio](evidence/ux-20261003/portfolio-receipt.jpg), [formatori](evidence/ux-20261003/trainer-results.jpg), [riepilogo finale delle decisioni](evidence/ux-20261003/decisions-review.jpg).

## Errori incontrati e correzioni

La prima esecuzione del nuovo harness aveva aspettative non corrette e verifiche dipendenti in cascata: sono state corrette e le dipendenze fallite vengono ora marcate BLOCCATO. I log iniziali sono conservati fuori Git. Il lint ha rilevato un nome di variabile riservato nel solo harness, corretto prima dell’esecuzione finale.

Il browser ha rilevato una proposta inviata ma invisibile nella matrice, un testo del checkpoint che prometteva un recupero non disponibile e una label di riflessione prematura nel riepilogo delle decisioni: tutti corretti. La proposta ha ora una ricevuta dedicata; i testi seguono lo stato effettivo. Le ricevute finali non nascondono le esecuzioni precedenti fallite.

## URL verificati e riproduzione

Tutti gli URL provati appartengono a `http://127.0.0.1:53100`; non sono URL di produzione e non restano pubblicamente accessibili dopo l’arresto dei servizi.

Workspace sintetico: `2932d5eb-9d70-4eea-b7b5-5dbe2eb0d601`; programma sintetico: `f189814b-14b0-433e-8d35-f4a51cb75fbe`.

Prefisso del corso: `/dashboard/2932d5eb-9d70-4eea-b7b5-5dbe2eb0d601/learning/f189814b-14b0-433e-8d35-f4a51cb75fbe`.

- Partecipante: pagina corso, `activities/m1-check`, `activities/m1-case`, `ideas`, `progress`, pagina del nuovo tentativo di recupero.
- Amministratore: `admin`, sezioni impostazioni e turni.
- Formatore: `manage` e dettaglio della consegna del caso.
- Portfolio: pagina workspace con parametro `created` della propria proposta formativa.

Per ricreare account e URL equivalenti usare il [README dell’harness](../../scripts/learning-test/README.md). I manifest con password dell’emulatore e i seed privati restano fuori Git. Gli screenshot contengono solo dati fittizi.

## Controlli prima del merge e rollback

1. Verificare manualmente OK/Annulla su link, cambio sezione, aggiornamento e logout con una bozza modificata, sia learner sia admin; verificare anche l’avviso mentre una richiesta è in corso.
2. Verificare Indietro/Avanti, offline e chiusura scheda distinguendo risposte confermate e modifiche locali. Non promettere persistenza di ciò che il server non ha confermato.
3. Su un ambiente HTTPS con database separato, verificare Google/password esistenti, scadenza sessione, cambio account e ruoli reali. Non usare per queste prove la survey attiva o i suoi partecipanti.
4. Solo dopo la revisione decidere merge e rilascio; questa PR non li esegue.

Rollback applicativo: creare il revert del commit della PR (o del suo squash), eseguire build e smoke test sull’ambiente isolato e rilasciare la revisione approvata. Nessuna migrazione da annullare e nessuna cancellazione di tentativi, proposte o survey. Il confronto delle impostazioni usa le colonne esistenti: una vecchia scheda admin può ricevere un errore dopo il rilascio e deve essere ricaricata. Riportare il codice precedente rimuove la nuova protezione dalle sovrascritture simultanee, ma non richiede modifiche ai dati.

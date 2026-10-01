# Gestire la formazione in Unbundle

Il pannello prepara e gestisce M1 usando gli account, i workspace e l’accesso già presenti in Unbundle. Le attività non richiedono un modello AI. La survey AI Readiness rimane separata: non viene ripetuta, modificata o collegata agli account dei partecipanti.

Questa guida descrive il comportamento dell’applicazione. La disponibilità nell’ambiente reale dipende da migrazione, configurazione e rilascio autorizzati; i collegamenti sotto sono percorsi indicativi, non URL di produzione verificati. Per l’attivazione tecnica e il rollback consultare [RUNBOOK.md](RUNBOOK.md).

## Entrare nel pannello

1. Accedi normalmente a Unbundle con **Google** oppure **email e password**.
2. Apri il workspace interessato, poi **Formazione → Gestisci formazione**.
3. Apri **Gestisci** accanto al corso. Le schede sono **Corso**, **Partecipanti**, **Turni**, **Permessi**, **Registro e conservazione**.

Il catalogo di gestione è `/dashboard/WORKSPACE_UUID/learning/admin`; il singolo corso è `/dashboard/WORKSPACE_UUID/learning/PROGRAM_UUID/admin`. Il pannello rimane disponibile ai gestori anche quando il singolo corso è nascosto o chiuso. Se la formazione è disabilitata nell’intero ambiente, serve l’intervento dell’operatore responsabile della configurazione.

Gli amministratori del workspace con ruolo effettivo `exec_sponsor` o `transformation_lead` possono preparare un **nuovo** corso, anche quando il catalogo è vuoto. Se esiste un ruolo nell’organizzazione, quello prevale sul ruolo assegnato direttamente nel workspace. Per gestire un corso già esistente occorre sempre un permesso esplicito di gestione di quel corso.

Chi può gestire soltanto alcuni turni vede e modifica il proprio perimetro. Non può cambiare le impostazioni generali, rendere disponibile o chiudere l’intero corso, delegare altri gestori o cancellare dati per conservazione.

## Importare il pacchetto approvato

In **Prepara un nuovo corso**:

1. Scegli il file JSON riservato e premi **Verifica pacchetto**. Il limite della richiesta completa è 5 MB, inclusi i dati del modulo.
2. Controlla la versione, il numero di moduli, attività e domande e le date dei turni. Le date visualizzate sono nell’ora italiana, `Europe/Rome`.
3. Indica il nome del corso, l’informativa approvata visibile ai partecipanti e i giorni di conservazione dopo la chiusura.
4. Conferma versione, date e informativa, quindi premi **Importa corso**.

Il nuovo corso parte **nascosto ai partecipanti**. L’importazione assegna a chi la esegue soltanto la gestione dell’intero corso: non assegna automaticamente il diritto di leggere risultati individuali, vedere aggregati o scaricare esportazioni.

Il server valida il pacchetto e restituisce un riepilogo senza risposte corrette, feedback riservati, esempi di riferimento o domande. Il file scelto resta temporaneamente nella memoria della scheda dell’operatore finché l’importazione non termina; non viene salvato dall’app in memoria locale persistente. Il contenuto importato è conservato nel database lato server. Non copiarlo nel repository, nella cartella pubblica, in screenshot o in allegati condivisi.

La versione pubblicata è immutabile. Reimportare la stessa versione con lo stesso contenuto non crea duplicati, se il gestore ha accesso all’intero corso già esistente. La stessa versione con contenuto diverso viene respinta: occorre una nuova versione e un nuovo corso. I tentativi precedenti restano collegati al contenuto originale.

## Invitare persone e assegnare M1

**Invito al workspace** e **assegnazione al corso** sono due operazioni distinte.

- Per una persona nuova, usa **Membri e inviti del workspace**, con le autorizzazioni e il flusso già esistenti. Attendi che la persona acceda e accetti l’invito.
- In **Partecipanti**, cerca tra i membri disponibili, seleziona fino a 100 persone e scegli una replica M1. Premi **Assegna alle persone selezionate**.
- L’assegnazione non invia email, non crea account e non modifica i ruoli del workspace. La persona trova il corso quando questo è reso disponibile.

Ogni persona ha un solo turno M1 per corso. La ricerca non elimina le selezioni già effettuate: il contatore comprende anche persone fuori dal filtro corrente. La richiesta è applicata per intero oppure respinta; non vengono assegnati soltanto alcuni destinatari di un elenco non valido.

Si può cambiare turno solo **prima di qualsiasi lavoro**: anche un tentativo appena aperto o una bozza di idea impedisce lo spostamento. L’app controlla nuovamente questa condizione sul server, anche quando un partecipante sta aprendo un’attività contemporaneamente.

**Sospendi assegnazione** revoca l’accesso al percorso senza cancellare i progressi. **Riattiva assegnazione** li rende nuovamente accessibili, se la persona è ancora membro del workspace. Un gestore limitato non può spostare una persona da o verso turni esterni al proprio perimetro; l’elenco dei membri disponibili omette le persone già assegnate ad altre coorti del corso.

## Autorizzare gestori e formatori

In **Permessi**, scegli una persona già membro del workspace, il permesso e i turni, poi conferma l’autorizzazione.

| Permesso nell’interfaccia | Accesso concesso |
| --- | --- |
| Gestire il corso | Iscrizioni, apertura dei turni e deleghe consentite dal perimetro. Impostazioni generali e conservazione richiedono gestione dell’intero corso. |
| Leggere consegne e risultati individuali | Vista formatori e consegne già inviate dei turni autorizzati. Le bozze personali non sono esposte. |
| Vedere i risultati di gruppo | Aggregati nei turni autorizzati, con soglia minima e soppressione dei gruppi piccoli. |
| Scaricare i risultati individuali | Esportazione nominativa autorizzata e registrata nell’audit. |

I quattro permessi sono indipendenti. Essere amministratore del workspace, gestore del corso o formatore non assegna automaticamente gli altri permessi. Un gestore limitato può concedere e revocare lettura, aggregati ed esportazione soltanto nei propri turni; non può concedere gestione o accesso all’intero corso.

**Revoca permesso** interrompe quell’accesso lasciando attivi gli eventuali altri permessi. Il pannello impedisce di revocare l’ultimo gestore dell’intero corso che sia ancora membro del workspace, anche con richieste concorrenti. Prima di rimuovere un membro attraverso le impostazioni generali del workspace, verificare separatamente che resti un altro gestore del corso: la gestione dei membri è un flusso distinto. Un corso rimasto senza gestori richiede un intervento autorizzato dell’operatore; il ruolo amministrativo del workspace non aggira questo controllo.

## Rendere disponibile il corso e aprire i turni

In **Corso**, dopo aver verificato iscrizioni e permessi, scegli **Rendi disponibile il corso**. Verifica quindi il percorso con un account di prova assegnato: il pannello amministrativo non cambia il ruolo dell’utente e non impersona un partecipante.

In **Turni**, M1 offre tre stati:

| Stato | Effetto |
| --- | --- |
| Apertura secondo il programma | Checkpoint a +30 minuti, caso a +78, verifica finale e recupero a +105 dall’inizio del turno. |
| Tutte le attività aperte | Apertura manuale anticipata, utile per una prova o per una decisione del formatore. |
| Nuove risposte sospese | Blocca ulteriori salvataggi e invii del turno; conserva quanto già confermato. |

Le attività richiedono anche un corso visibile e aperto. L’ora del browser non decide l’accesso. La fine dell’incontro non è una scadenza automatica: il lavoro può proseguire per il recupero. M2 e M3 sono mostrati nel calendario ma non sono resi operativi da questo pannello M1.

Le azioni sul corso hanno effetti diversi:

- **Nascondi corso** interrompe la visibilità e l’uso del corso per i partecipanti; non cancella dati.
- **Chiudi corso** blocca nuove risposte e avvia il periodo di conservazione. Le consegne restano consultabili se il corso rimane visibile.
- **Riapri corso** consente nuovamente le risposte secondo visibilità e stato dei turni. La prossima chiusura avvia un nuovo periodo di conservazione.

Rendere nuovamente visibile un corso chiuso non lo riapre automaticamente. Riaprire un corso nascosto non lo rende automaticamente visibile.

## Registro e cancellazione a scadenza

**Registro e conservazione** mostra le ultime 100 operazioni amministrative nel perimetro autorizzato. Il registro non restituisce risposte, voti o una cronologia nominativa delle attività didattiche.

Il gestore dell’intero corso vede il numero di tentativi e schede idea conservati e la data dalla quale è consentita la cancellazione. La scadenza usa periodi trascorsi di 24 ore dalla chiusura registrata sul server, non il giorno indicato dall’orologio locale.

La cancellazione è disponibile solo per un corso chiuso o archiviato il cui periodo di conservazione è trascorso. Per applicarla occorre riscrivere il titolo esatto e confermare la cancellazione definitiva. Il server ricontrolla titolo, corso, permessi, chiusura e scadenza nell’operazione di cancellazione.

Vengono eliminati i tentativi con risposte e feedback e le schede idea formative. Restano programma, contenuti, sessioni, iscrizioni, permessi, audit e **proposte già inviate al portfolio**. La cancellazione non è un rollback e non è reversibile dall’interfaccia. Non agisce sulle risposte alla survey. La procedura CLI alternativa resta documentata in [operations-review.md](operations-review.md).

## Quando una modifica non è confermata

Una conferma viene mostrata solo dopo la risposta del server. In caso di errore di rete, usa **Aggiorna riepilogo** prima di ripetere operazioni amministrative; non presumere che il server non abbia ricevuto la richiesta. L’importazione identica e l’assegnazione allo stesso turno non creano duplicati. Una revoca già applicata può essere mostrata come conflitto al secondo tentativo: il riepilogo permette di verificarne lo stato effettivo.

Per un problema generale, un gestore può nascondere il singolo corso. L’operatore può disabilitare la formazione nell’ambiente e ripristinare il codice precedente secondo il runbook. Non ripristinare un database vivo della survey per annullare una modifica alla formazione.

## Architettura e controlli per chi mantiene l’applicazione

Le pagine iniziali usano DTO amministrativi dedicati; le operazioni successive passano per `POST /api/learning/admin`, separato dal rendering del dashboard. La sessione Firebase e l’accesso al workspace sono quelli esistenti. L’endpoint accetta solo JSON, verifica esattamente l’origine rispetto all’host e protocollo effettivi, limita il corpo in streaming a 5.000.000 byte e risponde senza cache o redirect. Operazioni e input seguono uno schema discriminato rigoroso; non sono accettati campi liberi per ruoli, contenuti immutabili o selettori di cancellazione globale.

Il ruolo effettivo dell’organizzazione prevale su quello diretto nel workspace. Il bootstrap importa un nuovo corso solo con ruolo amministrativo effettivo; ogni corso esistente richiede `manage` esplicito e membership corrente. Ogni modifica ricontrolla questi vincoli nello statement SQL che scrive e registra l’audit.

Le modifiche sono eseguite in un batch transazionale Neon HTTP: prima il lock del corso, poi modifica e audit atomici con uno snapshot aggiornato. L’importazione serializza invece il bootstrap sul workspace. I salvataggi e gli avvii dei partecipanti prendono lock condivisi su corso, iscrizione e sessione e verificano ancora la coorte del contesto: chiusura, riapertura, cambio turno e cancellazione non possono scavalcare un lavoro concorrente. La protezione riguarda i percorsi applicativi verificati; operazioni privilegiate esterne richiedono il runbook e le rispettive verifiche.

Nessuna DDL viene eseguita dall’endpoint. Non vengono scritti o letti dati della survey. I DTO di gestione includono soltanto metadati, contatti necessari, stato delle assegnazioni, permessi, eventi amministrativi e conteggi di conservazione; il flag “attività già iniziata” serve a impedire spostamenti non consentiti. Pack, chiavi corrette, risposte individuali, risultati e bozze non vengono restituiti dal pannello amministrativo.

# Prova browser locale — 1 ottobre 2026

Ambiente: app reale Next su `http://127.0.0.1:53100`, PostgreSQL nuovo su loopback, Firebase Auth emulator. Solo account e contenuti sintetici pubblicabili. Il servizio locale di accesso `http://127.0.0.1:53102/as/learner-a` ottiene un ID token dall'emulatore e usa l'endpoint **esistente** `/api/auth/session`: sessione e autorizzazioni reali, senza modifica del codice auth. Non è una prova della UI Google/email, né un URL distribuibile ai partecipanti.

## Percorso osservato

1. Account non amministrativo `learner-a`: apertura del programma assegnato, informativa, referente, replica assegnata, materiale introduttivo non valutativo e attività M1. M2/M3 risultano future.
2. Caso: sei scelte senza preselezione; salvataggio con conferma; ricaricamento con risposte e ordine conservati. Nessun esempio corretto prima della consegna delle decisioni.
3. Riepilogo e consegna delle decisioni: le sei scelte diventano non modificabili; compare l'esempio preparato e si aprono riflessione e modalità.
4. Invio incompleto: riepilogo errori esplicito, con focus e collegamenti ai campi. Riflessione sintetica contenente `<script>alert('test')</script>` resa letteralmente, senza esecuzione, anche nella vista formatore.
5. Modalità “Analisi dell’esempio preparato, senza chiamate AI”, salvataggio, riepilogo e invio definitivo: feedback `0/6`, `Da consolidare`, punto essenziale segnalato. Nessuna credenziale LLM configurata.
6. Quiz A: otto “Not sure yet”, salvataggio e consegna: `0/8`, due punti essenziali. Recupero B aperto dal pulsante; nuova consegna `2/8`, tentativo 2. Cronologia conserva caso, A e B. La UI distingue `2/2` attività consegnate dall'esito `Da consolidare`.
7. Account fittizio `reviewer-a`: vista limitata ai due iscritti della coorte autorizzata; consegne, primo tentativo e recupero separati; riflessione leggibile solo nel dettaglio consegnato; nessuna bozza individuale esposta.
8. Idea facoltativa: bozza non salvata conservata dopo Back/Forward nella stessa scheda; messaggio “Modifiche non confermate recuperate”. Il tasto Tab passa dal titolo al campo problema. Questa prova non simula una risposta HTTP ritardata dopo smontaggio/remount.
9. Viewport 360×800: caso e feedback senza overflow orizzontale (larghezza documento e viewport entrambe 360). Viewport 1280×900: progressi e formatori leggibili. Override rimosso al termine.

## Interruzione e sessione, runtime ottimizzato

Ripetizione sul server `next start` dopo build di produzione locale:

- Checkpoint aperto; arresto effettivo del solo processo app; tre risposte compilate mentre il server è irraggiungibile. L'autosave e il retry mostrano “Conferma del salvataggio non ricevuta”, preservano tutte le scelte e offrono download della bozza. Nessun falso messaggio “Salvato”. Dopo riavvio dello stesso server, il retry nella medesima pagina conferma il salvataggio. Questa è una prova di indisponibilità del server, non una commutazione di `navigator.onLine`.
- Logout reale dal menu Unbundle in una seconda scheda; modifica di una risposta nella prima; richiesta rifiutata e bozza conservata nella pagina. Il proxy esistente produce una risposta login che il client classifica come errore tecnico. Nuovo accesso sintetico nella seconda scheda e retry nella prima: la stessa bozza viene salvata. Nessuna modifica al proxy o all'autenticazione. La UI è stata completata mostrando il link per accedere in una nuova scheda anche su questo errore tecnico.
- Ripetizione sulla build finale alle 20:52 Europe/Rome: link di riaccesso esplicito visibile, scelta non confermata intatta, nuovo accesso nella seconda scheda e “Salvato” confermato nella prima. La patch del messaggio è quindi verificata nel browser.

Queste prove non simulano il decorso naturale dei 14 giorni o il login presso il provider reale. Non hanno usato account di partecipanti.

## URL effettivamente verificati

Prefisso locale del programma:

`http://127.0.0.1:53100/dashboard/2ec3c82f-14ac-4ae9-833e-f6f9b50941fd/learning/4dd09ed5-1f43-4366-bebe-19a0f0dd54ec`

Con sessione learner verificati: prefisso, `/activities/m1-case`, `/activities/m1-exit-a`, `/attempts/8fbd66e8-c3ba-4f00-bd45-a8a6a4c43d19`, `/progress`, `/ideas`. Con reviewer verificati: `/manage`, `/manage/794a0a19-a79d-4a88-956d-2a0d720a45ae`.

Gli ID si riferiscono esclusivamente alle fixture locali e non vanno usati nei deck. Le date della fixture generica non attestano l'orario del pacchetto reale: il contenuto privato e le sue date sono validati separatamente in `content.md`.

## Evidenze e limiti

- `screenshots/learner-case-mobile.jpg`: caso consegnato, feedback in viewport mobile; acquisizione precedente all'aggiunta della lettura della propria riflessione post-invio.
- `screenshots/learner-progress-desktop.jpg`: primo tentativo e recupero conservati.
- `screenshots/trainer-desktop.jpg`: vista riservata e coorte autorizzata, soli nomi fittizi.
- `screenshots/connection-recovery.jpg`: scelte conservate e nessuna conferma di salvataggio durante l'interruzione del server.
- `screenshots/session-recovery.jpg`: link di riaccesso e risposte conservate sulla build finale dopo logout da un'altra scheda.

Non provati: login UI/provider reali, due persone effettive senza aiuto, dispositivo mobile fisico, lettore di schermo, modalità offline del browser, scadenza naturale della sessione, QR/deck e URL distribuiti. Le prove HTTP, SQL e unità non sostituiscono questi scenari.

## Correzione e verifica finale del trasporto JSON

Durante una prima simulazione di database indisponibile con Server Actions, l'applicazione ha rimandato al login e il ritorno alla pagina ha mostrato una pagina vuota: **FAIL storico O02**, non una ripresa riuscita. È stato isolato il trasporto delle sole mutazioni Learning in `POST /api/learning`, riusando le medesime validazioni, autenticazione e autorizzazioni. Nessuna modifica al layout auth condiviso o alla survey. Le risposte JSON non provocano il render del layout durante un errore; Origin esatto, corpo limitato, no-store e risposte senza redirect sono verificati separatamente.

Ripetizione il 1 ottobre, dopo build ottimizzata:

- **O02 PASS locale sul codice corretto:** learner-a2 salva otto risposte e apre il riepilogo. Con trasporto database realmente indisponibile, l'invio mostra l'errore nella stessa pagina, conserva le otto scelte e offre download, confronto e riaccesso. Rimosso il guasto, il retry mostra ricevuta e feedback 0/8. La lettura diretta DB conferma esattamente una consegna e un audit. `screenshots/database-recovery.jpg` documenta lo stato di errore senza perdita della pagina.
- **D04 PASS locale sul nuovo trasporto:** il salvataggio di option1 sul checkpoint viene realmente committato; la risposta è trattenuta per 10 secondi, dalle 19:19:44.838Z alle 19:19:54.839Z. Durante l'attesa, Back/Forward e nuova scelta option3; dopo la vecchia conferma, un altro Back/Forward mantiene option3. Il conflitto di revisione è esplicito, impedisce la sovrascrittura e offre il download della bozza. `screenshots/delayed-ack-recovery.jpg` mostra la nuova scelta conservata. L'iniettore è solo locale, monouso, e il controllo è stato rimosso.

Le attese fallite di un selettore di test non sono conteggiate come esiti del prodotto: il risultato dell'invio è stato letto dallo stato visibile effettivo. Il feedback usa testo, non un heading con il nome inizialmente atteso dall'automazione.

- **O04 PASS locale:** con un caso appena iniziato, il flag del solo programma sintetico viene spento. Salvataggio negato nella stessa pagina, scelta preservata e download disponibile. Dopo riattivazione, Back/Forward mostra il pulsante iniziale dalla cache di navigazione; l'avvio riconcilia il tentativo esistente e recupera la scelta non confermata. Il salvataggio riesce e un reload mostra la stessa scelta dal server. `screenshots/program-disabled-recovery.jpg` documenta il diniego senza perdita. La prova globale e il rollback applicativo con digest separati sono riportati nell'integrazione.

## Tastiera sulla build finale

La prima prova ha rilevato perdita del focus sul body dopo “Rivedi e invia”. Corretto il passaggio di focus solo sui cambi di fase, senza interrompere mount o autosave e conservando la priorità del riepilogo errori. Dopo ricompilazione, il caso del learner-a2 è stato completato usando Tab, frecce, spazio, Invio e digitazione: sei gruppi radio, riepilogo, ritorno alle risposte, consegna delle decisioni, riflessione e modalità senza AI, invio finale. Focus osservato sui titoli “Riepilogo prima dell’invio”, “Le tue risposte”, “Confronto e riflessione” e “Feedback: Da consolidare”. Ricevuta finale 1/6 e riflessione conservata. Screenshot `screenshots/keyboard-feedback.jpg`.

**U01 PASS nel perimetro locale:** queste prove di tastiera, insieme alle viste desktop e mobile 360px già documentate, coprono il criterio del piano. Nessuna attestazione di lettore di schermo: U02 resta BLOCKED. Il login/provider continua a essere separato dalla navigazione da tastiera nell'attività.

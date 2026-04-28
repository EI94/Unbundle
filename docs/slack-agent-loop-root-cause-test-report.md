# Slack Agent Loop Root Cause & Reliability Test Report

Data: 2026-04-28

## Root cause

Il loop visto da Luca Baldessarini era causato dalla chiave conversazionale Slack.

Prima del fix, quando un utente scriveva in DM o in canale senza usare un thread Slack esplicito, il bot usava:

```ts
raw.thread_ts ?? raw.ts
```

In Slack ogni messaggio non-thread ha un `ts` diverso. Quindi ogni risposta dell'utente veniva interpretata come una nuova conversazione e `getOrCreateDraft` creava un nuovo draft. Il bot perdeva `contributionKind` e ripartiva con la domanda iniziale.

## Evidenza DB su NATIVA

Workspace: `54d65ec8-1969-4917-9260-7e58a7206585`

Stesso utente Slack, stesso team, stesso canale DM, piu draft aperti a pochi secondi di distanza:

| draft | root ts | kind | title | progress |
|---|---:|---|---|---|
| `596caa1a` | `1777384591.933679` | `null` | `null` | no |
| `f56ff772` | `1777384583.961489` | `use_case_ai` | `null` | yes |
| `2243afea` | `1777384569.287149` | `null` | `null` | no |
| `595906fb` | `1777384538.981859` | `use_case_ai` | `null` | yes |
| `76174275` | `1777384194.889059` | `null` | `null` | no |
| `a1de9c1c` | `1777384186.926139` | `null` | `null` | no |

Dopo il fix, per quella stessa situazione il sistema preferisce il draft con progresso reale: `f56ff772`, root `1777384583.961489`, kind `use_case_ai`. Quindi la risposta successiva viene salvata come titolo invece di far ripartire il flusso.

## Fix implementato

1. Se Slack manda `thread_ts`, continuiamo a usare quello: i thread espliciti restano invariati.
2. Se Slack non manda `thread_ts`, cerchiamo un draft `drafting` recente nello stesso `workspace + slackUserId + slackTeamId + slackChannelId`.
3. Se ci sono piu draft aperti, preferiamo quello con progresso reale (`contributionKind`, titolo o altri campi gia valorizzati) invece dell'ultimo draft vuoto generato dal loop.
4. Se non esiste un draft attivo, usiamo il `ts` del messaggio corrente come nuova radice.
5. Ho aggiunto validazioni leggere per evitare salti di campo: risposte come `tutta nativa` non vengono accettate come `controllo umano` di uno use case AI; divagazioni tipo `che tempo fa oggi?` o `bella la piattaforma` non vengono salvate come problema/processo.
6. L'impatto ESG `nessuno` / `neutro` resta accettato: non obblighiamo l'utente a inventarsi un impatto.

## Conversazioni testate

Le 20 conversazioni sotto sono state codificate nella suite `test:slack`. Ogni conversazione verifica che, dopo il routing, il bot non torni mai alla domanda iniziale e non salti campo se la risposta e fuori contesto.

### 1. Slack DM, use case NATIVA non-account: project tracking

Unbundle: domanda routing.
Utente: Idea per migliorare processo.
Unbundle: raccogliamo use case AI; chiede titolo.
Utente: Automated project tracking.
Unbundle: chiede situazione attuale.
Utente: Oggi i PM aggiornano manualmente avanzamento, rischi e prossimi step in fogli e messaggi sparsi.
Unbundle: chiede flusso con AI.
Utente: L'AI legge note meeting, task e ticket, genera una dashboard aggiornata e notifica gli owner sui blocchi.
Unbundle: chiede controllo umano.
Utente: Il project owner controlla e approva aggiornamenti critici prima che siano condivisi al cliente.
Unbundle: chiede guardrail.
Utente: Non deve cambiare budget, date o responsabilita senza approvazione umana esplicita.
Unbundle: chiede impatto atteso.
Utente: Risparmia circa 3 ore a settimana e migliora qualita e tempestivita degli aggiornamenti.
Unbundle: chiede dati necessari.
Utente: Servono accesso a Jira, note meeting, lista owner e template del report di progetto.
Unbundle: chiede urgenza.
Utente: Quick win se partiamo con un team pilota, poi estensione in 3 mesi.
Unbundle: chiede impatto ambientale e sociale.
Utente: Riduce riunioni di allineamento e stress operativo, impatto ambientale indiretto basso.
Risultato: completata senza loop.

### 2. Slack channel mention, use case: titolo naturale

Unbundle: domanda routing.
Utente: voglio segnalare un'idea.
Unbundle: raccogliamo use case AI; chiede titolo.
Utente: La chiamerei Automated project tracking.
Unbundle: chiede situazione attuale.
Utente: Oggi il processo di tracking progetti dipende da aggiornamenti manuali e spesso incompleti.
Unbundle: chiede flusso con AI.
Utente: Un agent AI analizza documenti, ticket e meeting notes e genera lo stato progetto con alert.
Unbundle: chiede controllo umano.
Utente: Il responsabile delivery revisiona e approva lo stato prima dell'invio.
Unbundle: chiede guardrail.
Utente: Il sistema deve evitare modifiche automatiche a scope, budget e responsabilita.
Unbundle: chiede impatto atteso.
Utente: Migliora qualita del reporting e riduce almeno 2 ore per progetto ogni settimana.
Unbundle: chiede dati necessari.
Utente: Servono dati da project board, documenti di progetto, accessi e template reporting.
Unbundle: chiede urgenza.
Utente: Quick win per un pilota di 4 settimane.
Unbundle: chiede impatto ambientale e sociale.
Utente: Impatto sociale positivo per meno lavoro ripetitivo; ambientale neutro.
Risultato: completata senza loop.

### 3. Slack use case: beneficiario dato al posto del controllo umano

Unbundle: chiede controllo umano.
Utente: tutta nativa.
Unbundle: rifiuta la risposta e spiega che qui serve chi revisiona/approva/valida.
Utente: Il responsabile commerciale rilegge, corregge e approva la proposta prima dell'invio.
Risultato: il campo giusto viene salvato solo dopo risposta coerente.

### 4. Slack use case: dati necessari sconosciuti poi recuperati

Unbundle: chiede dati necessari.
Utente: boh.
Unbundle: chiede un dettaglio concreto sui dati/documenti/accessi.
Utente: Servono ticket storici, tassonomie, accessi helpdesk e policy privacy.
Risultato: nessun salto campo.

### 5. Slack use case: titolo troppo corto poi valido

Unbundle: chiede titolo.
Utente: AI.
Unbundle: chiede titolo piu esplicito.
Utente: Analisi ticket clienti.
Risultato: titolo valido, poi prosegue al problema.

### 6. Slack use case: divagazione sul problema poi risposta valida

Unbundle: chiede situazione attuale.
Utente: bella la piattaforma comunque.
Unbundle: riconosce risposta fuori contesto e ripete la stessa domanda.
Utente: Oggi dopo le riunioni il team scrive manualmente follow up, owner e decisioni.
Risultato: nessuna allucinazione, nessun salvataggio sbagliato.

### 7. Slack use case: guardrail troppo corto poi concreto

Unbundle: chiede guardrail.
Utente: privacy.
Unbundle: chiede almeno un guardrail concreto.
Utente: Non deve dare consulenza legale, usare dati personali o rispondere senza fonte.
Risultato: campo salvato solo quando operativo.

### 8. Slack use case: problema troppo generico poi valido

Unbundle: chiede situazione attuale.
Utente: si perde tempo.
Unbundle: chiede processo/frizione/team coinvolti.
Utente: Oggi finance controlla manualmente fatture e anomalie confrontando email, ordini e fogli.
Risultato: prosegue correttamente.

### 9. Slack best practice: beneficiario tutta organizzazione

Unbundle: domanda routing.
Utente: abbiamo gia migliorato questo processo con l'AI.
Unbundle: raccogliamo best practice; chiede titolo.
Utente: Brainstorming proposte tailor made.
Unbundle: chiede processo prima dell'AI.
Utente: Prima le proposte erano molto standardizzate e richiedevano molte iterazioni manuali.
Unbundle: chiede processo con AI.
Utente: L'AI legge meeting notes e materiali cliente, genera idee e struttura una proposta personalizzata.
Unbundle: chiede risultato.
Utente: Migliora qualita dell'output e aumenta personalizzazione delle proposte per i clienti.
Unbundle: chiede beneficiari.
Utente: tutta nativa.
Unbundle: non chiede "altri team"; chiede cosa serve per replicarla bene in tutta l'organizzazione.
Utente: Per replicarla servono template proposta, meeting notes, casi studio e una skill AI condivisa.
Unbundle: chiede ESG.
Utente: Impatto sociale neutro, con attenzione a non ridurre troppo il contributo creativo umano.
Risultato: completata senza campo sbagliato "controllo umano".

### 10. Slack best practice: requisiti invalidi poi validi

Unbundle: chiede cosa serve per replicarla.
Utente: tutta nativa.
Unbundle: rifiuta perche non e un requisito operativo.
Utente: Servono transcript, template sintesi, owner del workshop e regole privacy.
Risultato: completata.

### 11. Slack best practice ESG neutro

Unbundle: chiede impatto ambientale e sociale.
Utente: Impatto ambientale neutro, sociale positivo per accesso piu equo alla conoscenza.
Risultato: accettata.

### 12. Slack best practice, dipendente senza account Unbundle nel workspace aziendale

Unbundle: domanda routing.
Utente: abbiamo gia usato AI per migliorare un processo.
Unbundle: raccogliamo best practice; chiede titolo.
Utente: Internal FAQ assistant.
Unbundle: chiede prima.
Utente: Prima le persone chiedevano informazioni ripetitive su Slack e il team operations rispondeva manualmente.
Unbundle: chiede adesso.
Utente: L'AI cerca nelle FAQ approvate e risponde con fonte, riducendo domande ripetitive.
Unbundle: chiede risultato.
Utente: Risparmia tempo operativo e migliora qualita e velocita delle risposte interne.
Unbundle: chiede beneficiari.
Utente: Tutta l'azienda puo usarla per trovare informazioni operative.
Unbundle: chiede requisiti.
Utente: Servono FAQ aggiornate, owner contenuti, permessi e processo di revisione.
Unbundle: chiede ESG.
Utente: Impatto sociale positivo per accesso piu rapido alle informazioni; ambientale neutro.
Risultato: funziona senza account Unbundle perche la raccolta Slack e agganciata al workspace Slack installato.

### 13. Webapp use case ESG: operations capacity planner

Utente: idea per applicare AI a operations.
Unbundle: chiede titolo, problema, flusso AI, controllo umano, guardrail, impatto, dati, urgenza, ESG.
Risposte: Operations capacity planner; pianificazione manuale con fogli; AI genera scenari di capacita; operations lead valida; non cambia assegnazioni senza consenso; migliora pianificazione; servono backlog/calendari/capacita; wave 3 mesi; carichi piu sostenibili.
Risultato: completa.

### 14. Webapp use case: procurement supplier scan

Utente: segnalo un use case AI.
Unbundle: percorre tutti i campi use case.
Risposte: Procurement supplier scan; confronto manuale fornitori; AI estrae rischi e schede comparative; procurement manager approva; non scarta automaticamente; riduce scouting; servono documenti/criteri/policy/accessi; progetto 2 mesi.
Risultato: completa.

### 15. Webapp best practice: finance close

Utente: abbiamo fatto una best practice con AI.
Unbundle: percorre campi best practice.
Risposte: Monthly close checklist; prima controlli manuali; AI segnala eccezioni; risparmia tempo e migliora controlli; finance e controlling la usano; servono dati contabili/checklist/regole/owner.
Risultato: completa.

### 16. Webapp best practice ESG: marketing content reuse

Utente: processo gia migliorato con AI.
Unbundle: percorre campi best practice + ESG.
Risposte: Content atomization; riadattamento manuale contenuti; AI genera varianti; aumenta velocita e coerenza; marketing/comunicazione; brand guidelines/contenuti/calendario/owner; impatto sociale neutro con supervisione creativa umana.
Risultato: completa.

### 17. Webapp use case: legal review con divagazione

Unbundle: chiede situazione attuale.
Utente: che tempo fa oggi?
Unbundle: riconosce fuori contesto e ripete la domanda.
Utente: Oggi legal rilegge manualmente contratti e clausole standard con molto lavoro ripetitivo.
Risultato: recupera e completa la conversazione senza salvare la divagazione.

### 18. Webapp use case ESG: recruiting screening

Utente: potremmo usare AI nel recruiting.
Unbundle: percorre tutti i campi use case + ESG.
Risposte: Recruiting shortlist assistant; screening manuale con rischio bias; AI prepara shortlist spiegabile; recruiter/hiring manager approvano; evitare discriminazioni e decisioni automatiche; riduce tempi e aumenta tracciabilita; servono CV/criteri/policy/storico; progetto compliance 3 mesi; impatto sociale alto da progettare per equita.
Risultato: completa.

### 19. Webapp best practice ESG: customer onboarding

Utente: utilizziamo gia AI per onboarding clienti.
Unbundle: percorre campi best practice + ESG.
Risposte: Customer onboarding copilot; preparazione manuale checklist/materiali; AI genera piano onboarding; risparmia tempo e personalizza esperienza; customer success e clienti; contratto/note sales/template/owner; accessibilita alle informazioni, ambientale neutro.
Risultato: completa.

### 20. Webapp use case ESG: reporting graphics, caso Gianluca-like

Utente: voglio segnalare un'idea per migliorare report.
Unbundle: chiede titolo.
Utente: Sostituzione supporto grafiche.
Unbundle: chiede situazione attuale.
Utente: Oggi NATIVA dipende da fornitori esterni per fare grafiche di report e relazioni di impatto.
Unbundle: chiede flusso con AI.
Utente: L'AI trasforma documenti Word finalizzati in output graficamente coerenti con le brand guidelines.
Unbundle: chiede controllo umano.
Utente: Il responsabile progetto rilegge e approva il documento prima della consegna al cliente.
Unbundle: chiede guardrail.
Utente: Il contenuto del report non deve essere modificato: l'AI lavora solo sulla parte grafica.
Unbundle: chiede impatto atteso.
Utente: Risparmia 5-10 ore per progetto e migliora qualita e velocita della consegna.
Unbundle: chiede dati necessari.
Utente: Servono report finale, brand guidelines del cliente, template grafici e owner di progetto.
Unbundle: chiede urgenza.
Utente: Quick win se integrato su template ricorrenti.
Unbundle: chiede ESG.
Utente: Impatto sociale da valutare per possibile riduzione del lavoro dei fornitori grafici.
Risultato: completa.

## Verifiche eseguite

- `npm run test:slack`: 20/20 test passati.
- `npm run lint -- src/lib/slack/use-case-agent.ts src/lib/slack/use-case-agent-utils.ts src/lib/slack/use-case-agent.test.ts src/lib/db/queries/slack.ts`: passato.
- `npm run typecheck`: passato.
- Browser locale: settings workspace e pagina submit portfolio caricate senza errori console; domanda ESG visibile nella webapp.
- Vercel production logs: nessun log error trovato nella finestra controllata; la prova decisiva e stata il DB, che conserva i draft creati dal loop.

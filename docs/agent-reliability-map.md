# Agent Reliability Map

Questo documento traduce la skill di Production Agent Engineering nel contesto Unbundle.
Serve come checklist operativa per modificare agenti, tool LLM e flussi conversazionali.

## Agenti mappati

- Slack portfolio collector: raccoglie best practice e use case AI via Slack, salva draft, valida campi, crea contributi portfolio.
- Discovery / leadership chat: intervista leadership, usa memoria/RAG, web search e tool DB.
- Activity mapping chat: raccoglie attivita, usa tool DB, memoria/RAG e classificazioni successive.
- Portfolio reviewer: suggerisce punteggi su KPI custom, senza stimare KPI economici quando mancano dati affidabili.
- Use case generator: genera use case da attivita classificate.
- Blueprint generator: genera blueprint tecnici per agenti implementativi.
- Scenario / simulation generator: genera scenari e implicazioni operative.
- Report generator: produce report executive.
- Intelligence / strategy / value-map agents: generano analisi, OKR e posizionamenti.

## Contratto minimo

- Obiettivo: ogni agente deve avere input, output, stato e side effect espliciti.
- Strumenti: i tool che scrivono su DB devono validare permessi e payload fuori dal modello.
- Stato: i flussi multi-step non devono dipendere solo dalla chat history; devono salvare progressi recuperabili.
- Validazione: se una risposta non soddisfa il campo corrente, l'agente deve chiedere un chiarimento invece di salvarla.
- UX: una domanda alla volta quando si raccoglie input operativo.
- Osservabilita: ogni rifiuto, tool failure o salvataggio rilevante deve essere loggato con campo, kind e id draft/use case, senza contenuto sensibile.
- Fallback: in caso di dipendenza non critica fallita, salvare lo stato e indicare il prossimo passo pratico.

## Flusso Slack collector

- Input: testo Slack, team, canale, thread, workspace risolto da installazione.
- Stato: `slack_use_case_drafts`, indicizzato per workspace, team, utente, thread.
- Routing: prima classificazione `best_practice` vs `use_case_ai`, poi state machine deterministica.
- Validazione: ogni risposta viene controllata rispetto al campo atteso.
- Side effect: creazione `use_cases` solo a draft completo; idempotenza tramite `markDraftSubmittedIfDrafting`.
- Fallback: se il submit fallisce, il draft resta `drafting` e l'utente puo scrivere `confermo` per riprovare.

## Flusso Ranking

- Input: contributi portfolio e scoring model workspace.
- Stato client: override ottimistici temporanei dopo save.
- Regola affidabilita: appena il server torna con `updated_at` almeno fresco quanto l'override, l'override locale viene rimosso.
- Side effect: i punteggi manuali sono salvati via Server Action con permessi reviewer.
- Regressione coperta: salvataggi ripetuti sullo stesso use case non possono lasciare il punto fermo su valori vecchi.

# Claude MCP per Unbundle - Agent Design

## 1. System Design

Obiettivo: permettere a un utente di parlare con Claude e inviare una best practice o un use case AI nel portfolio Unbundle corretto.

Componenti:

- Claude Skill: guida conversazione, campi e conferma.
- MCP stdio server: espone tool controllati a Claude.
- API Unbundle: autentica token, valida payload, applica idempotenza e crea il contributo.
- DB Unbundle: salva token workspace, submission idempotenti e record `use_cases`.
- Portfolio ranking: esegue auto-ranking con il modello KPI del workspace.

Data flow:

1. Claude legge la skill.
2. Claude chiama `get_workspace_intake_requirements`.
3. Claude raccoglie i campi mancanti.
4. Claude mostra riepilogo e chiede conferma.
5. Claude chiama `submit_portfolio_contribution`.
6. Unbundle crea il contributo e lo rende visibile in Raccolta & Ranking.

## 2. Tool And Contract Design

Tool read-only:

- `get_workspace_intake_requirements`
- Nessun side effect.
- Restituisce workspace, ESG, campi richiesti e KPI.

Tool mutating:

- `submit_portfolio_contribution`
- Richiede `confirmedByUser: true`.
- Richiede campi strutturati e validati.
- Usa idempotency key per evitare duplicati.
- Non accetta workspace arbitrari: il token è già legato al workspace.

## 3. Retrieval Engineering

Non c'è retrieval esterno obbligatorio. La fonte di verità è Unbundle:

- workspace corrente dal token,
- ESG dal DB,
- scoring model dal DB,
- conversazione utente come input non fidato.

Claude non deve usare fonti esterne per inventare impatti economici.

## 4. Reliability Engineering

- Timeout MCP verso API: default 15 secondi.
- Idempotenza: tabella `external_contribution_submissions`.
- Doppio invio stesso payload: ritorna il record esistente.
- Stesso idempotency key con payload diverso: errore 409.
- Fallimento salvataggio: submission marcata `failed`, errore leggibile al client.
- Auto-ranking e notifiche non bloccano la creazione se falliscono.

## 5. Security And Safety

- Token random prefissato `ub_mcp_`, salvato solo come hash SHA-256.
- Token legato a un solo workspace.
- Token revocabile da Integrazioni.
- Scope iniziale: `portfolio:submit`.
- Nessun accesso DB diretto da Claude.
- Conferma esplicita obbligatoria prima della mutation.
- Payload strict: campi extra respinti.

## 6. Evaluation And Observability

Test da mantenere:

- validazione payload use case/best practice,
- ESG obbligatorio quando abilitato,
- guardrail obbligatorio per use case AI,
- idempotency key deterministica nel MCP,
- command/tool MCP senza token,
- portfolio scoring regressions esistenti.

Log diagnostici:

- endpoint submit logga errori server-side,
- auto-ranking fallito non rompe il salvataggio,
- token `lastUsedAt` aggiornato a ogni chiamata valida.

## 7. Product / UX Behavior

- L'Admin vede la card "Claude per Unbundle" in Integrazioni.
- La card genera un setup kit copiabile che scarica server MCP e skill da Unbundle, evitando path locali nel flusso principale.
- Se il workspace Claude supporta una configurazione centralizzata, l'Admin installa il setup una volta nell'ambiente condiviso; altrimenti lo condivide con i colleghi autorizzati.
- Il token è mostrato una sola volta.
- Il collega usa un prompt naturale: "voglio segnalare a Unbundle un use case AI / una best practice".
- La skill chiede solo i campi mancanti.
- La skill corregge risposte fuori campo invece di salvarle nel campo sbagliato.
- Il riepilogo finale precede sempre l'invio.
- In caso di errore, Claude deve dire che il contributo non è stato salvato.

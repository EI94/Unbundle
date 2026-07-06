# AI Readiness OS - Phase 1

Data: 2026-07-05

## Scope implementato

La Fase 1 introduce il core assessment dentro il modello workspace di Unbundle.

Incluso:

- Setup assessment cliente da workspace.
- Template di sistema `AI Readiness Core` con pillar Technology, Context, Workflow, Adoption, Use Cases.
- Inviti respondent con token random e hash SHA-256 salvato a DB.
- Survey pubblica su `/a/[token]`, senza account Unbundle.
- Privacy notice prima della compilazione, con consensi separati e non pre-selezionati.
- Risposte pseudonimizzate e scoring derivato.
- Use case intake opzionale dentro la survey.
- Dashboard base nel workspace su `/dashboard/[workspaceId]/ai-readiness`.
- Aggregazione company e unit-level con soglia minima.
- Export Excel e PDF minimale da route autenticata.
- Audit events per creazione assessment, apertura, inviti, submit, score recompute, export.

## Assunzioni privacy

- La vista individuale e disabilitata di default.
- I risultati per team/unita sono mostrati solo quando il numero di respondent raggiunge `aggregationThreshold`.
- I free-text sono trattati come potenzialmente identificanti e non entrano nello scoring numerico.
- Gli export raw sono esclusi di default e ammessi solo se `privacyConfig.allowIndividualView = true`.
- Non viene salvato IP address raw. Il modello supporta `ipHash`, ma la Fase 1 non lo popola.
- La cancellazione/anonymization self-service e prevista per Fase 2.

## Scoring

Formula:

`readinessIndex = 0.65 * weightedAverage + 0.35 * weakestPillarScore`

Questo evita che una media alta nasconda un blocco strutturale: l'organizzazione si muove alla velocita del suo enabler AI Native piu debole.

Livelli:

- 0 Not started
- 1 Fragmented
- 2 Experimental
- 3 Structured
- 4 Scalable
- 5 AI Native

## Export

Excel include:

- Summary
- Pillar Scores
- Section Scores
- Responses Aggregated
- Responses Raw solo se permesso
- Use Cases
- Use Case Scoring
- Dashboard Data
- Data Dictionary
- Audit Export Info

PDF:

- Executive report minimale e valido come PDF server-side.
- Pensato per Fase 1; nella Fase 2 potra diventare un report visuale avanzato.

## Fase 2 prevista

Non inclusi intenzionalmente in Fase 1:

- AI insights generativi.
- Clustering use case.
- Roadmap AI-generated.
- Benchmark cross-client.
- Privacy advanced: DSR, anonymization workflow, DPIA checklist.
- Collegamento profondo con Discovery, Mapping e Portfolio.

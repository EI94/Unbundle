# AI Readiness OS - Fase 2 Intelligence Layer

La Fase 2 aggiunge un layer decisionale sopra l'assessment core senza rompere i guardrail privacy:

- AI insights auditabili: sintesi executive, bottleneck, adoption, roadmap, cluster use case e benchmark.
- Human review: ogni insight nasce in `draft`, poi puo essere `reviewed`, `approved` o `rejected`.
- Evidence-first: ogni insight salva evidenza, input scope, modello/regole e prompt version.
- Privacy by design: nessun insight contiene risposte individuali, email, nomi o pseudonymous id.
- Benchmark gated: visibile solo se `allowBenchmarking=true`, soglia aggregazione raggiunta e consensi sufficienti.
- Portfolio bridge: i use case raccolti via assessment possono essere promossi nel Portfolio Unbundle in stato `needs_inputs`.
- DSR respondent: dal link personale si possono esportare dati JSON, revocare benchmark o anonimizzare le risposte.

## Cosa non fa volutamente

- Non inventa numeri economici o profittabilita.
- Non mostra heatmap sotto soglia privacy.
- Non prende decisioni finali senza validazione umana.
- Non dichiara compliance legale: fornisce solo controlli e audit trail operativi.

## User journey

1. Admin crea e apre l'assessment AI Readiness.
2. Respondent compila survey e, se vuole, propone use case.
3. Dashboard aggrega score, pillar e team heatmap sopra soglia.
4. Team genera intelligence: gli insight vengono salvati come AI suggested/draft.
5. Team rivede, approva o rifiuta gli insight.
6. Team promuove i use case validi nel Portfolio.
7. Portfolio gestisce scoring, matrice, review e wave planning.

## Artifact tecnici

- Migration: `drizzle/0010_ai_readiness_intelligence.sql`
- DB self-heal: `src/lib/db/ensure-schema.ts`
- Motore intelligence: `src/lib/ai-readiness/intelligence.ts`
- Server actions: `src/lib/actions/ai-readiness.ts`
- Dashboard: `src/app/(dashboard)/dashboard/[workspaceId]/ai-readiness/page.tsx`
- Privacy respondent: `src/app/privacy/ai-readiness/[token]/page.tsx`
- Export respondent: `src/app/api/ai-readiness/respondents/[token]/export/route.ts`

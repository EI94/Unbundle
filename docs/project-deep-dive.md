# Unbundle - studio completo del progetto

Data analisi: 2026-04-25
Repository: `/Users/pierpaololaurito/unbundle`

## 1. Scope dell'analisi

Questo documento copre i file proprietari del repository, cartella per cartella e file per file, con focus su:

- scopo del prodotto
- architettura applicativa
- journey utente web e Slack
- integrazioni esterne
- modello dati
- inventario dei file realmente rilevanti al funzionamento

Esclusioni intenzionali:

- `node_modules/`
- `.next/`
- `.git/`
- `.vercel/`
- `.claude/`

Queste cartelle sono vendor, generate o locali all'ambiente e non descrivono il comportamento di business del tool.

## 2. Cos'e Unbundle

Unbundle e una web app multi-tenant per AI-powered work redesign. Il prodotto aiuta un'organizzazione a:

1. capire dove genera valore
2. definire il perimetro dell'analisi
3. mappare le unita organizzative e le loro attivita
4. classificare il lavoro nei tre stream `Automate`, `Differentiate`, `Innovate`
5. generare use case AI
6. raccogliere contributi bottom-up via web e via Slack
7. valutarli con un modello di ranking personalizzabile
8. produrre mappe, piani, report, blueprint tecnici e simulazioni organizzative

In una frase: Unbundle trasforma discovery strategica + process mapping + portfolio AI governance in un unico workspace operativo.

## 3. Value proposition reale del prodotto

Il prodotto non e un semplice chatbot. E un sistema di trasformazione composto da 3 motori:

- motore di discovery strategica con chat AI guidata
- motore di mapping del lavoro e classificazione delle attivita
- motore di intake, scoring e prioritizzazione dei contributi AI

La parte Slack non e accessoria: e un canale di raccolta bottom-up per idee e best practice, collegato allo stesso portfolio del workspace web.

## 4. Journey utente end-to-end

### 4.1 Accesso e creazione workspace

1. L'utente entra da landing page.
2. Fa login o registrazione con Firebase Auth (Google oppure email/password).
3. La sessione viene trasformata in cookie server-side (`__session`).
4. L'utente crea un'organizzazione e poi un workspace.
5. Entra nel workspace, che diventa il contenitore della trasformazione.

### 4.2 Discovery con leadership

1. L'utente apre `Discovery`.
2. Trova una chat AI guidata.
3. Il sistema usa prompt dedicato, memoria conversazionale e contesto da documenti caricati.
4. L'AI raccoglie:
   - company value thesis
   - system boundary
   - terminologia delle unita organizzative
   - unita da mappare
   - obiettivi strategici / OKR / KPI
5. I dati vengono salvati strutturalmente su DB tramite tool AI server-side.

### 4.3 Contesto e strategia

1. Il workspace espone una vista riepilogativa del contesto raccolto.
2. L'utente puo aggiungere goal/obiettivi/KR manualmente.
3. In alternativa puo chiedere suggerimenti OKR all'AI, basati sulla value thesis.

### 4.4 Activity mapping per unita

1. L'utente entra nella pagina di mapping di una specifica unita.
2. Puo caricare documenti di supporto.
3. Se ci sono documenti, puo far pre-generare attivita candidate.
4. La chat AI fa interview strutturata:
   - input
   - processo
   - output
   - punti decisionali
   - eccezioni
   - strumenti
   - tempo
   - pain points
5. Le attivita vengono salvate e, a fine mapping, il sistema:
   - marca la unita come `mapped`
   - classifica automaticamente le attivita nei 3 stream
   - stima AI exposure via matching O*NET

### 4.5 Use case generation

1. Dalle attivita classificate, l'utente genera use case AI.
2. Gli use case hanno scoring:
   - impatto
   - fattibilita
   - opzionalmente ESG
3. Il sistema calcola:
   - score complessivo
   - categoria di matrice (`quick_win`, `strategic_bet`, `capability_builder`, `not_yet`)
4. L'utente vede lista, matrice e dettaglio del use case.

### 4.6 Portfolio intake e governance

Parallelamente al flusso discovery/mapping, il workspace ha una sezione `Raccolta & Ranking`:

1. Si possono raccogliere contributi manuali via web:
   - `Use Case AI`
   - `Best Practice`
2. Oppure via Slack, attraverso il bot.
3. Tutti i contributi entrano come `use_cases` con `portfolioKind` valorizzato.
4. Un team di transformation li valuta con KPI configurabili.
5. Il sistema notifica:
   - campanella web
   - canale Slack admin opzionale
   - webhook WhatsApp opzionale

### 4.7 Output finali

Dal workspace derivano piu artefatti:

- `Value map`: mappa Wardley delle attivita
- `Plan`: sequencing temporale dei use case
- `Reports`: executive report AI-generated
- `Blueprints`: blueprint tecnici per agenti AI
- `Simulation`: scenari di org redesign
- `Intelligence`: segnali e analisi competitiva

## 5. Integrazioni esterne

## 5.1 Firebase

Usato per autenticazione utente:

- client auth nel browser
- Firebase Admin sul server per verificare il session cookie
- provisioning utente applicativo nel DB al primo login

## 5.2 Slack

E una delle integrazioni piu importanti del progetto.

Cosa fa:

- installazione OAuth multi-tenant per workspace
- raccolta conversazionale di contributi via DM o mention
- riepilogo con pulsanti Block Kit
- submit contributo nel portfolio Unbundle
- invio notifiche al canale admin
- reminder automatici su draft incompleti
- protezione cross-tenant per Slack Connect

Dettagli chiave:

- il mapping Slack workspace -> Unbundle workspace e persistito su DB
- il bot gestisce DM, mention e thread
- se un canale e condiviso tra organizzazioni, il bot blocca la raccolta per evitare contaminazione tenant
- c'e una patch locale a `@chat-adapter/slack` per evitare dedup/event race nei canali privati

## 5.3 Anthropic / AI SDK

Usati per quasi tutta la logica AI:

- discovery
- activity mapping
- classificazione attivita
- O*NET matching
- use case generation
- report
- blueprint
- simulation
- competitive intelligence
- summary documenti

## 5.4 Neon Postgres + Drizzle

Il DB e il backbone del prodotto. Drizzle definisce schema, query e migrazioni. Il repository include anche un meccanismo di `ensureDbSchema()` per auto-allineare runtime e schema se alcune migration non sono state applicate.

## 5.5 Vercel Blob

Usato per salvare i documenti caricati.

## 5.6 WhatsApp webhook generico

Non c'e una integrazione nativa WhatsApp. Il prodotto espone invece un webhook configurabile che inoltra JSON verso Zapier, Make, Twilio o endpoint custom.

## 5.7 Web search AI

Nel flusso discovery e activity mapping l'AI puo usare ricerca web via tool Anthropic web search.

## 5.8 Altre dipendenze presenti ma non sostanzialmente usate

Nel codice attuale risultano presenti in dipendenze o sync env, ma non sono materialmente centrali nel runtime applicativo:

- `@upstash/redis`
- `resend`

## 6. Architettura logica

### 6.1 Frontend

- Next.js 16 App Router
- React 19
- Tailwind CSS 4
- shadcn/base-nova UI
- pagine server-first con componenti client dove serve interazione

### 6.2 Backend applicativo

- route handlers in `src/app/api/...`
- server actions in `src/lib/actions/...`
- query layer separato in `src/lib/db/queries/...`

### 6.3 AI layer

- prompt espliciti in `src/lib/ai/prompts/...`
- tool AI strutturati in `src/lib/ai/tools/...`
- generatori dedicati per use case, report, blueprint, simulation

### 6.4 Persistence

- schema centrale in `src/lib/db/schema.ts`
- migrazioni Drizzle in `drizzle/`
- memoria conversazionale e chunking documentale per RAG

## 7. Modello dati: entita principali

### 7.1 Identity e tenancy

- `users`
- `organizations`
- `memberships`
- `workspaces`

### 7.2 Discovery e strategia

- `strategic_goals`
- `conversations`
- `messages`
- `conversation_memory`

### 7.3 Mapping operativo

- `departments`
- `activities`
- `activity_dependencies`
- `uploaded_documents`
- `document_chunks`

### 7.4 Output analitici

- `use_cases`
- `use_case_kr_links`
- `value_map_nodes`
- `reports`
- `agent_blueprints`
- `simulations`
- `weekly_signals`

### 7.5 Slack

- `slack_installations`
- `slack_use_case_drafts`

### 7.6 Ranking governance

- `workspace_scoring_models`

## 8. Slack journey dettagliata

### 8.1 Installazione

1. Admin apre `Integrazioni`.
2. Clicca `Installa su Slack`.
3. La route `/api/slack/install` costruisce l'URL OAuth con `state = workspaceId`.
4. `/api/slack/oauth` salva:
   - `slackTeamId`
   - `slackTeamName`
   - `botToken`
   - `installedBy`
5. L'installazione viene associata al workspace Unbundle corrente.

### 8.2 Uso del bot

Il bot risponde in:

- direct message
- app mention in canale
- thread sottoscritti

### 8.3 Raccolta del contributo

1. L'agente chiede prima il routing:
   - best practice gia realizzata
   - idea di use case AI
2. Salva un draft Slack.
3. Raccoglie un campo per volta.
4. Quando il draft e completo, pubblica Block Kit con:
   - `Conferma invio`
   - `Modifica`
5. La conferma crea un `use_case` nel portfolio.

### 8.4 Reminder lifecycle

- dopo circa 24h: reminder nel thread
- dopo circa 48h: archiviazione automatica del draft

### 8.5 Notifiche

Dopo il submit:

- signal in web app
- messaggio Slack al canale admin, se configurato
- webhook WhatsApp, se configurato

## 9. RAG e document intelligence

Il progetto usa un RAG "leggero":

- i documenti vengono chunkati
- i chunk vengono salvati in DB
- il retrieval usa full-text search Postgres, non embeddings vettoriali
- anche i messaggi conversazionali vengono indicizzati come memoria

Limite pratico importante:

- TXT, CSV, MD: testo estratto direttamente
- PDF: estrazione testuale via LLM
- DOCX, XLSX, PPTX: oggi non c'e estrazione reale, viene salvato un placeholder di testo non estratto

Questo e un punto importante da ricordare se si pensa che l'upload Office sia gia pienamente supportato semanticamente.

## 10. Osservazioni tecniche importanti

### 10.1 `README.md` non descrive il prodotto

E ancora il README generico del template Next.js.

### 10.2 `workspace.status` e poco orchestrato

Esiste uno stato workspace (`setup`, `mapping`, `analysis`, `complete`), ma nel codice non ho trovato flussi applicativi che lo aggiornino davvero. La cron `weekly-pulse` processa solo workspace con stato `mapping`, quindi oggi questa parte rischia di restare inattiva senza interventi manuali o futuri wiring.

### 10.3 Persistenza risultati non sempre reidratata in UI

Esistono tabelle e helper per persistere:

- `agent_blueprints`
- `simulations`

Ma le rispettive pagine (`BlueprintViewer`, `SimulationViewer`) partono da stato client vuoto e non caricano l'ultimo risultato persistito. Quindi la persistenza esiste, ma la UX non la sfrutta ancora a pieno.

### 10.4 Competitive analysis non persiste

L'analisi competitiva viene generata on demand e mostrata in locale nel componente client; non viene salvata su DB.

### 10.5 DB self-healing

`ensureDbSchema()` e un meccanismo pragmatico e utile in ambienti Vercel/DB eterogenei, ma segnala che il progetto ha dovuto compensare drift di migration tra ambienti.

## 11. Inventario cartella per cartella, file per file

## 11.1 Root

- `AGENTS.md` - istruzioni locali per agenti, con nota forte su Next.js non standard.
- `CLAUDE.md` - rimanda ad `AGENTS.md`.
- `README.md` - README generico del template Next.js, non documenta Unbundle.
- `package.json` - dipendenze, script DB/Vercel/build, patch-package postinstall.
- `package-lock.json` - lockfile npm.
- `next.config.ts` - config Next minima, senza override significativi.
- `vercel.json` - definisce 2 cron: `weekly-pulse` e `slack-draft-nudge`.
- `drizzle.config.ts` - collega Drizzle a `src/lib/db/schema.ts`.
- `tsconfig.json` - TypeScript strict con alias `@/*`.
- `eslint.config.mjs` - setup ESLint Next.
- `postcss.config.mjs` - abilita plugin Tailwind CSS 4.
- `components.json` - configurazione shadcn/base-nova.

## 11.2 `scripts/`

- `scripts/sync-vercel-env.mjs` - sincronizza variabili ambiente locali verso Vercel Production, compresi Firebase, Anthropic, Slack fallback, Blob, cron secret.

## 11.3 `patches/`

- `patches/@chat-adapter+slack+4.26.0.patch` - evita che un evento message top-level in canale privato faccia perdere l'`app_mention` per problemi di dedup nel pacchetto upstream.

## 11.4 `drizzle/`

- `drizzle/0000_many_wallow.sql` - schema iniziale del prodotto.
- `drizzle/0001_ambitious_tenebrous.sql` - aggiunge memoria conversazionale, document chunks, installazioni Slack, draft Slack, terminologia unita, ESG e colonne portfolio base.
- `drizzle/0002_secret_red_skull.sql` - aggiunge `contribution_kind` a draft Slack e `portfolio_kind` ai use case.
- `drizzle/0003_slack_draft_reminders.sql` - aggiunge `slack_channel_id`, reminder a 24h e abbandono a 48h nei draft Slack.
- `drizzle/0004_portfolio_scoring_model.sql` - introduce team name, review status, scoring model workspace e review metadata.
- `drizzle/0005_portfolio_kpi_and_channels.sql` - aggiunge webhook WhatsApp e `custom_scores` sui use case.
- `drizzle/meta/_journal.json` - journal migrazioni.
- `drizzle/meta/*.json` - snapshot schema Drizzle.

## 11.5 `public/`

- `public/file.svg` - asset statico generico.
- `public/globe.svg` - asset statico generico.
- `public/next.svg` - logo Next del template.
- `public/vercel.svg` - logo Vercel del template.
- `public/window.svg` - asset statico generico.

## 11.6 `src/app/`

### Shell e pagine top-level

- `src/app/layout.tsx` - layout root, font Geist, toaster, tooltip provider, metadata app.
- `src/app/page.tsx` - landing pubblica e redirect a dashboard se autenticato.
- `src/app/globals.css` - tema globale dark, token colore e style primitives.
- `src/app/favicon.ico` - favicon.

### Auth

- `src/app/(auth)/login/page.tsx` - pagina login/register/reset.

### Dashboard root

- `src/app/(dashboard)/layout.tsx` - gate auth per tutta la dashboard.
- `src/app/(dashboard)/dashboard/page.tsx` - lista workspace utente e creazione workspace.
- `src/app/(dashboard)/dashboard/[workspaceId]/layout.tsx` - layout interno workspace con sidebar e topbar notifiche.
- `src/app/(dashboard)/dashboard/[workspaceId]/page.tsx` - overview workspace e percorso operativo.

### Discovery / setup

- `src/app/(dashboard)/dashboard/[workspaceId]/setup/leadership/page.tsx` - discovery chat con AI e upload documenti.
- `src/app/(dashboard)/dashboard/[workspaceId]/setup/context/page.tsx` - vista contesto consolidato.
- `src/app/(dashboard)/dashboard/[workspaceId]/strategy/page.tsx` - gestione goal/OKR.

### Mapping

- `src/app/(dashboard)/dashboard/[workspaceId]/mapping/page.tsx` - lista unita da mappare.
- `src/app/(dashboard)/dashboard/[workspaceId]/mapping/[deptId]/page.tsx` - chat mapping o dashboard unita gia mappata.

### Use cases / portfolio

- `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/page.tsx` - lista e matrice use case generati.
- `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/page.tsx` - dettaglio use case generato.
- `src/app/(dashboard)/dashboard/[workspaceId]/portfolio/page.tsx` - inbox portfolio, ranking matrix, modello scoring, settings team.
- `src/app/(dashboard)/dashboard/[workspaceId]/portfolio/submit/page.tsx` - form manuale invio contributo.
- `src/app/(dashboard)/dashboard/[workspaceId]/portfolio/review/[useCaseId]/page.tsx` - review analitica di un contributo portfolio.

### Analisi e output

- `src/app/(dashboard)/dashboard/[workspaceId]/value-map/page.tsx` - Wardley map delle attivita.
- `src/app/(dashboard)/dashboard/[workspaceId]/plan/page.tsx` - sequencing use case in timeline/fasi.
- `src/app/(dashboard)/dashboard/[workspaceId]/reports/page.tsx` - report esecutivi persistiti.
- `src/app/(dashboard)/dashboard/[workspaceId]/blueprints/page.tsx` - blueprint tecnici agent-based.
- `src/app/(dashboard)/dashboard/[workspaceId]/simulation/page.tsx` - scenari di org redesign.
- `src/app/(dashboard)/dashboard/[workspaceId]/intelligence/page.tsx` - segnali + competitive intelligence.
- `src/app/(dashboard)/dashboard/[workspaceId]/settings/page.tsx` - integrazioni Slack + ESG.

### Legal e support

- `src/app/legal/layout.tsx` - layout pubblico pagine legali.
- `src/app/legal/privacy/page.tsx` - bozza privacy policy prodotto + Slack.
- `src/app/legal/terms/page.tsx` - bozza termini di servizio.
- `src/app/legal/support/page.tsx` - pagina supporto e chiarimento installazione Slack per azienda.

### Slack install helper

- `src/app/install/slack/route.ts` - entry point alternativo per scegliere il workspace corretto prima dell'OAuth Slack.

### API routes

- `src/app/api/auth/session/route.ts` - crea/elimina session cookie applicativo.
- `src/app/api/ai/chat/route.ts` - backend della chat AI del prodotto.
- `src/app/api/ai/classify/route.ts` - endpoint per classificazione attivita.
- `src/app/api/documents/upload/route.ts` - upload documenti, summarization, indexing RAG.
- `src/app/api/cron/weekly-pulse/route.ts` - genera weekly signals via AI per workspace in `mapping`.
- `src/app/api/cron/slack-draft-nudge/route.ts` - reminder/abbandono draft Slack.
- `src/app/api/slack/install/route.ts` - costruisce l'authorize URL Slack.
- `src/app/api/slack/oauth/route.ts` - completa OAuth e salva installazione.
- `src/app/api/slack/events/route.ts` - alias Event Subscriptions Slack.
- `src/app/api/slack/webhooks/route.ts` - webhook principale Slack.
- `src/app/api/slack/interactivity/route.ts` - gestisce pulsanti Block Kit Slack.
- `src/app/api/workspaces/[workspaceId]/sidebar-data/route.ts` - alimenta sidebar discovery con dati riepilogativi.
- `src/app/api/workspaces/[workspaceId]/use-cases/route.ts` - GET use cases workspace.
- `src/app/api/workspaces/[workspaceId]/use-cases/[useCaseId]/route.ts` - GET dettaglio use case.
- `src/app/api/workspaces/[workspaceId]/use-cases/[useCaseId]/status/route.ts` - PATCH stato lifecycle.
- `src/app/api/workspaces/[workspaceId]/use-cases/[useCaseId]/wave/route.ts` - PATCH categoria/quadrante manuale.
- `src/app/api/workspaces/[workspaceId]/use-cases/[useCaseId]/scores/route.ts` - PATCH score legacy e ricalcolo metriche.

## 11.7 `src/components/agent/`

- `src/components/agent/chat-interface.tsx` - componente chat riusato per discovery e activity mapping; gestisce streaming, timer, suggerimenti, visualizzazione tool AI e nudge all'utente.

## 11.8 `src/components/auth/`

- `src/components/auth/login-form.tsx` - login Google/email, registrazione e reset password via Firebase client.

## 11.9 `src/components/dashboard/`

- `src/components/dashboard/activity-pre-generator.tsx` - propone attivita estratte dai documenti e permette conferma selettiva.
- `src/components/dashboard/activity-sidebar.tsx` - sidebar di supporto durante il mapping con attivita gia salvate, stream e AI exposure.
- `src/components/dashboard/app-sidebar.tsx` - navigazione principale dell'app.
- `src/components/dashboard/blueprint-viewer.tsx` - UI client per generare e visualizzare blueprint agentici.
- `src/components/dashboard/classify-button.tsx` - trigger manuale classificazione attivita.
- `src/components/dashboard/competitive-analysis.tsx` - viewer client per intelligence competitiva AI-generated.
- `src/components/dashboard/create-workspace-dialog.tsx` - modal creazione workspace/organizzazione.
- `src/components/dashboard/dashboard-list-shell.tsx` - shell sidebar per dashboard workspace list.
- `src/components/dashboard/department-dashboard.tsx` - dashboard analitico post-mapping della singola unita.
- `src/components/dashboard/document-upload.tsx` - upload documenti contestuali.
- `src/components/dashboard/esg-toggle.tsx` - attiva/disattiva scoring ESG nel workspace.
- `src/components/dashboard/gantt-chart.tsx` - visualizzazione timeline pseudo-Gantt dei use case.
- `src/components/dashboard/generate-report-button.tsx` - genera report esecutivo.
- `src/components/dashboard/generate-use-cases-button.tsx` - genera use case AI dalle attivita classificate.
- `src/components/dashboard/generate-value-map-button.tsx` - genera posizionamento Wardley map.
- `src/components/dashboard/goal-form.tsx` - modal per creare goal/objective/KR.
- `src/components/dashboard/leadership-sidebar.tsx` - sidebar polling durante discovery con thesis/unita/goal.
- `src/components/dashboard/signals-feed.tsx` - feed dei weekly signals / portfolio signals.
- `src/components/dashboard/simulation-viewer.tsx` - UI client per scenari di org redesign.
- `src/components/dashboard/slack-install-button.tsx` - bottone installazione Slack.
- `src/components/dashboard/slack-notify-channel-form.tsx` - configurazione canale admin Slack.
- `src/components/dashboard/suggest-okrs-button.tsx` - genera suggerimenti OKR con AI.
- `src/components/dashboard/use-case-matrix.tsx` - scatter plot impatto/fattibilita.
- `src/components/dashboard/use-case-portfolio-actions.tsx` - azioni manuali lifecycle/quadrante su use case generato.
- `src/components/dashboard/workspace-card.tsx` - card workspace in dashboard.

## 11.10 `src/components/maps/`

- `src/components/maps/wardley-map.tsx` - rendering D3 della value map/Wardley map con tooltip e legenda stream.

## 11.11 `src/components/portfolio/`

- `src/components/portfolio/notifications-bell.tsx` - campanella notifiche workspace.
- `src/components/portfolio/ranking-matrix.tsx` - matrice 2D server-rendered per ranking portfolio.
- `src/components/portfolio/review-form.tsx` - form di scoring custom KPI per reviewer.
- `src/components/portfolio/scoring-model-form.tsx` - editor del modello KPI/soglie/pesi.
- `src/components/portfolio/submit-form.tsx` - form utente per invio best practice o use case AI.
- `src/components/portfolio/team-settings-form.tsx` - nome team transformation + webhook WhatsApp.
- `src/components/portfolio/workspace-topbar.tsx` - topbar sticky con campanella segnali.

## 11.12 `src/components/ui/`

Questi file sono primitive UI generiche, quasi tutte in stile shadcn/base-nova. Non contengono logica di business significativa.

- `src/components/ui/avatar.tsx` - avatar.
- `src/components/ui/badge.tsx` - badge.
- `src/components/ui/button.tsx` - button.
- `src/components/ui/card.tsx` - card.
- `src/components/ui/checkbox.tsx` - checkbox.
- `src/components/ui/command.tsx` - command palette primitive.
- `src/components/ui/dialog.tsx` - modal/dialog.
- `src/components/ui/dropdown-menu.tsx` - dropdown menu.
- `src/components/ui/input-group.tsx` - grouped input wrappers.
- `src/components/ui/input.tsx` - input text/number.
- `src/components/ui/label.tsx` - label.
- `src/components/ui/popover.tsx` - popover.
- `src/components/ui/progress.tsx` - progress bar.
- `src/components/ui/scroll-area.tsx` - scroll area.
- `src/components/ui/select.tsx` - select.
- `src/components/ui/separator.tsx` - separator.
- `src/components/ui/sheet.tsx` - sheet/drawer.
- `src/components/ui/sidebar.tsx` - sistema sidebar riusato da dashboard.
- `src/components/ui/skeleton.tsx` - skeleton loading.
- `src/components/ui/sonner.tsx` - wrapper toaster.
- `src/components/ui/switch.tsx` - switch toggle.
- `src/components/ui/table.tsx` - table primitives.
- `src/components/ui/tabs.tsx` - tabs.
- `src/components/ui/textarea.tsx` - textarea.
- `src/components/ui/tooltip.tsx` - tooltip.

## 11.13 `src/hooks/`

- `src/hooks/use-mobile.ts` - hook client per breakpoint mobile.

## 11.14 `src/lib/actions/`

- `src/lib/actions/blueprints.ts` - genera e persiste blueprint agentici.
- `src/lib/actions/classify.ts` - classifica attivita del workspace.
- `src/lib/actions/intelligence.ts` - gestione signals e analisi competitiva.
- `src/lib/actions/onet.ts` - matching O*NET e AI exposure.
- `src/lib/actions/portfolio.ts` - cuore del portfolio: submit, review, scoring model, notifiche.
- `src/lib/actions/pre-generate-activities.ts` - estrazione attivita da documenti e conferma.
- `src/lib/actions/reports.ts` - genera report.
- `src/lib/actions/simulation.ts` - genera simulazioni e le persiste.
- `src/lib/actions/slack-settings.ts` - salva canale admin Slack.
- `src/lib/actions/strategy.ts` - crea goal e suggerisce OKR.
- `src/lib/actions/use-cases.ts` - genera use case, toggle ESG, cambia stato/categoria.
- `src/lib/actions/value-map.ts` - genera posizionamento Wardley map.
- `src/lib/actions/workspace.ts` - crea workspace e organizzazione.

## 11.15 `src/lib/ai/`

- `src/lib/ai/classify.ts` - classifica attivita nei 3 stream.
- `src/lib/ai/generate-blueprints.ts` - blueprint agentici dai use case.
- `src/lib/ai/generate-report.ts` - executive report completo.
- `src/lib/ai/generate-simulation.ts` - scenari what-if e AI OS.
- `src/lib/ai/generate-use-cases.ts` - use case AI da attivita classificate.
- `src/lib/ai/onet-matching.ts` - inferenza O*NET + AI exposure.
- `src/lib/ai/schemas.ts` - schemi Zod per discovery, activity, use case.

### Prompt

- `src/lib/ai/prompts/activity-mapping.ts` - prompt di intervista per activity mapping.
- `src/lib/ai/prompts/discovery.ts` - prompt discovery leadership.
- `src/lib/ai/prompts/leadership-setup.ts` - prompt alternativo/legacy per leadership setup.

### Tools AI

- `src/lib/ai/tools/activity-mapping-tools.ts` - tool server-side usati nella chat di mapping.
- `src/lib/ai/tools/leadership-tools.ts` - tool server-side usati nella discovery.
- `src/lib/ai/tools/web-search-tool.ts` - wrapper per web search via Anthropic tools.

### RAG

- `src/lib/ai/rag/chunker.ts` - chunking documenti e indexing su DB.
- `src/lib/ai/rag/retriever.ts` - retrieval full-text di chunk documentali e memoria conversazionale.

## 11.16 `src/lib/api/`

- `src/lib/api/use-case-scores-schema.ts` - schema body PATCH punteggi.
- `src/lib/api/use-case-status-wave-schema.ts` - schema body PATCH stato e wave.

## 11.17 `src/lib/db/`

- `src/lib/db/index.ts` - bootstrap connessione Neon/Drizzle.
- `src/lib/db/ensure-schema.ts` - self-healing schema runtime.
- `src/lib/db/schema.ts` - schema applicativo principale.
- `src/lib/db/schema-onet.ts` - tabelle di riferimento O*NET/benchmark, oggi non realmente sfruttate nel runtime.
- `src/lib/db/use-case-scoring.ts` - calcolo metriche aggregate e categoria use case.

### Query layer

- `src/lib/db/queries/activities.ts` - CRUD attivita e dipendenze.
- `src/lib/db/queries/conversations.ts` - CRUD conversazioni e messaggi.
- `src/lib/db/queries/organizations.ts` - organizzazioni, membership, inviti.
- `src/lib/db/queries/scoring-model.ts` - scoring model per workspace.
- `src/lib/db/queries/signals.ts` - weekly signals.
- `src/lib/db/queries/slack.ts` - installazioni Slack e draft contributi.
- `src/lib/db/queries/use-cases.ts` - use case, review, custom scores e lifecycle.
- `src/lib/db/queries/workspaces.ts` - workspace, unita organizzative, strategic goals.

## 11.18 `src/lib/firebase/`

- `src/lib/firebase/admin.ts` - Firebase Admin SDK per verificare sessioni.
- `src/lib/firebase/client.ts` - Firebase client app + auth browser.

## 11.19 `src/lib/navigation/`

- `src/lib/navigation/safe-callback-url.ts` - sanifica callback interni per evitare open redirect.

## 11.20 `src/lib/notifications/`

- `src/lib/notifications/portfolio-dispatch.ts` - dispatch unificato signal + Slack + WhatsApp quando nasce un nuovo contributo portfolio.

## 11.21 `src/lib/slack/`

- `src/lib/slack/bot.ts` - bootstrap Chat SDK Slack e routing messaggi.
- `src/lib/slack/contribution-review-blocks.ts` - Block Kit di riepilogo draft con pulsanti.
- `src/lib/slack/default-workspace-id.ts` - fallback single-tenant per OAuth senza `state`.
- `src/lib/slack/draft-nudge-cron.ts` - reminder/abbandono draft.
- `src/lib/slack/install-access.ts` - verifica accesso utente al workspace per installazione.
- `src/lib/slack/notifications.ts` - notifica canale admin Slack per nuovo contributo.
- `src/lib/slack/oauth-redirect-uri.ts` - costruisce redirect URI coerente con host richiesta.
- `src/lib/slack/slack-chat-post.ts` - wrapper `chat.postMessage`.
- `src/lib/slack/slack-webhook-post.ts` - handler condiviso webhook/Event Subscriptions Slack.
- `src/lib/slack/submit-contribution.ts` - converte draft Slack in use case portfolio.
- `src/lib/slack/use-case-agent.ts` - agente LLM Slack per intake bottom-up.
- `src/lib/slack/verify-slack-request-signature.ts` - verifica firma Slack.
- `src/lib/slack/workspace-context-cookie.ts` - cookie che ricorda il workspace corrente per Slack install flow.

## 11.22 `src/lib/`

- `src/lib/auth.ts` - auth server-side e session cookie helpers.
- `src/lib/use-case-lifecycle.ts` - regole di transizione stato/categoria use case.
- `src/lib/utils.ts` - helper `cn`.
- `src/lib/utils/unit-terminology.ts` - termini personalizzati per chiamare le unita organizzative.

## 11.23 `src/middleware.ts`

- `src/middleware.ts` - protegge dashboard e install Slack, gestisce redirect login e imposta cookie contesto workspace per Slack.

## 12. Sintesi finale

Unbundle e gia un prodotto molto piu strutturato di una classica "AI app":

- ha multi-tenancy organizzativa
- ha un flusso di discovery guidato
- ha mappatura operativa del lavoro
- ha intake bottom-up web e Slack
- ha governance portfolio con scoring personalizzabile
- ha artefatti a valle per piano, reporting e architettura target

Il cuore del sistema e la connessione tra 4 elementi:

1. contesto strategico
2. attivita operative
3. use case AI
4. governance del ranking

Slack amplia il prodotto fuori dalla web app e lo rende un sistema continuo di raccolta e revisione, non solo un workshop una tantum.

## 13. Base per i prossimi messaggi

Questo documento puo essere usato come base per:

- analisi architetturale piu critica
- identificazione gap di prodotto
- proposta di roadmap tecnica
- audit UX
- audit integrazione Slack
- proposta di rifattorizzazione cartella per cartella
- scrittura di documentazione ufficiale interna o investor-ready

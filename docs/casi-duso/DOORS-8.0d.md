# Le porte della 8.0d-1 «Porte»: l'inventario

20/11/2026, ramo `feat/rilascio-8-0d` (da `62200ff6`). Ogni ingresso dell'app (pagine, layout, rotte, server action, CLI e MCP, letture dirette del ruolo, SQL con confronti di ruolo) e la sua decisione per `esterno_caso` («Solo questo use case»). La regola: chiuso per default, aperto per elenco (`workspaceDoor`, `src/lib/auth/case-only.ts`); le porte aperte sono `CASE_ONLY_SURFACES`, tenute ferme da `src/lib/auth/case-only-guard.test.ts`. Generato dai sorgenti e riletto a mano.

## In breve

- **80 pagine, 18 layout, 141 rotte, 247 server action** (52 file `"use server"`).
- **Aperte a `esterno_caso`, sempre con il predicato per il caso:** 4 pagine, 2 layout, 16 rotte (la campanella e le 15 della CLI e dell'MCP del caso, dietro `openCli`), 10 azioni (le 7 di chi costruisce, la conferma della CLI, «Scollega», «Segna tutte come lette»). Fuori dalla dashboard: «Collega questa CLI» e la pagina dell'invito.
- **Tutto il resto è chiuso:** le tre porte (`getCollaboratorAccess`, `requireWorkspaceAccess`, `requireWorkspacePage`) senza opzione fanno passare solo i cinque collaboratori; `learner` solo con `allowLearner`; un ruolo sconosciuto mai. Le pagine riportano `esterno_caso` all'Agent Factory, le azioni e le rotte lo rifiutano.
- **Letture dirette di `getWorkspaceAccessForUser`: 10 file**, rilette una per una, ognuna con un elenco (sotto).
- **Confronti con `learner`:** 25 nel codice e 10 SQL «tutti tranne learner» diventati elenchi; nel SQL il ruolo si confronta come testo (`role::text`).
- **Token:** la CLI e l'MCP del caso aprono (predicato per caso); gli MCP del team, del portafoglio, dei dossier, del connettore, la CI e i link pubblici restano chiusi (token di altri ruoli, o senza persona).

## Le porte aperte (`CASE_ONLY_SURFACES`)

| File | Che cosa apre | Il controllo dopo la porta |
|---|---|---|
| `src/app/(dashboard)/dashboard/[workspaceId]/layout.tsx` | il guscio del workspace | `caseOnlyRedirect` per segmenti: dentro solo `agent-factory`, `casi-duso/<id>/progetto`, `use-cases/<id>/progetto`; una voce nella barra; la campanella sua; un ruolo sconosciuto 404 |
| `…/agent-factory/page.tsx` | «Agent Factory» | solo i casi che costruisce (il predicato); niente «Chi costruisce»; prima della riga del dossier, il testo di attesa; ripete la riga `osservatore` |
| `…/casi-duso/[caseId]/layout.tsx` | il guscio del dossier | `loadCaseHead` → `caseAccessPrecheck` con il predicato (404 fuori); solo la testata: niente schede, «⋯», passi, avvisi, export |
| `…/casi-duso/[caseId]/progetto/page.tsx` | «Progetto dell'agente» | `openShellPage` con il predicato; il pacchetto con `CONTESTO.md` ridotto (D7); il contesto dell'azienda no |
| `…/use-cases/[useCaseId]/progetto/page.tsx` | l'indirizzo breve della campanella e della CLI | il predicato per il dossier prima del rimando (404 fuori, senza dire quale dossier) |
| `src/app/api/workspaces/[workspaceId]/bell/route.ts` | la campanella (GET, POST) | `bellSourcesFor`: niente segnali, niente righe dei dossier, solo `CASE_ONLY_BELL_KINDS` dei casi che costruisce |
| `src/lib/actions/notifications.ts` | «Segna tutte come lette» | solo righe sue; i segnali per lui sono nessuno |
| `src/lib/actions/use-case-factory.ts` | le 7 azioni di chi costruisce | `onFactoryBuild` → `caseAccessPrecheck` con il predicato; approvare, riaprire, AI Board e modifica restano senza opzione |
| `src/lib/actions/cli-login.ts` | la conferma della CLI | `cliCaseWorkspaceIds` (una concessione o un caso) |
| `src/lib/actions/cli-tokens.ts` | «Scollega» | solo un collegamento suo |
| `src/lib/use-cases/cli/route-kit.ts` | la CLI e l'MCP del caso (`openCli`) | `resolveCliCase` → `caseAccessPrecheck` con il predicato: un caso fuori = uno che non esiste; D7 nel contesto e nel pacchetto; `unbundle contesto` 403; D4 nel repository |
| `src/app/cli/collega/page.tsx` | «Collega questa CLI» | `workspaceDoor` con `allowCaseOnly` + `cliCaseWorkspaceIds` |
| `src/lib/use-cases/cli/workspace-choices.ts` | la scelta del workspace della CLI | per elenco, solo dove costruisce o è nel team di un caso |

## Letture dirette di `getWorkspaceAccessForUser`

| File | Elenco dopo la lettura |
|---|---|
| `src/lib/workspace-access.ts` | `workspaceDoor` (e una riga dell'organizzazione con `esterno_caso` non vale) |
| `src/lib/auth/require-workspace.ts` | `workspaceDoor` |
| `src/app/(dashboard)/dashboard/[workspaceId]/layout.tsx` | `workspaceDoor` con `allowLearner` e `allowCaseOnly`, poi `learnerRedirect` e `caseOnlyRedirect` |
| `src/app/invite/[token]/page.tsx` | `keepsCurrentRole` (la stessa regola di `decideInviteAcceptance`) |
| `src/app/share/portfolio/[workspaceId]/[useCaseId]/page.tsx` | `isCollaboratorRole` |
| `src/app/api/learning/session/route.ts` | `workspaceDoor` con `allowLearner` |
| `src/lib/learning/server.ts` | `workspaceDoor` con `allowLearner` |
| `src/lib/learning/admin.ts` | `workspaceDoor` con `allowLearner`; nel SQL `member()` per elenco |
| `src/lib/learning/materials.ts` | `workspaceDoor` con `allowLearner` |
| `src/lib/learning/register.ts` | `isCollaboratorRole` |

## SQL con confronti di ruolo (prima → dopo)

| File | Prima | Dopo |
|---|---|---|
| `src/lib/use-cases/referent/people.ts (2)` | `m.role <> 'learner'` | `m.role IN (collaboratori)`, con l'opzione anche `m.role = 'learner'` di questo workspace |
| `src/lib/db/queries/use-case-workspace-team.ts (2)` | `role::text <> 'learner'` | `role::text IN (collaboratori)` |
| `src/lib/db/queries/uc-cases.ts (2)` | `role::text <> 'learner'` | `role::text IN (collaboratori)`; `esterno_caso` solo osservatore del suo caso (`caseOnlyGranteeOfCase`) |
| `src/lib/db/queries/uc-shell.ts` | `x.role <> 'learner'` | `x.role IN (collaboratori)` |
| `src/lib/db/queries/use-case-ci-keys.ts` | `role <> 'learner'` | `role IN (collaboratori)` |
| `src/lib/db/queries/workspace-collaboration.ts (2)` | `w.role <> 'learner'`, `role = 'learner'` | `role::text NOT IN ('learner', 'esterno_caso')` e l'aggiornamento per elenco, tutto `::text` |
| `scripts/uc-seed-case.ts` | `wm.role <> 'learner'` | `wm.role::text IN (collaboratori)` |
| `src/lib/learning/admin.ts` | `effectiveRole IS NOT NULL` | `effectiveRole IN (collaboratori, learner)` |
| `src/lib/db/queries/use-case-builders.ts (predicato)` | ruolo da revisore | ruolo da revisore **oppure** `esterno_caso` (solo workspace, `::text`) con una concessione per quel caso, mai «tutti» |

Tutti i nuovi confronti con `'esterno_caso'` sono `::text` (prova di guardia).

## Rami «chi non è revisore vede come un Contributore»

- I segnali (`src/lib/db/queries/signals.ts`) e la campanella (`bellSourcesFor`, `src/lib/notifications/bell.ts`): a chi non è revisore solo se è Contributore; a `learner`, `esterno_caso` e un ruolo sconosciuto niente.
- La barra (`src/components/shell/sidebar-model.ts`): `esterno_caso` una voce; un ruolo sconosciuto nessuna (prima la barra del Contributore).
- Mappatura (`boardAbilities`), referenti, «Realizzazioni» (`uc-nav.ts`), dossier (`caseAccessPrecheck`), CLI (`workspace-choices.ts`): per elenco.
- Gli altri rami (Home, «Programma», portafoglio e piano ad area spenta) stanno dietro `requireWorkspacePage`, chiusa: un ruolo sconosciuto non ci arriva.

## Pagine

| Pagina | Decisione |
|---|---|
| `src/app/(auth)/login/page.tsx` | pubblica / statica (nessun dato del workspace) |
| `src/app/(dashboard)/dashboard/[workspaceId]/account/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/agent-factory/page.tsx` | APERTA a esterno_caso (allowCaseOnly), poi il predicato per il caso |
| `src/app/(dashboard)/dashboard/[workspaceId]/ai-readiness/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/ai-readiness/preview/[assessmentId]/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/ai-readiness/questions/[assessmentId]/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/blueprints/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/[...resto]/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/attivita/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/domande/[itemId]/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/domande/documenti/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/domande/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/domande/verifica/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/firme/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/impostazioni/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/persone/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/privacy/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/progetto/page.tsx` | APERTA a esterno_caso (allowCaseOnly), poi il predicato per il caso |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/soluzione/dati/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/soluzione/mappa/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/soluzione/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/soluzione/regole/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/valore/kpi/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/valore/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/via/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/nuovo/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/contesto/conferma/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/contesto/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/contesto/verifica/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/intelligence/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/[moduleId]/page.tsx` | chiusa: porta della Formazione (requireWorkspace, per elenco: collaboratori e learner) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/activities/[activityId]/page.tsx` | chiusa: porta della Formazione (requireWorkspace, per elenco: collaboratori e learner) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/admin/page.tsx` | chiusa: porta della Formazione (requireWorkspace, per elenco: collaboratori e learner) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/attempts/[attemptId]/page.tsx` | chiusa: porta della Formazione (requireWorkspace, per elenco: collaboratori e learner) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/ideas/page.tsx` | chiusa: porta della Formazione (requireWorkspace, per elenco: collaboratori e learner) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/live/page.tsx` | nessun dato: solo un rimando (il layout porta esterno_caso all'Agent Factory) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/manage/[attemptId]/page.tsx` | chiusa: porta della Formazione (requireWorkspace, per elenco: collaboratori e learner) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/manage/page.tsx` | nessun dato: solo un rimando (il layout porta esterno_caso all'Agent Factory) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/page.tsx` | chiusa: porta della Formazione (requireWorkspace, per elenco: collaboratori e learner) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/progress/page.tsx` | chiusa: porta della Formazione (requireWorkspace, per elenco: collaboratori e learner) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/[programId]/results/page.tsx` | chiusa: porta della Formazione (requireWorkspace, per elenco: collaboratori e learner) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/admin/page.tsx` | chiusa: porta della Formazione (requireWorkspace, per elenco: collaboratori e learner) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/page.tsx` | chiusa: porta della Formazione (requireWorkspace, per elenco: collaboratori e learner) |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/register/page.tsx` | chiusa: porta della Formazione (requireWorkspace, per elenco: collaboratori e learner) |
| `src/app/(dashboard)/dashboard/[workspaceId]/mapping/[deptId]/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/mapping/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/plan/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/portfolio/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/portfolio/review/[useCaseId]/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/portfolio/submit/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/programma/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/reports/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/settings/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/setup/context/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/setup/leadership/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/simulation/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/strategy/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/progetto/page.tsx` | APERTA a esterno_caso (allowCaseOnly), poi il predicato per il caso |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/proposte/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/nuovo/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/[workspaceId]/value-map/page.tsx` | chiusa: requireWorkspacePage senza opzione (esterno_caso → Agent Factory, ruolo sconosciuto → 404) |
| `src/app/(dashboard)/dashboard/page.tsx` | i workspace della persona (nessun dato del workspace) |
| `src/app/a/[token]/page.tsx` | fuori dalla dashboard: token pubblico (referente, survey, corso); nessun ruolo del workspace |
| `src/app/c/[token]/page.tsx` | fuori dalla dashboard: token pubblico (referente, survey, corso); nessun ruolo del workspace |
| `src/app/cli/collega/page.tsx` | APERTA a esterno_caso (allowCaseOnly), poi il predicato per il caso |
| `src/app/invite/[token]/page.tsx` | fuori dalla dashboard: token dell'invito; «già dentro» per elenco (keepsCurrentRole); l'accettazione decide (decideInviteAcceptance) |
| `src/app/legal/privacy/page.tsx` | pubblica / statica (nessun dato del workspace) |
| `src/app/legal/support/page.tsx` | pubblica / statica (nessun dato del workspace) |
| `src/app/legal/terms/page.tsx` | pubblica / statica (nessun dato del workspace) |
| `src/app/page.tsx` | pubblica / statica (nessun dato del workspace) |
| `src/app/privacy/ai-readiness/[token]/page.tsx` | fuori dalla dashboard: token pubblico (referente, survey, corso); nessun ruolo del workspace |
| `src/app/r/[token]/page.tsx` | fuori dalla dashboard: token pubblico (referente, survey, corso); nessun ruolo del workspace |
| `src/app/rispondi/[token]/page.tsx` | fuori dalla dashboard: token pubblico (referente, survey, corso); nessun ruolo del workspace |
| `src/app/s/[token]/page.tsx` | fuori dalla dashboard: token pubblico (referente, survey, corso); nessun ruolo del workspace |
| `src/app/share/portfolio/[workspaceId]/[useCaseId]/page.tsx` | fuori dalla dashboard: token di condivisione; alla scheda vera solo i collaboratori (isCollaboratorRole), gli altri vedono la vista ridotta |

## Layout

| Layout | Decisione |
|---|---|
| `src/app/(auth)/layout.tsx` | nessun dato (involucro) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/layout.tsx` | APERTA a esterno_caso: il perimetro (caseOnlyRedirect per segmenti), la barra con una voce, la campanella sua; un ruolo sconosciuto 404 |
| `src/app/(dashboard)/dashboard/[workspaceId]/layout.tsx` | APERTA a esterno_caso: il perimetro (caseOnlyRedirect per segmenti), la barra con una voce, la campanella sua; un ruolo sconosciuto 404 |
| `src/app/(dashboard)/dashboard/[workspaceId]/learning/layout.tsx` | nessun dato (involucro) |
| `src/app/(dashboard)/dashboard/[workspaceId]/mapping/[deptId]/layout.tsx` | chiusa: requireWorkspacePage senza opzione |
| `src/app/(dashboard)/dashboard/[workspaceId]/mapping/layout.tsx` | nessun dato (involucro) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/layout.tsx` | nessun dato (involucro) |
| `src/app/(dashboard)/layout.tsx` | nessun dato (involucro) |
| `src/app/a/layout.tsx` | nessun dato (involucro) |
| `src/app/c/layout.tsx` | nessun dato (involucro) |
| `src/app/cli/layout.tsx` | nessun dato (involucro) |
| `src/app/invite/layout.tsx` | nessun dato (involucro) |
| `src/app/layout.tsx` | nessun dato (involucro) |
| `src/app/legal/layout.tsx` | nessun dato (involucro) |
| `src/app/privacy/layout.tsx` | nessun dato (involucro) |
| `src/app/r/layout.tsx` | nessun dato (involucro) |
| `src/app/rispondi/layout.tsx` | nessun dato (involucro) |
| `src/app/s/layout.tsx` | nessun dato (involucro) |

## Rotte

| Rotta | Decisione |
|---|---|
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/attivita/csv/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/avanzamento/route.ts` | nessun dato: vecchio indirizzo, 308 |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/documenti/route.ts` | nessun dato: vecchio indirizzo, 308 |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/export/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/files/[fileId]/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/files/upload-complete/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/files/upload-token/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/files/upload/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/kpi/route.ts` | nessun dato: vecchio indirizzo, 308 |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/mappa/route.ts` | nessun dato: vecchio indirizzo, 308 |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/modello-dati/route.ts` | nessun dato: vecchio indirizzo, 308 |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/registro/csv/route.ts` | nessun dato: vecchio indirizzo, 308 |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/registro/route.ts` | nessun dato: vecchio indirizzo, 308 |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/regole/route.ts` | nessun dato: vecchio indirizzo, 308 |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/roi/route.ts` | nessun dato: vecchio indirizzo, 308 |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/test-cases/import/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/verifica/route.ts` | nessun dato: vecchio indirizzo, 308 |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/voci/[itemId]/route.ts` | nessun dato: vecchio indirizzo, 308 |
| `src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/voci/route.ts` | nessun dato: vecchio indirizzo, 308 |
| `src/app/(dashboard)/dashboard/[workspaceId]/portfolio/export/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/allegati/[fileId]/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/allegati/upload-complete/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/allegati/upload-token/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/allegati/upload/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/da-compilare/[fileId]/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/da-compilare/upload-complete/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/da-compilare/upload-token/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/da-compilare/upload/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/ai-readiness/assessments/[assessmentId]/export/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/ai-readiness/assessments/[assessmentId]/questions-export/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/ai-readiness/respondents/[token]/anonymize/route.ts` | token del rispondente: nessun ruolo |
| `src/app/api/ai-readiness/respondents/[token]/benchmark-consent/route.ts` | token del rispondente: nessun ruolo |
| `src/app/api/ai-readiness/respondents/[token]/export/route.ts` | token del rispondente: nessun ruolo |
| `src/app/api/ai/chat/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/ai/classify/route.ts` | chiusa: runClassificationAction → getCollaboratorAccess senza opzione |
| `src/app/api/auth/session/route.ts` | sessione o OAuth della persona (Granola: contextActorForUser → getCollaboratorAccess, chiusa) |
| `src/app/api/ci/casi/route.ts` | chiave della CI (di un repository, non di una persona): nessun ruolo; esterno_caso non la crea mai (azioni chiuse) |
| `src/app/api/ci/evals/route.ts` | chiave della CI (di un repository, non di una persona): nessun ruolo; esterno_caso non la crea mai (azioni chiuse) |
| `src/app/api/cli/compiti/route.ts` | CLI: openCli (aperta a esterno_caso), poi resolveCliCase con il predicato: un caso fuori = 404 |
| `src/app/api/cli/contesto/route.ts` | CLI: openCli (aperta a esterno_caso), poi resolveCliCase con il predicato: un caso fuori = 404; a esterno_caso 403 «solo_questo_caso» (D7) |
| `src/app/api/cli/context/route.ts` | CLI: openCli (aperta a esterno_caso), poi resolveCliCase con il predicato: un caso fuori = 404; strato contesto solo fatti del caso (D7) |
| `src/app/api/cli/decisioni/route.ts` | CLI: openCli (aperta a esterno_caso), poi resolveCliCase con il predicato: un caso fuori = 404 |
| `src/app/api/cli/domande/route.ts` | CLI: openCli (aperta a esterno_caso), poi resolveCliCase con il predicato: un caso fuori = 404 |
| `src/app/api/cli/evals/route.ts` | CLI: openCli (aperta a esterno_caso), poi resolveCliCase con il predicato: un caso fuori = 404 |
| `src/app/api/cli/impara/route.ts` | CLI: openCli + predicato, poi la memoria del cliente per elenco (contextAbilities): chiusa a esterno_caso (D7) |
| `src/app/api/cli/login/route.ts` | CLI: login a codice (nessun accesso finché la conferma, l'azione aperta, non decide) |
| `src/app/api/cli/login/token/route.ts` | CLI: login a codice (nessun accesso finché la conferma, l'azione aperta, non decide) |
| `src/app/api/cli/logout/route.ts` | CLI: token della persona (authenticateCli) |
| `src/app/api/cli/mcp/route.ts` | CLI: openCli (aperta a esterno_caso), poi resolveCliCase con il predicato: un caso fuori = 404 |
| `src/app/api/cli/nota/route.ts` | CLI: openCli, poi solo Lateral Space (isCliLateralSpace, canAddNotes): chiusa a esterno_caso |
| `src/app/api/cli/pacchetto/route.ts` | CLI: openCli (aperta a esterno_caso), poi resolveCliCase con il predicato: un caso fuori = 404; CONTESTO.md ridotto ai fatti del caso (D7) |
| `src/app/api/cli/repository/route.ts` | CLI: openCli (aperta a esterno_caso), poi resolveCliCase con il predicato: un caso fuori = 404; solo il repository del suo caso (D4) |
| `src/app/api/cli/sessioni/route.ts` | CLI: openCli (aperta a esterno_caso), poi resolveCliCase con il predicato: un caso fuori = 404 |
| `src/app/api/cli/setup/route.ts` | CLI: openCli (aperta a esterno_caso), poi resolveCliCase con il predicato: un caso fuori = 404 |
| `src/app/api/cli/token-caso/route.ts` | CLI: openCli (aperta a esterno_caso), poi resolveCliCase con il predicato: un caso fuori = 404 |
| `src/app/api/cli/whoami/route.ts` | CLI: openCli (aperta a esterno_caso), nessun caso: il suo ruolo e il nome del workspace |
| `src/app/api/context/[workspaceId]/ask/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/context/[workspaceId]/consent/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/context/[workspaceId]/facts/[factId]/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/context/[workspaceId]/granola/sync/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/context/[workspaceId]/granola/unsorted/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/context/[workspaceId]/sources/[sourceId]/read/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/context/[workspaceId]/sources/[sourceId]/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/context/[workspaceId]/sources/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/cron/contesto/route.ts` | cron: segreto (CRON_SECRET) |
| `src/app/api/cron/slack-draft-nudge/route.ts` | cron: segreto (CRON_SECRET) |
| `src/app/api/cron/uc-freshness/route.ts` | cron: segreto (CRON_SECRET) |
| `src/app/api/cron/uc-reminders/route.ts` | cron: segreto (CRON_SECRET) |
| `src/app/api/cron/use-case-referents/route.ts` | cron: segreto (CRON_SECRET) |
| `src/app/api/cron/weekly-pulse/route.ts` | cron: segreto (CRON_SECRET) |
| `src/app/api/documents/upload/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/github/webhook/route.ts` | webhook o installazione: firma, o membership dell'organizzazione |
| `src/app/api/granola/callback/route.ts` | sessione o OAuth della persona (Granola: contextActorForUser → getCollaboratorAccess, chiusa) |
| `src/app/api/granola/client-metadata/route.ts` | sessione o OAuth della persona (Granola: contextActorForUser → getCollaboratorAccess, chiusa) |
| `src/app/api/learning/admin/route.ts` | Formazione: porta della Formazione per elenco (collaboratori e learner; mai esterno_caso) |
| `src/app/api/learning/materials/[materialId]/route.ts` | Formazione: porta della Formazione per elenco (collaboratori e learner; mai esterno_caso) |
| `src/app/api/learning/materials/route.ts` | Formazione: porta della Formazione per elenco (collaboratori e learner; mai esterno_caso) |
| `src/app/api/learning/register/route.ts` | Formazione: porta della Formazione per elenco (collaboratori e learner; mai esterno_caso) |
| `src/app/api/learning/route.ts` | Formazione: porta della Formazione per elenco (collaboratori e learner; mai esterno_caso) |
| `src/app/api/learning/session/route.ts` | Formazione: porta della Formazione per elenco (collaboratori e learner; mai esterno_caso) |
| `src/app/api/mcp/casi/cases/[caseId]/catalog/route.ts` | MCP dei dossier: token al portatore creato solo da ls_lead di Lateral Space; nessuna persona: chiusa a esterno_caso (non lo crea) |
| `src/app/api/mcp/casi/cases/[caseId]/dictionary/route.ts` | MCP dei dossier: token al portatore creato solo da ls_lead di Lateral Space; nessuna persona: chiusa a esterno_caso (non lo crea) |
| `src/app/api/mcp/casi/cases/[caseId]/gate/route.ts` | MCP dei dossier: token al portatore creato solo da ls_lead di Lateral Space; nessuna persona: chiusa a esterno_caso (non lo crea) |
| `src/app/api/mcp/casi/cases/[caseId]/open-items/route.ts` | MCP dei dossier: token al portatore creato solo da ls_lead di Lateral Space; nessuna persona: chiusa a esterno_caso (non lo crea) |
| `src/app/api/mcp/casi/cases/route.ts` | MCP dei dossier: token al portatore creato solo da ls_lead di Lateral Space; nessuna persona: chiusa a esterno_caso (non lo crea) |
| `src/app/api/mcp/casi/server/route.ts` | MCP dei dossier: token al portatore creato solo da ls_lead di Lateral Space; nessuna persona: chiusa a esterno_caso (non lo crea) |
| `src/app/api/mcp/casi/skill/route.ts` | MCP dei dossier: token al portatore creato solo da ls_lead di Lateral Space; nessuna persona: chiusa a esterno_caso (non lo crea) |
| `src/app/api/mcp/connettore/[slug]/route.ts` | connettore: token dell'organizzazione (gestori): chiusa a esterno_caso (non lo crea) |
| `src/app/api/mcp/portfolio/requirements/route.ts` | MCP del portafoglio: token dell'organizzazione (gestori): chiusa a esterno_caso (non lo crea) |
| `src/app/api/mcp/portfolio/server/route.ts` | MCP del portafoglio: token dell'organizzazione (gestori): chiusa a esterno_caso (non lo crea) |
| `src/app/api/mcp/portfolio/skill/route.ts` | MCP del portafoglio: token dell'organizzazione (gestori): chiusa a esterno_caso (non lo crea) |
| `src/app/api/mcp/portfolio/submissions/route.ts` | MCP del portafoglio: token dell'organizzazione (gestori): chiusa a esterno_caso (non lo crea) |
| `src/app/api/mcp/use-case/route.ts` | MCP del team: token di un revisore; ruolo riletto a ogni richiesta (getCollaboratorAccess + canUseTeamMcp): chiusa |
| `src/app/api/r/[token]/answers/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/r/[token]/approve/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/r/[token]/delegate/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/r/[token]/items/[itemId]/answer/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/r/[token]/items/[itemId]/draft/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/r/[token]/items/[itemId]/template.xlsx/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/r/[token]/opened/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/r/[token]/privacy-ack/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/r/[token]/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/r/[token]/upload-complete/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/r/[token]/upload-table/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/r/[token]/upload-token/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/r/[token]/upload/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/add/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/check/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/da-compilare/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/doubt/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/draft/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/edit/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/file-confirm/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/file-remove/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/privacy/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/reply/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/seen/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/submit/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/upload-complete/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/upload-token/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/rispondi/[token]/upload/route.ts` | token pubblico del referente (uc_contacts): nessun ruolo del workspace; esterno_caso mai referente (referente_costruttore) |
| `src/app/api/slack/events/route.ts` | webhook o installazione: firma, o membership dell'organizzazione |
| `src/app/api/slack/install/route.ts` | webhook o installazione: firma, o membership dell'organizzazione |
| `src/app/api/slack/interactivity/route.ts` | webhook o installazione: firma, o membership dell'organizzazione |
| `src/app/api/slack/oauth/route.ts` | webhook o installazione: firma, o membership dell'organizzazione |
| `src/app/api/slack/webhooks/route.ts` | webhook o installazione: firma, o membership dell'organizzazione |
| `src/app/api/workspaces/[workspaceId]/account/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/workspaces/[workspaceId]/bell/route.ts` | APERTA a esterno_caso (allowCaseOnly): solo le sue righe |
| `src/app/api/workspaces/[workspaceId]/mapping/[deptId]/board/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/workspaces/[workspaceId]/mapping/[deptId]/complete/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/workspaces/[workspaceId]/programma/sal/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/workspaces/[workspaceId]/sidebar-data/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/workspaces/[workspaceId]/use-cases/[useCaseId]/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/workspaces/[workspaceId]/use-cases/[useCaseId]/scores/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/workspaces/[workspaceId]/use-cases/[useCaseId]/status/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/workspaces/[workspaceId]/use-cases/[useCaseId]/wave/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/api/workspaces/[workspaceId]/use-cases/route.ts` | chiusa: porta senza opzione (requireWorkspaceAccess / getCollaboratorAccess / aiuto che la usa) |
| `src/app/install/slack/route.ts` | webhook o installazione: firma, o membership dell'organizzazione |
| `src/app/llms-full.txt/route.ts` | statica |
| `src/app/llms.txt/route.ts` | statica |

## Server action

| Azione | Decisione |
|---|---|
| `src/lib/actions/ai-readiness.ts :: createAiReadinessAssessmentAction` | chiusa: porta senza opzione |
| `src/lib/actions/ai-readiness.ts :: updateAiReadinessAssessmentStatusAction` | chiusa: porta senza opzione |
| `src/lib/actions/ai-readiness.ts :: deleteAiReadinessAssessmentAction` | chiusa: porta senza opzione |
| `src/lib/actions/ai-readiness.ts :: updateAiReadinessThresholdAction` | chiusa: porta senza opzione |
| `src/lib/actions/ai-readiness.ts :: customizeAssessmentQuestionAction` | chiusa: porta senza opzione |
| `src/lib/actions/ai-readiness.ts :: generateAiReadinessOpenLinkAction` | chiusa: porta senza opzione |
| `src/lib/actions/ai-readiness.ts :: startOpenSurveyAction` | token pubblico del rispondente: nessun ruolo |
| `src/lib/actions/ai-readiness.ts :: createAiReadinessRespondentInviteAction` | chiusa: porta senza opzione |
| `src/lib/actions/ai-readiness.ts :: submitUseCaseExpertCaseAction` | token pubblico del rispondente: nessun ruolo |
| `src/lib/actions/ai-readiness.ts :: finishUseCaseExpertAction` | token pubblico del rispondente: nessun ruolo |
| `src/lib/actions/ai-readiness.ts :: saveAiReadinessSurveyDraftAction` | token pubblico del rispondente: nessun ruolo |
| `src/lib/actions/ai-readiness.ts :: submitAiReadinessResponseAction` | token pubblico del rispondente: nessun ruolo |
| `src/lib/actions/ai-readiness.ts :: recomputeAiReadinessScoresAction` | chiusa: porta senza opzione |
| `src/lib/actions/ai-readiness.ts :: generateAiReadinessInsightsAction` | chiusa: porta senza opzione |
| `src/lib/actions/ai-readiness.ts :: updateAiReadinessInsightStatusAction` | chiusa: porta senza opzione |
| `src/lib/actions/ai-readiness.ts :: promoteAiReadinessUseCaseToPortfolioAction` | chiusa: porta senza opzione |
| `src/lib/actions/ai-readiness.ts :: withdrawAiReadinessBenchmarkConsentAction` | token pubblico del rispondente: nessun ruolo |
| `src/lib/actions/ai-readiness.ts :: anonymizeAiReadinessRespondentAction` | token pubblico del rispondente: nessun ruolo |
| `src/lib/actions/blueprints.ts :: generateBlueprintsAction` | chiusa: porta senza opzione |
| `src/lib/actions/blueprints.ts :: getLatestBlueprints` | chiusa: porta senza opzione |
| `src/lib/actions/ci-keys.ts :: createCiKeyAction` | chiusa: porta senza opzione |
| `src/lib/actions/ci-keys.ts :: rotateCiKeyAction` | chiusa: porta senza opzione |
| `src/lib/actions/ci-keys.ts :: revokeCiKeyAction` | chiusa: porta senza opzione |
| `src/lib/actions/classify.ts :: runClassificationAction` | chiusa: porta senza opzione |
| `src/lib/actions/cli-login.ts :: confirmCliLoginAction` | APERTA a esterno_caso (allowCaseOnly): solo cose sue |
| `src/lib/actions/cli-login.ts :: denyCliLoginAction` | solo la sessione, nessun workspace: annulla un codice della CLI |
| `src/lib/actions/cli-tokens.ts :: revokeOwnCliTokenAction` | APERTA a esterno_caso (allowCaseOnly): solo cose sue |
| `src/lib/actions/connector-settings.ts :: setConnectorEnabledAction` | chiusa: porta senza opzione |
| `src/lib/actions/connector-settings.ts :: createConnectorTokenAction` | chiusa: porta senza opzione |
| `src/lib/actions/connector-settings.ts :: revokeConnectorTokenAction` | chiusa: porta senza opzione |
| `src/lib/actions/context-granola.ts :: startGranolaConnectAction` | chiusa: porta senza opzione |
| `src/lib/actions/context-granola.ts :: disconnectGranolaAction` | chiusa: porta senza opzione |
| `src/lib/actions/context-granola.ts :: saveGranolaRulesAction` | chiusa: porta senza opzione |
| `src/lib/actions/context-granola.ts :: listGranolaFoldersAction` | chiusa: porta senza opzione |
| `src/lib/actions/context-granola.ts :: assignGranolaMeetingAction` | chiusa: porta senza opzione |
| `src/lib/actions/context-granola.ts :: leaveOutGranolaMeetingsAction` | chiusa: porta senza opzione |
| `src/lib/actions/context-people.ts :: searchPersonAction` | chiusa: porta senza opzione |
| `src/lib/actions/context-people.ts :: erasePersonAction` | chiusa: porta senza opzione |
| `src/lib/actions/context-work.ts :: closeNeedFromCallAction` | chiusa: porta senza opzione |
| `src/lib/actions/context-work.ts :: dismissNeedLinkAction` | chiusa: porta senza opzione |
| `src/lib/actions/context-work.ts :: reconfirmFactsAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: confirmProposalsAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: editProposalAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: discardProposalsAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: writeFactAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: editFactAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: reconfirmFactAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: retireFactAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: closeCommitmentAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: reopenCommitmentAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: closeQuestionAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: addQuestionAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: removeSourceAction` | chiusa: porta senza opzione |
| `src/lib/actions/context.ts :: setDocumentVisibilityAction` | chiusa: porta senza opzione |
| `src/lib/actions/intelligence.ts :: markSignalAsRead` | chiusa: porta senza opzione |
| `src/lib/actions/intelligence.ts :: markAllSignalsRead` | chiusa: porta senza opzione |
| `src/lib/actions/intelligence.ts :: generateCompetitiveAnalysis` | chiusa: porta senza opzione |
| `src/lib/actions/learning-ideas.ts :: saveLearningIdea` | chiusa: porta della Formazione per elenco |
| `src/lib/actions/learning-ideas.ts :: submitLearningIdea` | chiusa: porta della Formazione per elenco |
| `src/lib/actions/learning-join.ts :: joinCourseByLinkAction` | token del corso: scrive learner, mai cambia un esterno_caso; la Formazione poi lo chiude |
| `src/lib/actions/learning-join.ts :: requestCohortReopenAction` | token del corso: scrive learner, mai cambia un esterno_caso; la Formazione poi lo chiude |
| `src/lib/actions/learning.ts :: startLearningAttempt` | chiusa: porta della Formazione per elenco |
| `src/lib/actions/learning.ts :: saveLearningDraft` | chiusa: porta della Formazione per elenco |
| `src/lib/actions/learning.ts :: submitLearningAttempt` | chiusa: porta della Formazione per elenco |
| `src/lib/actions/learning.ts :: startLearningRetake` | chiusa: porta della Formazione per elenco |
| `src/lib/actions/learning.ts :: exportLearningCsv` | chiusa: porta della Formazione per elenco |
| `src/lib/actions/learning.ts :: submitLearningDecisions` | chiusa: porta della Formazione per elenco |
| `src/lib/actions/notifications.ts :: markAllBellReadAction` | APERTA a esterno_caso (allowCaseOnly): solo cose sue |
| `src/lib/actions/notifications.ts :: setBellEmailAlertsAction` | chiusa: porta senza opzione |
| `src/lib/actions/onet.ts :: runOnetMatchingAction` | chiusa: porta senza opzione |
| `src/lib/actions/portfolio.ts :: updateAiTransformationTeamNameAction` | chiusa: porta senza opzione |
| `src/lib/actions/portfolio.ts :: updateWhatsappWebhookAction` | chiusa: porta senza opzione |
| `src/lib/actions/portfolio.ts :: updateScoringModelAction` | chiusa: porta senza opzione |
| `src/lib/actions/portfolio.ts :: createPortfolioSubmissionAction` | chiusa: porta senza opzione |
| `src/lib/actions/portfolio.ts :: savePortfolioReviewAction` | chiusa: porta senza opzione |
| `src/lib/actions/portfolio.ts :: suggestPortfolioScoresWithAiAction` | chiusa: porta senza opzione |
| `src/lib/actions/portfolio.ts :: recalibratePortfolioScoresAction` | chiusa: porta senza opzione |
| `src/lib/actions/pre-generate-activities.ts :: preGenerateActivitiesFromDocuments` | chiusa: porta senza opzione |
| `src/lib/actions/pre-generate-activities.ts :: confirmPreGeneratedActivities` | chiusa: porta senza opzione |
| `src/lib/actions/reports.ts :: generateReportAction` | chiusa: porta senza opzione |
| `src/lib/actions/simulation.ts :: generateSimulationAction` | chiusa: porta senza opzione |
| `src/lib/actions/simulation.ts :: getLatestSimulation` | chiusa: porta senza opzione |
| `src/lib/actions/slack-settings.ts :: setSlackNotifyChannelAction` | chiusa: porta senza opzione |
| `src/lib/actions/strategy.ts :: createGoalAction` | chiusa: porta senza opzione |
| `src/lib/actions/strategy.ts :: suggestOKRsAction` | chiusa: porta senza opzione |
| `src/lib/actions/team-mcp-tokens.ts :: createTeamMcpTokenAction` | chiusa: porta senza opzione |
| `src/lib/actions/team-mcp-tokens.ts :: revokeTeamMcpTokenAction` | chiusa: porta senza opzione |
| `src/lib/actions/team-mcp-tokens.ts :: revokeAllTeamMcpTokensAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-approvals.ts :: decideApprovalAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-approvals.ts :: loadApprovalsAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-cases.ts :: updateCaseSettingsAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-cases.ts :: transitionCaseAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-cases.ts :: addMemberAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-cases.ts :: removeMemberAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-cases.ts :: proposePersonalZoneAccessAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-cases.ts :: signPersonalZoneAccessAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-cases.ts :: revokePersonalZoneAccessAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-cases.ts :: setOwnerContactAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-cases.ts :: setPrivacyApproverContactAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-cases.ts :: updateRoiAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog-selection.ts :: selectCatalogItemsAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: setItemsDueAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: transitionItemsAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: validateItemAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: requestClarificationAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: markPartialAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: markMissingAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: proposeNaAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: signNaAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: rejectNaAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: proposeWaiverAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: signWaiverAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: proposeFallbackAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: signFallbackAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: reopenItemAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: recordLsAnswerAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: addCommentAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-catalog.ts :: resolveCommentAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-files.ts :: reviewQuarantinedFileAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-files.ts :: deleteFileAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-files.ts :: createDatasetAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-files.ts :: validateDatasetAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-gates.ts :: proposeGateAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-gates.ts :: signGateAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-gates.ts :: rejectGateAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-gates.ts :: resolveBlockerAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-gates.ts :: reactivateBlockerAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-integrations.ts :: proposedCaseAccessLabelAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-integrations.ts :: createCaseReadTokenAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-integrations.ts :: revokeCaseReadTokenAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-notifications.ts :: markUcNotificationReadAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-notifications.ts :: markAllUcNotificationsReadAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: createContactAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: updateContactAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: anonymizeContactAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: assignItemsAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: assignRoleQuestionsAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: reassignContactQuestionsAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: previewRequestsAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: sendRequestAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: sendRequestsAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: requestConfirmationAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: copyRequestLinkAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: revokeRequestAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: revokeAllLinksAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: approveDelegationAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: extendExpiryAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-people.ts :: requestApprovalAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-realization.ts :: startRealizationAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-shell.ts :: updateDescriptionBlockAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-subprocessors.ts :: declareSubprocessorsAction` | chiusa: porta senza opzione |
| `src/lib/actions/uc-value.ts :: saveRoiAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-agent-questions.ts :: addAgentQuestionAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-agent-questions.ts :: dismissAgentQuestionAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-create.ts :: createQuickUseCaseAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-create.ts :: createUseCaseFromFormAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-create.ts :: proposeFromActivityMappingAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-decisions.ts :: decideUseCaseAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-decisions.ts :: setWhenAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-decisions.ts :: setHiddenFromSearchAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-decisions.ts :: markRealizationAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-decisions.ts :: savePublicNoteAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-decisions.ts :: answerInfoRequestAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-edit.ts :: updateUseCaseFieldAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-edit.ts :: saveValuationAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-edit.ts :: requestAiSuggestionAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-edit.ts :: redactTextAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-factory.ts :: generatePackageAction` | APERTA a esterno_caso (allowCaseOnly), poi il predicato per il caso |
| `src/lib/actions/use-case-factory.ts :: decideTaskProposalAction` | APERTA a esterno_caso (allowCaseOnly), poi il predicato per il caso |
| `src/lib/actions/use-case-factory.ts :: startProjectAction` | APERTA a esterno_caso (allowCaseOnly), poi il predicato per il caso |
| `src/lib/actions/use-case-factory.ts :: saveProjectTopicAction` | APERTA a esterno_caso (allowCaseOnly), poi il predicato per il caso |
| `src/lib/actions/use-case-factory.ts :: saveProjectDetailsAction` | APERTA a esterno_caso (allowCaseOnly), poi il predicato per il caso |
| `src/lib/actions/use-case-factory.ts :: submitProjectAction` | APERTA a esterno_caso (allowCaseOnly), poi il predicato per il caso |
| `src/lib/actions/use-case-factory.ts :: reopenProjectAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-factory.ts :: requestProjectChangeAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-factory.ts :: recordAiBoardOkAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-factory.ts :: approveProjectAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-factory.ts :: addDecisionAction` | APERTA a esterno_caso (allowCaseOnly), poi il predicato per il caso |
| `src/lib/actions/use-case-needs.ts :: createNeedAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-needs.ts :: updateNeedAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-needs.ts :: archiveNeedAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-needs.ts :: linkNeedAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-needs.ts :: unlinkNeedAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: saveCompanyFactsAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: saveLsCostsAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: saveCaseDevAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: saveIndexWeightsAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: saveLeadershipAsksAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: closeSalAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: activateKpiAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: addCustomKpiAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: updateKpiTargetsAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: removeKpiAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: recordKpiValueAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: setKeyResultBaseAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: addKeyResultCheckinAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-program.ts :: linkUseCaseToKeyResultAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: prepareReferentQuestionsAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: sendReferentRequestAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: adoptReferentEstimateAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: keepTeamEstimateAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: adoptReferentBenefitAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: keepReferentBenefitAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: markCorrectionDoneAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: addToReferentRequestAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: remindReferentRequestAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: revokeReferentRequestAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: retryReferentRequestEmailAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: revealReferentContactEmailAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: listReferentPeopleAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: revealReferentMemberEmailAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: correctReferentEmailAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: eraseReferentDataAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: addNeedAnswerAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: removeNeedAnswerAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: deleteNeedFileAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: reviewNeedFileAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: removeTemplateFileAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: reviewTemplateFileAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: askReferentClarificationAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: answerReferentDoubtAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: markReferentMessageDoneAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-referents.ts :: dismissReferentSuggestionAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-settings.ts :: saveReviewTeamNameAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-settings.ts :: saveCodePrefixAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-settings.ts :: saveThresholdsAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-settings.ts :: saveCostBandsAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-settings.ts :: saveValueParamsAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-settings.ts :: saveValuationModelAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-workspace-team.ts :: addBuilderAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-case-workspace-team.ts :: removeBuilderAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-cases.ts :: generateUseCasesAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-cases.ts :: toggleEsgAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-cases.ts :: setUseCaseStatusAction` | chiusa: porta senza opzione |
| `src/lib/actions/use-cases.ts :: setUseCaseWaveCategoryAction` | chiusa: porta senza opzione |
| `src/lib/actions/value-map.ts :: generateValueMapAction` | chiusa: porta senza opzione |
| `src/lib/actions/workspace-collaboration.ts :: createWorkspaceInvitationAction` | chiusa: porta senza opzione |
| `src/lib/actions/workspace-collaboration.ts :: revokeWorkspaceInvitationAction` | chiusa: porta senza opzione |
| `src/lib/actions/workspace-collaboration.ts :: recreateWorkspaceInvitationAction` | chiusa: porta senza opzione |
| `src/lib/actions/workspace-collaboration.ts :: updateWorkspaceMemberRoleAction` | chiusa: porta senza opzione |
| `src/lib/actions/workspace-collaboration.ts :: removeWorkspaceMemberAction` | chiusa: porta senza opzione |
| `src/lib/actions/workspace-collaboration.ts :: acceptWorkspaceInvitationAction` | token dell'invito: decideInviteAcceptance (esterno_caso solo con il suo invito, membership e concessione insieme) |
| `src/lib/actions/workspace-collaboration.ts :: disablePortfolioShareLinksAction` | chiusa: porta senza opzione |
| `src/lib/actions/workspace-integrations.ts :: createClaudeMcpTokenAction` | chiusa: porta senza opzione |
| `src/lib/actions/workspace-integrations.ts :: revokeClaudeMcpTokenAction` | chiusa: porta senza opzione |
| `src/lib/actions/workspace.ts :: createWorkspaceWithTeamAction` | organizzazione: getUserMembership (esterno_caso mai nell'organizzazione) |
| `src/lib/actions/workspace.ts :: deleteWorkspaceAction` | organizzazione: getUserMembership (esterno_caso mai nell'organizzazione) |

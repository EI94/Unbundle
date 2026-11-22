/**
 * «Solo questo use case» (rilascio 8.0d-1 «Porte», docs/rilascio-8/RILASCIO-8.0d-ESTERNI-FASE-2.md §2.5, §2.6): i nomi
 * comuni del ruolo `esterno_caso` e la regola delle porte del workspace, chiuse per default e aperte per elenco.
 *
 * - **Il ruolo** (`CASE_ONLY_ROLE`): un valore di `member_role`, solo in `workspace_memberships` e
 *   `workspace_invitations`, mai nell'organizzazione. Dà il perimetro: una voce nella barra, l'Agent Factory, il progetto
 *   dei suoi casi. Il potere di scrivere viene dalla concessione per quel caso (0037) e dal predicato della 8.0c
 *   (`use-case-builders.ts`), mai dal ruolo da solo.
 * - **Le porte** (`workspaceDoor`): senza opzioni passano solo i cinque ruoli da collaboratore (`COLLABORATOR_ROLES`).
 *   `learner` passa solo dove la porta lo dichiara (`allowLearner`), `esterno_caso` solo dove la porta lo dichiara
 *   (`allowCaseOnly`), un ruolo che il codice non conosce mai. Le porte che lo dichiarano sono un elenco fisso,
 *   `CASE_ONLY_SURFACES`, che la prova di guardia tiene fermo (src/lib/auth/case-only-guard.test.ts).
 * - **Il perimetro** (`caseOnlyRedirect`): dentro il workspace solo `agent-factory` e `casi-duso/<id>/costruzione`
 *   (rilascio 10: «Progetto dell'agente» è la Costruzione, con la sua «Qualità»), più l'indirizzo breve del progetto che
 *   usano la campanella e la CLI (`use-cases/<id>/progetto`), confrontati per segmenti come `isWithinLearnerScope`. Fuori
 *   si torna all'Agent Factory, come chi segue un corso torna alla Formazione.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { LEARNER_ROLE } from "../learning/learner-scope.ts";
import { isCollaboratorRole } from "../workspace-permissions.ts";

/**
 * Chi segue solo un corso, per i moduli che non devono importare la Formazione (i referenti, la campanella): lo stesso
 * `isLearnerOnly` di src/lib/learning/learner-scope.ts.
 */
export { LEARNER_ROLE, isLearnerOnly } from "../learning/learner-scope.ts";

/** Il ruolo nel workspace di chi costruisce un solo use case, da un'altra azienda o dall'IT del cliente. */
export const CASE_ONLY_ROLE = "esterno_caso" as const;
export type CaseOnlyRole = typeof CASE_ONLY_ROLE;

/** True quando l'unico titolo d'accesso al workspace è costruire un solo use case. */
export function isCaseOnly(role: string | null | undefined): boolean {
  return role === CASE_ONLY_ROLE;
}

/** Le opzioni di una porta del workspace: chi, oltre ai cinque collaboratori, può passare. */
export interface WorkspaceDoorOptions {
  /** Chi segue solo un corso (`learner`): solo la Formazione lo dichiara. */
  allowLearner?: boolean;
  /** «Solo questo use case» (`esterno_caso`): solo le porte di `CASE_ONLY_SURFACES` lo dichiarano. */
  allowCaseOnly?: boolean;
}

/**
 * Che cosa fa una porta del workspace con un ruolo:
 * - `aperta`: passa (un collaboratore, o un ruolo che la porta dichiara);
 * - `formazione`: chi segue solo un corso, dove la porta non lo dichiara (le pagine lo riportano alla Formazione);
 * - `solo_caso`: «Solo questo use case», dove la porta non lo dichiara (le pagine lo riportano all'Agent Factory);
 * - `chiusa`: un ruolo che il codice non conosce, o nessun ruolo (le pagine rispondono 404).
 */
export type WorkspaceDoorVerdict = "aperta" | "formazione" | "solo_caso" | "chiusa";

export function workspaceDoor(role: string | null | undefined, opts: WorkspaceDoorOptions = {}): WorkspaceDoorVerdict {
  if (isCollaboratorRole(role)) return "aperta";
  if (role === LEARNER_ROLE) return opts.allowLearner === true ? "aperta" : "formazione";
  if (isCaseOnly(role)) return opts.allowCaseOnly === true ? "aperta" : "solo_caso";
  return "chiusa";
}

/** Radice consentita a «Solo questo use case» dentro un workspace: l'Agent Factory. */
export function caseOnlyHomePath(workspaceId: string): string {
  return `/dashboard/${workspaceId}/agent-factory`;
}

/**
 * Il percorso richiesto è dentro il perimetro di «Solo questo use case»? Confronta sui segmenti, mai con `startsWith`:
 * `agent-factory-x`, `casi-duso/<id>`, `casi-duso/<id>/costruzione/altro` stanno fuori. Dentro solo:
 * - `/dashboard/<ws>/agent-factory`;
 * - `/dashboard/<ws>/casi-duso/<id>/costruzione` (il guscio del dossier con la sola Costruzione, «Progetto dell'agente»
 *   della specifica: scelte, decisioni, compiti, «Qualità» con evals e banco, pacchetto);
 * - `/dashboard/<ws>/use-cases/<id>/progetto`, l'indirizzo breve del progetto che usano la campanella e la CLI: porta
 *   alla Costruzione del dossier, e la pagina ricontrolla il predicato prima di portarci.
 * `casi-duso/<id>/progetto` (rilascio 10, ondata 5b) è una rotta: un 308 verso la Costruzione che non legge il database
 * e non passa dai layout (`route.md`). Qui sta fuori, come le schede che ha preso il posto.
 * Le pagine ricontrollano da sé (`requireWorkspacePage` con `allowCaseOnly`, poi il predicato per il caso): il perimetro
 * dice dove si può andare, non che cosa si vede.
 */
export function isWithinCaseOnlyScope(pathname: string, workspaceId: string): boolean {
  const segments = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (segments[0] !== "dashboard" || segments[1] !== workspaceId) return false;
  if (segments.length === 3) return segments[2] === "agent-factory";
  if (segments.length === 5) {
    return (segments[2] === "casi-duso" && segments[4] === "costruzione") || (segments[2] === "use-cases" && segments[4] === "progetto");
  }
  return false;
}

/**
 * (Rilascio 10) «Il tuo account» aperto su «Claude e terminale» sull'Agent Factory, la casa di «Solo questo use case»:
 * la sola parte del foglio che vede (i collegamenti della sua CLI). La Home, dove il foglio si apre per gli altri, sta
 * fuori dal perimetro. Lo stesso indirizzo di `withAccount(caseOnlyHomePath(…), "claude")` (src/lib/shell/account.ts).
 */
export function caseOnlyAccountPath(workspaceId: string): string {
  return `${caseOnlyHomePath(workspaceId)}?account=claude`;
}

/**
 * Dove mandare «Solo questo use case» che ha chiesto un percorso fuori dal suo perimetro. null quando il ruolo non è
 * `esterno_caso` o il percorso è legittimo. `/dashboard/<ws>/account`, l'indirizzo delle e-mail «CLI collegata», porta
 * all'Agent Factory con il foglio aperto su «Claude e terminale» (la pagina dell'account resta fuori dal perimetro).
 */
export function caseOnlyRedirect(params: { role: string | null | undefined; pathname: string; workspaceId: string }): string | null {
  if (!isCaseOnly(params.role)) return null;
  if (isWithinCaseOnlyScope(params.pathname, params.workspaceId)) return null;
  const segments = params.pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (segments.length === 3 && segments[0] === "dashboard" && segments[1] === params.workspaceId && segments[2] === "account") {
    return caseOnlyAccountPath(params.workspaceId);
  }
  return caseOnlyHomePath(params.workspaceId);
}

/**
 * Le porte che aprono a `esterno_caso` (`allowCaseOnly: true`), e nient'altro: ogni file qui dichiara l'opzione, e
 * nessun altro file la dichiara (la prova di guardia). Una pagina, una rotta o un'azione nuova è chiusa a
 * «Solo questo use case» finché non entra qui, con una revisione delle porte.
 * - Il layout del workspace (il perimetro: `caseOnlyRedirect`, la barra con una voce, la campanella).
 * - Pagine: l'Agent Factory, il guscio del dossier (solo la testata e la Costruzione), la Costruzione («Progetto
 *   dell'agente» della specifica, con la sua «Qualità»: rilascio 10, ondata 5b) e l'indirizzo breve del progetto
 *   (campanella, CLI). Fuori dalla dashboard: «Collega questa CLI» e la sua scelta del workspace.
 * - La campanella (la rotta, e «Segna tutte come lette» della barra in alto): solo i tipi di chi costruisce, dei suoi casi.
 * - «Il tuo account» (la rotta del foglio, rilascio 10): solo «Claude e terminale», con i collegamenti della sua CLI
 *   («CLI collegata · Scollega»); niente del workspace.
 * - Le azioni: le 7 di chi costruisce (`use-case-factory.ts`), la conferma della CLI (`cli-login.ts`), «Scollega»
 *   (`cli-tokens.ts`).
 * - La CLI e l'MCP del caso: `openCli` (`route-kit.ts`); ogni caso poi vuole il predicato (`resolveCliCase`).
 */
export const CASE_ONLY_SURFACES: readonly string[] = Object.freeze([
  "src/app/(dashboard)/dashboard/[workspaceId]/layout.tsx",
  "src/app/(dashboard)/dashboard/[workspaceId]/agent-factory/page.tsx",
  "src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/layout.tsx",
  "src/app/(dashboard)/dashboard/[workspaceId]/casi-duso/[caseId]/costruzione/page.tsx",
  "src/app/(dashboard)/dashboard/[workspaceId]/use-cases/[useCaseId]/progetto/page.tsx",
  "src/app/api/workspaces/[workspaceId]/bell/route.ts",
  "src/app/api/workspaces/[workspaceId]/account/route.ts",
  "src/lib/actions/notifications.ts",
  "src/lib/actions/use-case-factory.ts",
  "src/lib/actions/cli-login.ts",
  "src/lib/actions/cli-tokens.ts",
  "src/lib/use-cases/cli/route-kit.ts",
  "src/app/cli/collega/page.tsx",
  "src/lib/use-cases/cli/workspace-choices.ts",
]);

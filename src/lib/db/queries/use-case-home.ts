import "server-only";
/**
 * La Home sul database (rilascio 10, ondata 2b; docs/ui-10/PROPOSTA-10.md §3.3): quello che serve a
 * `reviewerHome` e `contributorHome` (src/lib/home/view.ts), letto una volta per chi guarda.
 *
 * - **Revisori**: la pagina del Programma (`loadProgramPage`, con le schede dei revisori), le esigenze di «Cosa
 *   serve», l'ok sui fornitori dove «Chiedi al referente» è acceso e, solo in un workspace nuovo, i fatti di «Per
 *   partire». Con l'area «Use case» spenta, solo «Per partire». (Rilascio 10) In più, prima sulla Panoramica: il
 *   valore da misurare all'anno («Tutti i numeri») e «Chi propone, per area» (il pannello «Persone»).
 * - **Contributori**: i propri use case (la proiezione del contributore: titolo, fase e, dei propri, il codice), la
 *   partecipazione per area (numeri per area, mai chi propone) e i corsi che seguono.
 *
 * L'ok sui fornitori lo legge `supplierState`, lo stesso della Panoramica (use-case-workspace-step.ts). Ogni lettura
 * che non riesce lascia fuori la sua regola, mai la pagina. Art. 15.4: conteggi e aggregati, mai una persona.
 */
import type { Workspace } from "@/lib/db/schema";
import { contextHasCallNotes } from "@/lib/db/queries/context-home";
import { getPortfolioParticipation } from "@/lib/db/queries/portfolio-participation";
import { listHubItems, viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { listWorkspaceNeeds } from "@/lib/db/queries/use-case-needs";
import { loadProgramPage } from "@/lib/db/queries/use-case-program";
import { supplierState } from "@/lib/db/queries/use-case-workspace-step";
import { getUseCaseCountByWorkspace } from "@/lib/db/queries/use-cases";
import { getDepartmentsByWorkspace, getStrategicGoalsByWorkspace } from "@/lib/db/queries/workspaces";
import { logSafeError } from "@/lib/log/safe-error";
import type { StartFacts } from "@/lib/home/start";
import { contributorRows, courseRows, reviewerHome, type ContributorRow, type CourseRow, type ReviewerHome } from "@/lib/home/view";
import type { Participation } from "@/lib/portfolio/participation";
import type { ProgramView } from "@/lib/programma/view";
import { fullFormPath } from "@/lib/use-cases/create";
import { abilitiesForUseCase } from "@/lib/use-cases/permissions";
import { romeToday } from "@/lib/use-cases/quarter";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { decideCount, pendingValueTotal, type HubItem, type PendingValueTotal } from "@/lib/use-cases/views";
import { getUnitTerm } from "@/lib/utils/unit-terminology";

const LOG_SCOPE = "home";

/** Chi guarda, come lo dà la sessione. */
export interface HomeViewer {
  id: string;
  email: string;
  emailVerified: boolean;
}

export interface ReviewerHomeData {
  kind: "revisore";
  workspaceId: string;
  companyName: string;
  /** La descrizione del workspace (dalla creazione), sotto il titolo; null senza. */
  description: string | null;
  home: ReviewerHome;
  /** La pagina del Programma, per i pannelli; null con l'area spenta o senza la 0029. */
  program: ProgramView | null;
  /** `spento`: area «Use case» spenta; `non_pronto`: manca la 0029. */
  programState: "ok" | "non_pronto" | "spento";
  /** (Rilascio 10) «Valore da misurare all'anno» di «Tutti i numeri» (`pendingValueTotal`); null senza o senza Programma. */
  pendingValue: PendingValueTotal | null;
  /** (Rilascio 10) «Chi propone, per area» del pannello «Persone»: numeri per area, mai chi propone; null senza. */
  participation: Participation | null;
}

export interface ContributorHomeData {
  kind: "contributore";
  workspaceId: string;
  /** La descrizione del workspace, sotto il titolo; null senza. */
  description: string | null;
  useCases: ContributorRow[];
  participation: Participation | null;
  courses: CourseRow[];
  /** «Proponi un use case»: il modulo dell'area, o quello di prima con l'area spenta. */
  proposeHref: string;
}

export type HomeData = ReviewerHomeData | ContributorHomeData;

/** La descrizione del workspace, scritta alla creazione: la diceva l'Overview, ora la testata della Home. */
function descriptionOf(workspace: Pick<Workspace, "description">): string | null {
  return workspace.description?.trim() || null;
}

/** Le fasi in cui uno use case è deciso: approvato, in realizzazione, realizzato. */
const DECIDED: ReadonlySet<string> = new Set(["approvato", "in_realizzazione", "realizzato"]);

/** I fatti di «Per partire», letti solo in un workspace nuovo. `legacyUseCases`: con l'area spenta, gli use case di prima. */
async function startFacts(workspace: Workspace, items: readonly HubItem[], legacyUseCases: number | null): Promise<StartFacts> {
  const [departments, goals, notes] = await Promise.all([
    getDepartmentsByWorkspace(workspace.id),
    getStrategicGoalsByWorkspace(workspace.id),
    contextHasCallNotes(workspace.id),
  ]);
  return {
    discovery: Boolean(workspace.systemBoundary),
    notes,
    mappedUnits: departments.filter((d) => d.mappingStatus === "mapped" || d.mappingStatus === "validated").length,
    goals: goals.length,
    decided: legacyUseCases ?? items.filter((item) => DECIDED.has(item.phase)).length,
    toDecide: decideCount(items),
  };
}

async function loadReviewerHome(workspace: Workspace, user: HomeViewer, role: string): Promise<ReviewerHomeData> {
  const viewer = viewerFromSession(user, role);
  const area = isUseCaseHubWorkspace(workspace.id);
  const read = area ? await loadProgramPage({ workspace, user, role }) : null;
  let program: ProgramView | null = null;
  let items: readonly HubItem[] = [];
  let today: string = romeToday();
  if (read?.status === "ok") {
    program = read.view;
    items = read.items;
    today = read.view.today;
  } else if (area) {
    // Senza la 0029 il Programma non c'è, ma il passo del workspace sì: le schede dalla stessa lettura dell'area.
    const list = await listHubItems(workspace.id, viewer);
    if (list && list.projection !== "contributore") {
      items = list.items;
      today = list.today;
    }
  }
  const decided = items.some((item) => DECIDED.has(item.phase));
  const legacy = !area ? await getUseCaseCountByWorkspace(workspace.id) : null;
  // Le informazioni di «Cosa serve» si contano per il passo, mai si mostrano; solo a chi le vede.
  const abilities = abilitiesForUseCase(viewer);
  const readsNeeds = area && abilities.canSeeNeeds;
  const [needs, suppliers, start, participation] = await Promise.all([
    readsNeeds ? listWorkspaceNeeds(workspace.id, viewer) : Promise.resolve(null),
    area ? supplierState({ workspaceId: workspace.id, userId: user.id, role }) : Promise.resolve(null),
    decided || (legacy ?? 0) > 0 ? Promise.resolve(null) : startFacts(workspace, items, legacy),
    // «Chi propone, per area» sta nel pannello «Persone», che c'è solo con il Programma.
    program ? readParticipation(workspace.id) : Promise.resolve(null),
  ]);
  const home = reviewerHome({
    workspaceId: workspace.id,
    companyName: workspace.name,
    today,
    isLateralSpace: viewer.isLateralSpace,
    defaultUnitTerm: getUnitTerm(workspace).singular === "funzione",
    items,
    needs,
    suppliers,
    program,
    start,
    participation,
  });
  return {
    kind: "revisore",
    workspaceId: workspace.id,
    companyName: workspace.name,
    description: descriptionOf(workspace),
    home,
    program,
    programState: !area ? "spento" : program ? "ok" : "non_pronto",
    pendingValue: program ? pendingValueTotal(items) : null,
    participation,
  };
}

/** «Chi propone, per area»: solo numeri per area e società (`getPortfolioParticipation`); null se la lettura non riesce. */
function readParticipation(workspaceId: string): Promise<Participation | null> {
  return getPortfolioParticipation(workspaceId).catch((error: unknown) => {
    logSafeError(LOG_SCOPE, "partecipazione_non_letta", error, { workspaceId });
    return null;
  });
}

/** I corsi che chi guarda segue; [] con la formazione spenta o se la lettura non riesce. */
async function followedCourses(workspaceId: string): Promise<CourseRow[]> {
  if (process.env.LEARNING_ENABLED !== "true") return [];
  try {
    const { getLearningHome } = await import("@/lib/learning/server");
    return courseRows((await getLearningHome(workspaceId)).programs, workspaceId);
  } catch (error) {
    logSafeError(LOG_SCOPE, "corsi_non_letti", error, { workspaceId });
    return [];
  }
}

async function loadContributorHome(workspace: Workspace, user: HomeViewer, role: string): Promise<ContributorHomeData> {
  const viewer = viewerFromSession(user, role);
  const area = isUseCaseHubWorkspace(workspace.id);
  const [list, participation, courses] = await Promise.all([
    area ? listHubItems(workspace.id, viewer) : Promise.resolve(null),
    readParticipation(workspace.id),
    followedCourses(workspace.id),
  ]);
  return {
    kind: "contributore",
    workspaceId: workspace.id,
    description: descriptionOf(workspace),
    useCases: list && list.projection === "contributore" ? contributorRows(list.items, workspace.id) : [],
    participation,
    courses,
    proposeHref: area ? fullFormPath(workspace.id) : `/dashboard/${workspace.id}/portfolio/submit`,
  };
}

/** La Home per chi guarda: i revisori il Programma con il passo, gli altri «I tuoi use case». */
export async function loadHome(i: { workspace: Workspace; user: HomeViewer; role: string }): Promise<HomeData> {
  const viewer = viewerFromSession(i.user, i.role);
  return abilitiesForUseCase(viewer).isReviewer ? loadReviewerHome(i.workspace, i.user, i.role) : loadContributorHome(i.workspace, i.user, i.role);
}

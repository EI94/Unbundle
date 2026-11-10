"use server";

/**
 * Le azioni della scheda «Impostazione» del dossier (rilascio 8.0a, docs/rilascio-8/RILASCIO-8.0-PIANO.md §2).
 * Ognuna chiama per prima `requireWorkspaceAccess`, poi i ruoli di caso (`openUcCase`, per le scritture senza
 * sola lettura), poi la sonda della 0030, poi il servizio (`queries/use-case-factory.ts`), che rilegge permessi e
 * stato. Restituiscono solo quello che serve all'interfaccia.
 *
 * «Approva il progetto» porta il caso da «pronto per lo sviluppo» a «in sviluppo» con `transitionCase`, solo se è
 * in quello stato: negli altri stati registra l'approvazione e lascia lo stato com'è (lo dice il messaggio).
 */
import type { Session } from "@/lib/auth";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { getUseCaseDetail, viewerFromSession } from "@/lib/db/queries/use-case-hub";
import {
  addTeamDecision,
  approveProject,
  factoryStoreReady,
  packageSourceFor,
  recordAiBoardOk,
  reopenProject,
  requestProjectChange,
  saveProjectDetails,
  savePackageVersion,
  saveProjectTopic,
  startProject,
  submitProject,
  findUseCaseOfCase,
  type FactoryActor,
  type FactoryTarget,
  type PackageCard,
} from "@/lib/db/queries/use-case-factory";
import { actorRoles, loadCaseCore, transitionCase } from "@/lib/db/queries/uc-cases";
import type { Result } from "@/lib/uc/types";
import type { CaseRole } from "@/lib/uc/vocab";
import { KIND_LABEL } from "@/lib/use-cases/labels";
import { abilitiesForUseCase } from "@/lib/use-cases/permissions";
import { computedOutput } from "@/lib/use-cases/mcp/output";
import { quarterLabel } from "@/lib/use-cases/quarter";
import type { WorkspaceAccess } from "@/lib/workspace-access";
import { finishUcCommand, fromResult, openUcCase, ucFailure, type OpenedUcCase, type UcActionResult } from "./uc-action-context";

const LS_WRITERS: readonly CaseRole[] = ["ls_lead", "ls_analista", "ls_sviluppatore"];
const NOT_READY = ucFailure("non_disponibile", "L'impostazione non è ancora disponibile: riprova tra qualche minuto.");

interface Opened {
  o: OpenedUcCase;
  actor: FactoryActor;
  target: FactoryTarget;
  session: Session;
  access: WorkspaceAccess;
}

async function onFactory<T>(
  guard: { session: Session; access: WorkspaceAccess },
  workspaceId: string,
  caseId: string,
  allow: readonly CaseRole[],
  run: (opened: Opened) => Promise<Result<T>>,
  message?: (value: T) => string | undefined,
): Promise<UcActionResult<T>> {
  const { session, access } = guard;
  const opened = await openUcCase({ session, access, workspaceId, caseId, allow, write: true });
  if (!opened.ok) return opened.result;
  const o = opened.value;
  // Come le altre scritture dei dossier: a caso chiuso niente, in pausa niente (si riprende da Impostazioni).
  if (o.caseAccess.status === "chiuso") return ucFailure("caso_chiuso", "Il caso è chiuso: il progetto si legge soltanto.");
  if (o.caseAccess.status === "sospeso") return ucFailure("caso_sospeso", "Il caso è in pausa: riprendilo da Impostazioni del caso per cambiare il progetto.");
  if (!(await factoryStoreReady(o.executor))) return NOT_READY;
  const useCase = await findUseCaseOfCase(o.executor, workspaceId, o.ctx.caseId);
  if (!useCase) return ucFailure("non_trovato", "Il dossier non è collegato a uno use case.");
  const actor: FactoryActor = { kind: "persona", userId: session.user.id, roles: actorRoles(o.ctx) };
  const result = await run({ o, actor, target: { workspaceId, useCaseId: useCase.useCaseId }, session, access });
  if (result.ok) finishUcCommand({ workspaceId, caseId: o.ctx.caseId });
  return fromResult(result, undefined, result.ok ? message?.(result.value) : undefined);
}

/** Quello che il pacchetto prende dalla scheda, letto con i permessi di chi lo genera. */
async function packageCard(session: Session, access: WorkspaceAccess, target: FactoryTarget): Promise<{ card: PackageCard; canSeeNeeds: boolean } | null> {
  const viewer = viewerFromSession({ id: session.user.id, email: session.user.email ?? null, emailVerified: session.user.emailVerified === true }, access.role);
  const canSeeNeeds = abilitiesForUseCase(viewer).canSeeNeeds;
  const detail = await getUseCaseDetail(target.workspaceId, target.useCaseId, viewer);
  if (!detail || detail.projection === "contributore") return null;
  const u = detail.useCase;
  const computed = u.valueModel ? computedOutput(u.valueModel, { params: detail.valueParams, value: u.value, cost: u.cost, costBands: detail.costBands }) : null;
  const card: PackageCard = {
    code: u.code ?? "SENZA-CODICE",
    title: u.title,
    kindLabel: KIND_LABEL[u.kind].label.toLowerCase(),
    origin: u.origin,
    targetQuarter: u.targetQuarter ? quarterLabel(u.targetQuarter) : null,
    texts: { oggi: u.description, comeCambia: u.flowDescription, persone: u.humanInTheLoop, limiti: u.guardrails, dati: u.dataRequirements },
    benefits: computed
      ? computed.components.map((c) => ({ label: c.label, lever: c.leverLabel.toLowerCase(), eurYear: c.counted ? c.eurYear : null, confidence: c.confidenceLabel }))
      : [],
    costText: computed?.costText ?? null,
  };
  return { card, canSeeNeeds };
}

/** «Aggiorna il pacchetto»: una versione nuova solo se la scheda è cambiata. */
export async function generatePackageAction(workspaceId: string, caseId: string): Promise<UcActionResult<{ version: number; created: boolean }>> {
  return onFactory(
    await requireWorkspaceAccess(workspaceId),
    workspaceId,
    caseId,
    LS_WRITERS,
    async ({ o, actor, target, session, access }) => {
      const read = await packageCard(session, access, target);
      if (!read) return { ok: false, code: "permesso_negato", message: "Per generare il pacchetto serve poter leggere la scheda dello use case." };
      return savePackageVersion(o.executor, actor, target, { generated: await packageSourceFor(o.executor, target, read.card, { canSeeNeeds: read.canSeeNeeds }) });
    },
    (v) => (v.created ? `Pacchetto pronto: versione ${v.version}.` : `Il pacchetto non è cambiato: resta la versione ${v.version}.`),
  );
}

/** «Imposta il caso» o «Rivedi il progetto»: una versione nuova, con le scelte dell'ultima. */
export async function startProjectAction(workspaceId: string, caseId: string): Promise<UcActionResult<{ version: number; created: boolean }>> {
  return onFactory(await requireWorkspaceAccess(workspaceId), workspaceId, caseId, LS_WRITERS, ({ o, actor, target }) => startProject(o.executor, actor, target), (v) =>
    v.created ? (v.version === 1 ? "Versione 1 aperta: scegli i 10 argomenti." : `Versione ${v.version} aperta: le scelte partono da quelle di prima.`) : `La versione ${v.version} è già aperta.`,
  );
}

/** La scelta di un argomento (scelta, perché, alternativa scartata). */
export async function saveProjectTopicAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ version: number }>> {
  const i = (input ?? {}) as Record<string, unknown>;
  return onFactory(await requireWorkspaceAccess(workspaceId), workspaceId, caseId, LS_WRITERS, ({ o, actor, target }) =>
    saveProjectTopic(o.executor, actor, target, { topic: i.topic, scelta: i.scelta, perche: i.perche, alternativa: i.alternativa }),
  () => "Scelta salvata.");
}

/** Framework, strumenti nuovi, stima. */
export async function saveProjectDetailsAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ version: number }>> {
  const i = (input ?? {}) as Record<string, unknown>;
  return onFactory(await requireWorkspaceAccess(workspaceId), workspaceId, caseId, LS_WRITERS, ({ o, actor, target }) =>
    saveProjectDetails(o.executor, actor, target, { framework: i.framework, newTools: i.newTools, estimateHours: i.estimateHours, monthlyCostEur: i.monthlyCostEur }),
  () => "Salvato.");
}

/** «Manda in approvazione». */
export async function submitProjectAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ version: number; newTools: number }>> {
  const i = (input ?? {}) as Record<string, unknown>;
  return onFactory(await requireWorkspaceAccess(workspaceId), workspaceId, caseId, LS_WRITERS, ({ o, actor, target }) => submitProject(o.executor, actor, target, { revision: i.revision }), (v) =>
    v.newTools > 0 ? "Progetto da approvare. Serve anche l'ok dell'AI Board agli strumenti nuovi." : "Progetto da approvare.",
  );
}

/** «Riapri per cambiarlo» (da approvare → in corso): solo il responsabile; l'ok dell'AI Board decade. */
export async function reopenProjectAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ version: number; boardOkDropped: boolean }>> {
  const i = (input ?? {}) as Record<string, unknown>;
  return onFactory(await requireWorkspaceAccess(workspaceId), workspaceId, caseId, ["ls_lead"], ({ o, actor, target }) => reopenProject(o.executor, actor, target, { revision: i.revision }), (v) =>
    v.boardOkDropped ? "Il progetto è di nuovo in corso. L'AI Board sa che il suo ok va dato di nuovo." : "Il progetto è di nuovo in corso.",
  );
}

/** «Chiedi una modifica»: l'AI Board, invece dell'ok agli strumenti nuovi, con una nota. */
export async function requestProjectChangeAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ version: number }>> {
  const i = (input ?? {}) as Record<string, unknown>;
  return onFactory(await requireWorkspaceAccess(workspaceId), workspaceId, caseId, ["ai_board"], ({ o, actor, target }) => requestProjectChange(o.executor, actor, target, { note: i.note, revision: i.revision }), () =>
    "Richiesta inviata al team di Lateral Space.",
  );
}

/** L'ok dell'AI Board agli strumenti nuovi: da `ai_board`, o dal responsabile con la nota. */
export async function recordAiBoardOkAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ version: number }>> {
  const i = (input ?? {}) as Record<string, unknown>;
  return onFactory(await requireWorkspaceAccess(workspaceId), workspaceId, caseId, ["ai_board", "ls_lead"], ({ o, actor, target }) => recordAiBoardOk(o.executor, actor, target, { note: i.note, revision: i.revision }), () => "Ok dell'AI Board registrato.");
}

/** «Approva il progetto»; se il caso è «pronto per lo sviluppo» passa a «in sviluppo». */
export async function approveProjectAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ version: number; moved: boolean | null }>> {
  const i = (input ?? {}) as Record<string, unknown>;
  return onFactory(
    await requireWorkspaceAccess(workspaceId),
    workspaceId,
    caseId,
    ["ls_lead"],
    async ({ o, actor, target }): Promise<Result<{ version: number; moved: boolean | null }>> => {
      const approved = await approveProject(o.executor, actor, target, { revision: i.revision });
      if (!approved.ok) return approved;
      const core = await loadCaseCore(o.executor, workspaceId, o.ctx.caseId);
      // moved: null = lo stato non doveva cambiare; false = doveva, ma il passaggio non è riuscito.
      if (core?.status !== "pronto_sviluppo") return { ok: true, value: { version: approved.value.version, moved: null } };
      const moved = await transitionCase(o.executor, o.ctx, { to: "in_sviluppo" });
      return { ok: true, value: { version: approved.value.version, moved: moved.ok } };
    },
    (v) =>
      v.moved === true
        ? `Versione ${v.version} approvata: il caso passa a «In sviluppo».`
        : v.moved === false
          ? `Versione ${v.version} approvata, ma il caso non è passato a «In sviluppo»: cambialo da Impostazioni del caso.`
          : `Versione ${v.version} approvata.`,
  );
}

/** Una decisione del team. */
export async function addDecisionAction(workspaceId: string, caseId: string, input: unknown): Promise<UcActionResult<{ id: string }>> {
  const i = (input ?? {}) as Record<string, unknown>;
  return onFactory(await requireWorkspaceAccess(workspaceId), workspaceId, caseId, LS_WRITERS, ({ o, actor, target }) =>
    addTeamDecision(o.executor, actor, target, { topic: i.topic, choice: i.choice, reason: i.reason, rejected: i.rejected, topicKey: i.topicKey }),
  () => "Decisione registrata.");
}

import "server-only";
import { getAppUcExecutor, type UcRow } from "@/lib/db/uc-executor";
import { guardedReferent, isUuid, isVersion, readCard, referentBatch, referentWriter, rfail, type Env, type ReferentFailure } from "@/lib/db/queries/use-case-referent-base";
import { rowBool, rowDate, rowNumber, rowString } from "@/lib/uc/sql/readiness";
import { cast, raw, requireRows, toStatement, ucSql, type UcStatement } from "@/lib/uc/sql/statement";
import { adoptionPatch, hoursComponentByKey, sameTeamEstimate } from "@/lib/use-cases/referent/estimate";
import { BENEFITS_FLAG_SQL, adoptedTeamOf, benefitAdoptionPatch, benefitNeedsReview, impactRowByKey, sameBenefitTeam, storedBenefitOf, type StoredBenefit } from "@/lib/use-cases/referent/impact";
import { referentEventSql, type ReferentActor } from "@/lib/use-cases/referent/sql";
import { personaWriter, saveValueModel, type ServiceResult, type WriteContext } from "@/lib/use-cases/service";

/**
 * «Referente in un tocco» (rilascio 5, SPEC §9.2, §9.3): quello che il team fa con la risposta del
 * referente, sulla scheda. Mai in silenzio: ogni azione è un clic di una persona del team, con la sua
 * riga nella Storia (chi l'ha fatto sta solo lì, D54).
 *
 * - **«Usa la stima di {Nome}»** (`adoptReferentEstimate`): la voce «ore» che il referente ha visto
 *   prende i suoi numeri (solo quelli dati: fiducia, fonte, nome e quota restano, D10), per la strada
 *   di «Salva la valutazione»; poi l'esito «adottata». Se la voce è già così scrive solo l'esito.
 * - **«Tieni la nostra»**, **«Fatto»** sulla stima, **«Non serve»** (`keepTeamEstimate`): l'esito «tenuta».
 * - **«Fatto»** sulla correzione (`markCorrectionDone`): la correzione dello use case è fatta.
 *
 * (Rilascio 5.1) Con le risposte per beneficio le stesse azioni valgono per una voce alla volta:
 * - **«Usa la stima di {Nome}»** (`adoptReferentBenefit`): solo i numeri di quella voce (le volte e i minuti
 *   di una voce a ore, gli euro di una voce in euro), solo se la voce ha ancora la cifra che il referente ha
 *   visto; poi l'esito «adottata» di quella voce.
 * - **«Tieni la nostra»**, **«Fatto»**, **«Non serve»** (`keepReferentBenefit`): l'esito «tenuta» di quella voce.
 *
 * Ogni azione porta la versione della richiesta letta (un altro clic nel frattempo la fa rifiutare).
 * Nessun conteggio né ordinamento per persona (art. 15.4).
 */

const ok = <V>(value: V): { ok: true; value: V } => ({ ok: true, value });
const persona = (userId: string): ReferentActor => ({ kind: "persona", userId });

interface CheckFacts {
  requestId: string;
  version: number;
  submittedAt: Date | null;
  confirm: string | null;
  correctionDoneAt: Date | null;
  estimate: string | null;
  timesPerMonth: number | null;
  minutesEach: number | null;
  teamKey: string | null;
  teamVolume: number | null;
  teamMinutes: number | null;
  outcome: string | null;
  /** (Rilascio 5.1) La conferma ha le risposte per beneficio: le azioni sono per voce. */
  benefits: boolean;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function readCheck(workspaceId: string, useCaseId: string, requestId: string): Promise<CheckFacts | null> {
  const executor = await getAppUcExecutor();
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT r.id, r.version, c.submitted_at, c.confirm, c.correction_done_at, c.estimate, c.times_per_month, c.minutes_each,
  c.team_component_key, c.team_volume_year, c.team_minutes, c.estimate_outcome, ${raw(BENEFITS_FLAG_SQL("c"))} AS benefits
FROM use_case_referent_requests r JOIN use_case_referent_checks c ON c.request_id = r.id
WHERE r.id = ${cast(requestId, "uuid")} AND r.workspace_id = ${cast(workspaceId, "uuid")} AND r.use_case_id = ${cast(useCaseId, "uuid")} AND r.status <> 'revocata'`),
  ]);
  if (!row) return null;
  return factsOf(row);
}

function factsOf(row: UcRow): CheckFacts {
  return {
    requestId: String(row.id).toLowerCase(),
    version: rowNumber(row.version) ?? 1,
    submittedAt: rowDate(row.submitted_at),
    confirm: rowString(row.confirm),
    correctionDoneAt: rowDate(row.correction_done_at),
    estimate: rowString(row.estimate),
    timesPerMonth: num(row.times_per_month),
    minutesEach: num(row.minutes_each),
    teamKey: rowString(row.team_component_key),
    teamVolume: num(row.team_volume_year),
    teamMinutes: num(row.team_minutes),
    outcome: rowString(row.estimate_outcome),
    benefits: rowBool(row.benefits),
  };
}

/** La versione della richiesta letta (anche completata o scaduta, mai revocata): sale di uno. */
function requestVersionSql(workspaceId: string, requestId: string, version: number): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE use_case_referent_requests SET version = version + 1
WHERE id = ${cast(requestId, "uuid")} AND workspace_id = ${cast(workspaceId, "uuid")} AND version = ${cast(version, "int")} AND status <> 'revocata'
RETURNING id`,
      1,
      "versione_superata",
    ),
  );
}

/** L'esito della stima, una volta sola. */
function outcomeSql(requestId: string, outcome: "adottata" | "tenuta"): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE use_case_referent_checks SET estimate_outcome = ${cast(outcome, "text")}, estimate_outcome_at = now(), updated_at = now()
WHERE request_id = ${cast(requestId, "uuid")} AND submitted_at IS NOT NULL AND estimate_outcome IS NULL
RETURNING request_id`,
      1,
      "versione_superata",
    ),
  );
}

async function writer(ctx: WriteContext, env: Env, useCaseId: string, requestId: string, version: unknown): Promise<{ ok: true; userId: string; check: CheckFacts } | ReferentFailure> {
  const w = await referentWriter(ctx, env);
  if (!w.ok) return w;
  if (!isUuid(useCaseId) || !isUuid(requestId) || !isVersion(version)) return rfail("non_trovato");
  const check = await readCheck(ctx.workspaceId, useCaseId, requestId);
  if (!check) return rfail("non_trovato");
  if (check.version !== version) return rfail("versione_superata");
  if (!check.submittedAt) return rfail("richiesta_chiusa");
  return { ok: true, userId: w.userId, check };
}

/** «Fatto» sulla correzione dello use case che il referente ha chiesto. */
export const markCorrectionDone = guardedReferent(
  "correzione_fatta",
  async (ctx: WriteContext, useCaseId: string, requestId: string, version: number, env: Env = process.env): Promise<ServiceResult<{ done: true }> | ReferentFailure> => {
    const w = await writer(ctx, env, useCaseId, requestId, version);
    if (!w.ok) return w;
    if (w.check.confirm !== "correggi") return rfail("dati_non_validi");
    if (w.check.correctionDoneAt) return ok({ done: true });
    const executor = await getAppUcExecutor();
    const run = await referentBatch(executor, [
      requestVersionSql(ctx.workspaceId, requestId, version),
      toStatement(
        requireRows(
          ucSql`UPDATE use_case_referent_checks SET correction_done_at = now(), updated_at = now()
WHERE request_id = ${cast(requestId, "uuid")} AND confirm = 'correggi' AND correction_done_at IS NULL AND submitted_at IS NOT NULL
RETURNING request_id`,
          1,
          "versione_superata",
        ),
      ),
      referentEventSql({ workspaceId: ctx.workspaceId, useCaseId, code: "correzione_fatta", actor: persona(w.userId) }),
    ]);
    if (!run.ok) return run;
    return ok({ done: true });
  },
);

/** «Tieni la nostra», «Fatto» (una stima diversa senza numeri) e «Non serve»: l'esito «tenuta». */
export const keepTeamEstimate = guardedReferent(
  "stima_tenuta",
  async (ctx: WriteContext, useCaseId: string, requestId: string, version: number, env: Env = process.env): Promise<ServiceResult<{ kept: true }> | ReferentFailure> => {
    const w = await writer(ctx, env, useCaseId, requestId, version);
    if (!w.ok) return w;
    // (Rilascio 5.1) Per beneficio si decide su una voce alla volta (`keepReferentBenefit`).
    if (w.check.benefits) return rfail("dati_non_validi");
    if (w.check.outcome) return ok({ kept: true });
    const different = w.check.estimate === "meno" || w.check.estimate === "piu";
    if (!different && w.check.teamKey !== null) return rfail("dati_non_validi");
    const executor = await getAppUcExecutor();
    const run = await referentBatch(executor, [
      requestVersionSql(ctx.workspaceId, requestId, version),
      outcomeSql(requestId, "tenuta"),
      referentEventSql({ workspaceId: ctx.workspaceId, useCaseId, code: "stima_tenuta", actor: persona(w.userId) }),
    ]);
    if (!run.ok) return run;
    return ok({ kept: true });
  },
);

export interface AdoptResult {
  /** Le ore di lavoro l'anno della voce prima e dopo. */
  before: number;
  after: number;
}

/**
 * «Usa la stima di {Nome}» (§9.3): con il permesso di modificare la valutazione, la versione dello use
 * case letta e la voce «ore» ancora uguale all'istantanea che il referente ha visto.
 */
export const adoptReferentEstimate = guardedReferent(
  "stima_adottata",
  async (
    ctx: WriteContext,
    useCaseId: string,
    requestId: string,
    versions: { requestVersion: number; useCaseVersion: number },
    env: Env = process.env,
  ): Promise<ServiceResult<AdoptResult> | ReferentFailure> => {
    const w = await writer(ctx, env, useCaseId, requestId, versions?.requestVersion);
    if (!w.ok) return w;
    const canValue = await personaWriter(ctx, "canEditValuation");
    if (!canValue.ok) return rfail("permesso_mancante");
    if (!isVersion(versions.useCaseVersion)) return rfail("versione_superata");
    const c = w.check;
    if (c.benefits) return rfail("dati_non_validi");
    if (c.outcome) return rfail("versione_superata");
    if (c.teamKey === null || c.teamVolume === null || c.teamMinutes === null) return rfail("dati_non_validi");
    if (c.timesPerMonth === null && c.minutesEach === null) return rfail("dati_non_validi");
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ctx.workspaceId, useCaseId);
    if (!card) return rfail("non_trovato");
    const model = card.valueModel;
    const current = model ? hoursComponentByKey(model, c.teamKey) : null;
    if (!model || !current) return rfail("stima_cambiata");
    const patch = adoptionPatch({ timesPerMonth: c.timesPerMonth, minutesEach: c.minutesEach });
    const target = { volumeYear: patch.volumeYear ?? c.teamVolume, minutesPerUnit: patch.minutesPerUnit ?? c.teamMinutes };
    const now = { key: current.key, volumeYear: current.volumeYear, minutes: current.minutesPerUnit };
    const atSnapshot = sameTeamEstimate(now, { key: c.teamKey, volumeYear: c.teamVolume, minutes: c.teamMinutes });
    // Un secondo clic dopo un errore a metà: la voce è già quella del referente, resta solo l'esito.
    const atTarget = sameTeamEstimate(now, { key: c.teamKey, volumeYear: target.volumeYear, minutes: target.minutesPerUnit });
    if (!atSnapshot && !atTarget) return rfail("stima_cambiata");
    const before = Math.round((c.teamVolume * c.teamMinutes) / 60);
    const after = Math.round((target.volumeYear * target.minutesPerUnit) / 60);
    if (!atTarget) {
      const components = (model.components as unknown as Record<string, unknown>[]).map((x) => (x.key === c.teamKey && x.kind === "ore" ? { ...x, volumeYear: target.volumeYear, minutesPerUnit: target.minutesPerUnit } : x));
      const saved = await saveValueModel(ctx, useCaseId, versions.useCaseVersion, { ...model, components });
      if (!saved.ok) return rfail(saved.error === "versione_superata" || saved.error === "permesso_mancante" || saved.error === "non_trovato" ? saved.error : "dati_non_validi");
    }
    // La versione della richiesta cambia a ogni azione sulla risposta; quella letta è ancora la stessa?
    const run = await referentBatch(executor, [
      requestVersionSql(ctx.workspaceId, requestId, versions.requestVersion),
      outcomeSql(requestId, "adottata"),
      referentEventSql({ workspaceId: ctx.workspaceId, useCaseId, code: "stima_adottata", actor: persona(w.userId) }),
    ]);
    if (!run.ok) return run;
    return ok({ before, after });
  },
);

// ─── (Rilascio 5.1) Una voce di «Benefici e costi» alla volta ────────

async function readBenefit(workspaceId: string, requestId: string, key: string): Promise<StoredBenefit | null> {
  const executor = await getAppUcExecutor();
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT b.component_key, b.position, b.kind, b.label, b.team_volume_year, b.team_minutes, b.team_eur_year, b.answer, b.times_per_month, b.minutes_each, b.eur_year,
  b.comment, b.outcome, b.outcome_at
FROM use_case_referent_check_benefits b
WHERE b.request_id = ${cast(requestId, "uuid")} AND b.workspace_id = ${cast(workspaceId, "uuid")} AND b.component_key = ${cast(key, "text")}`),
  ]);
  return row ? storedBenefitOf(row) : null;
}

/** L'esito di una voce, una volta sola, solo su una conferma inviata. */
function benefitOutcomeSql(requestId: string, key: string, outcome: "adottata" | "tenuta"): UcStatement {
  return toStatement(
    requireRows(
      ucSql`UPDATE use_case_referent_check_benefits b SET outcome = ${cast(outcome, "text")}, outcome_at = now(), updated_at = now()
FROM use_case_referent_checks c
WHERE c.request_id = b.request_id AND b.request_id = ${cast(requestId, "uuid")} AND b.component_key = ${cast(key, "text")} AND c.submitted_at IS NOT NULL AND b.outcome IS NULL
RETURNING b.request_id`,
      1,
      "versione_superata",
    ),
  );
}

const isKey = (key: unknown): key is string => typeof key === "string" && key.length > 0 && key.length <= 40;

/**
 * (Rilascio 6) Una decisione del team su una voce («Usa la stima di {Nome}», «Tieni la nostra», «Fatto»)
 * gestisce anche le risposte e le aggiunte del referente su quella voce nel filo: il team le ha guardate.
 */
function benefitRepliesHandledSql(requestId: string, key: string, userId: string): UcStatement {
  return toStatement(ucSql`UPDATE use_case_referent_messages SET handled_at = now(), handled_by_user_id = ${cast(userId, "uuid")}
WHERE request_id = ${cast(requestId, "uuid")} AND anchor = 'beneficio' AND component_key = ${cast(key, "text")} AND side = 'referente'
  AND kind IN ('risposta', 'aggiunta') AND handled_at IS NULL`);
}

/** La cifra di una voce come la scrive il toast: ore di lavoro l'anno, oppure euro l'anno. */
function figureOf(team: StoredBenefit["team"]): number {
  return team.kind === "euro" ? Math.round(team.eurYear ?? 0) : Math.round(((team.volumeYear ?? 0) * (team.minutes ?? 0)) / 60);
}

export interface AdoptBenefitResult {
  kind: "ore" | "euro";
  /** Le ore di lavoro l'anno (o gli euro l'anno) della voce prima e dopo. */
  before: number;
  after: number;
}

/**
 * «Usa la stima di {Nome}» su una voce (rilascio 5.1): con il permesso di modificare la valutazione, la
 * versione dello use case letta e la voce ancora con la cifra che il referente ha visto. Cambiano solo i
 * numeri che il referente ha dato su quella voce: nome, fiducia, fonte, quota e le altre voci restano.
 */
export const adoptReferentBenefit = guardedReferent(
  "stima_adottata",
  async (
    ctx: WriteContext,
    useCaseId: string,
    requestId: string,
    key: string,
    versions: { requestVersion: number; useCaseVersion: number },
    env: Env = process.env,
  ): Promise<ServiceResult<AdoptBenefitResult> | ReferentFailure> => {
    const w = await writer(ctx, env, useCaseId, requestId, versions?.requestVersion);
    if (!w.ok) return w;
    const canValue = await personaWriter(ctx, "canEditValuation");
    if (!canValue.ok) return rfail("permesso_mancante");
    if (!isVersion(versions.useCaseVersion)) return rfail("versione_superata");
    if (!isKey(key) || !w.check.benefits) return rfail("non_trovato");
    const b = await readBenefit(ctx.workspaceId, requestId, key);
    if (!b) return rfail("non_trovato");
    if (b.outcome) return rfail("versione_superata");
    const patch = benefitAdoptionPatch(b);
    if (Object.keys(patch).length === 0 || b.team.kind === "qualitativo") return rfail("dati_non_validi");
    const executor = await getAppUcExecutor();
    const card = await readCard(executor, ctx.workspaceId, useCaseId);
    if (!card) return rfail("non_trovato");
    const model = card.valueModel;
    const now = model ? impactRowByKey(model, key) : null;
    if (!model || !now || now.team.kind !== b.team.kind) return rfail("stima_cambiata");
    const target = adoptedTeamOf(b);
    const atSnapshot = sameBenefitTeam(now.team, b.team);
    // Un secondo clic dopo un errore a metà: la voce è già quella del referente, resta solo l'esito.
    const atTarget = sameBenefitTeam(now.team, target);
    if (!atSnapshot && !atTarget) return rfail("stima_cambiata");
    if (!atTarget) {
      const components = (model.components as unknown as Record<string, unknown>[]).map((x) => {
        if (x.key !== key || x.kind !== b.team.kind) return x;
        if (b.team.kind === "euro") return { ...x, ...(patch.eurYear !== undefined ? { eurYear: patch.eurYear } : {}) };
        return { ...x, ...(patch.volumeYear !== undefined ? { volumeYear: patch.volumeYear } : {}), ...(patch.minutesPerUnit !== undefined ? { minutesPerUnit: patch.minutesPerUnit } : {}) };
      });
      const saved = await saveValueModel(ctx, useCaseId, versions.useCaseVersion, { ...model, components });
      if (!saved.ok) return rfail(saved.error === "versione_superata" || saved.error === "permesso_mancante" || saved.error === "non_trovato" ? saved.error : "dati_non_validi");
    }
    const run = await referentBatch(executor, [
      requestVersionSql(ctx.workspaceId, requestId, versions.requestVersion),
      benefitOutcomeSql(requestId, key, "adottata"),
      benefitRepliesHandledSql(requestId, key, w.userId),
      referentEventSql({ workspaceId: ctx.workspaceId, useCaseId, code: "stima_adottata", actor: persona(w.userId) }),
    ]);
    if (!run.ok) return run;
    return ok({ kind: b.team.kind === "euro" ? "euro" : "ore", before: figureOf(b.team), after: figureOf(target) });
  },
);

/** «Tieni la nostra», «Fatto» e «Non serve» su una voce (rilascio 5.1): l'esito «tenuta» di quella voce. */
export const keepReferentBenefit = guardedReferent(
  "stima_tenuta",
  async (ctx: WriteContext, useCaseId: string, requestId: string, key: string, version: number, env: Env = process.env): Promise<ServiceResult<{ kept: true }> | ReferentFailure> => {
    const w = await writer(ctx, env, useCaseId, requestId, version);
    if (!w.ok) return w;
    if (!isKey(key) || !w.check.benefits) return rfail("non_trovato");
    const b = await readBenefit(ctx.workspaceId, requestId, key);
    if (!b) return rfail("non_trovato");
    if (b.outcome) return ok({ kept: true });
    if (!benefitNeedsReview(b)) return rfail("dati_non_validi");
    const executor = await getAppUcExecutor();
    const run = await referentBatch(executor, [
      requestVersionSql(ctx.workspaceId, requestId, version),
      benefitOutcomeSql(requestId, key, "tenuta"),
      benefitRepliesHandledSql(requestId, key, w.userId),
      referentEventSql({ workspaceId: ctx.workspaceId, useCaseId, code: "stima_tenuta", actor: persona(w.userId) }),
    ]);
    if (!run.ok) return run;
    return ok({ kept: true });
  },
);

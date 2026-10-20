/**
 * Valore del caso (DESIGN §3.8, WP5): letture delle pagine Valore e
 * `/valore/kpi`, il salvataggio del conto con i suoi totali e il ricalcolo una
 * tantum dei totali dei conti già salvati.
 *
 * Il salvataggio (`saveCaseRoi`) nasce come copia di `updateCaseRoi`
 * (`uc-cases.ts`, congelato in ondata 2: regola 3 di §8.1) e in più, nello
 * stesso UPDATE, scrive i totali di `uc_roi_models` (`implementation_cost`,
 * `annual_run_cost`, `annual_benefit`, `break_even_months`, `value_5y`). Sono la
 * fonte «dossier» del costo e del beneficio nella pagina Use case
 * (`docs/use-case/DESIGN.md` §7.2 e §10.10), che li legge senza ricalcolare il
 * conto: valgono finché il conto è calcolato e sono tutti `null` finché è «da
 * calcolare».
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-cases.ts`:
 * l'esecutore arriva da fuori (app, script e test). L'accesso al workspace e al
 * caso lo controlla il chiamante; qui il comando ricalcola i permessi con le
 * funzioni pure e scrive con compare-and-swap più evento nello stesso batch.
 */
import { z } from "zod";
import { can } from "../../uc/permissions.ts";
import { rowJson, rowNumber, rowString, type Row } from "../../uc/sql/readiness.ts";
import { cast, jsonb, raw, requireRows, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import { fail, ok, type Result } from "../../uc/types.ts";
import { LEVERS, isVocab, type ItemStatus, type Lever } from "../../uc/vocab.ts";
import { DEFAULT_BASELINE, DEFAULT_TARGET, buildKpis, groupKpisByLever, kpiView, kpisInView, rowToKpiRow, type KpiGroup, type KpiParams, type KpiRow, type KpiView, type KpiViewKey } from "../../uc/views/kpi.ts";
import { buildRoiView, buildValueView, parseBenefitLines, parseCostLines, parseLeverTexts, plainText, roiKpiKeys, type RoiQuestion, type RoiView, type ValueView } from "../../uc/views/roi.ts";
import { roiTotals, sameRoiTotals, type RoiTotals } from "../../uc/views/roi-edit.ts";
import type { CaseViewContext } from "../../uc/views/rows.ts";
import { canOpenPage, seesValidatedOnly } from "../../uc/views/page-access.ts";
import { isLsViewer } from "../../uc/views/status-groups.ts";
import { actorRoles, checkLsText, runCommand, type UcCommandContext } from "./uc-cases.ts";
import { eventActorFrom, eventInsertSql } from "./uc-events.ts";
import { caseViewContextReader, type UcViewer } from "./uc-views.ts";
import type { UcExecutor } from "../uc-executor.ts";
import { UUID } from "../../uc/ids.ts";

const uuid = (v: string) => cast(v, "uuid");

// ── SQL ───────────────────────────────────────────────────────────────

/** Leve attive del caso e testi delle leve nella Descrizione. */
export function caseLeversSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`SELECT c.levers, c.description -> 'leve' AS leve
FROM uc_cases c WHERE c.id = ${uuid(caseId)} AND c.workspace_id = ${uuid(workspaceId)} AND c.setup_completed_at IS NOT NULL`);
}

/**
 * Modello più recente dello scenario base, con `updated_at` come testo
 * (`seen`): lo rimanda il salvataggio per accorgersi di una modifica nel
 * frattempo.
 */
export function roiModelSeenSql(caseId: string): UcStatement {
  return toStatement(ucSql`SELECT r.id, r.version, r.status, r.scenario, r.currency, r.cost_lines, r.benefit_lines, r.discount_rate, r.horizon_years,
  r.adoption_rate, r.human_review_hours, r.attribution_method, r.assumptions, r.content, r.approved_at, r.updated_at, r.updated_at::text AS seen
FROM uc_roi_models r
WHERE r.case_id = ${uuid(caseId)} AND r.scenario = 'base'
ORDER BY r.version DESC
LIMIT 1`);
}

/**
 * KPI del caso in forma leggera (DESIGN §3.8): testi e quattro segni dei
 * collegamenti calcolati qui, così al client non arrivano i collegamenti. La
 * ricerca (`q`) guarda titolo, frase e chiave, come la ricerca delle domande.
 */
export function kpiRowsSql(caseId: string, q: string | null = null): UcStatement {
  const search = q ? cast(q.toLowerCase(), "text") : null;
  return toStatement(ucSql`SELECT i.id, i.key, i.title, i.explanation, i.status, i.priority, i.levers, i.spec,
  EXISTS (SELECT 1 FROM uc_item_links l JOIN uc_items d ON d.id = l.from_item_id
    WHERE l.to_item_id = i.id AND l.relation = 'precisa' AND d.kind = 'domanda' AND d.deleted_at IS NULL
      AND d.response_type = 'conferma_formula' AND d.status = 'validata') AS formula_confirmed,
  EXISTS (SELECT 1 FROM uc_item_links l JOIN uc_items s ON s.id = l.to_item_id
    WHERE l.from_item_id = i.id AND l.relation = 'alimentato_da' AND s.deleted_at IS NULL
      AND jsonb_typeof(s.availability) = 'array' AND s.availability ? 'oggi_export') AS data_ready
FROM uc_items i
WHERE i.case_id = ${uuid(caseId)} AND i.kind = 'kpi' AND i.deleted_at IS NULL
  ${search ? ucSql`AND (strpos(lower(i.title), ${search}) > 0 OR strpos(lower(coalesce(i.explanation, '')), ${search}) > 0 OR strpos(lower(i.key), ${search}) > 0)` : raw("")}
ORDER BY i.sort_order, i.key
LIMIT 2000`);
}

/**
 * Domande che servono al conto e non sono a posto (DESIGN §3.8, «Dati che
 * mancano»): quelle che servono al ROI (`serves_for` contiene `roi`), quelle che
 * precisano una voce che serve al ROI o che il conto usa (`keys`: KPI delle righe
 * di beneficio, voci delle righe di costo), e quelle che il conto cita da sé.
 * Le prime 200, le indispensabili prima, con il totale.
 */
export function roiQuestionsSql(caseId: string, keys: readonly string[]): UcStatement {
  const k = cast([...keys], "text[]");
  return toStatement(ucSql`SELECT q.id, q.key, q.title, q.status, count(*) OVER ()::int AS total
FROM uc_items q
WHERE q.case_id = ${uuid(caseId)} AND q.kind = 'domanda' AND q.deleted_at IS NULL
  AND q.status NOT IN ('validata', 'non_applicabile')
  AND (
    (jsonb_typeof(q.serves_for) = 'array' AND q.serves_for ? 'roi')
    OR q.key = ANY(${k})
    OR EXISTS (SELECT 1 FROM uc_item_links l JOIN uc_items t ON t.id = l.to_item_id
      WHERE l.from_item_id = q.id AND l.relation = 'precisa' AND t.deleted_at IS NULL
        AND ((jsonb_typeof(t.serves_for) = 'array' AND t.serves_for ? 'roi') OR t.key = ANY(${k})))
  )
ORDER BY (q.priority IS NOT DISTINCT FROM 'must') DESC, q.sort_order, q.key
LIMIT 200`);
}

/** Una voce KPI con le stesse colonne di `itemsOfKindsSql`, per il pannello. */
function kpiItemSql(caseId: string, itemId: string): UcStatement {
  return toStatement(ucSql`SELECT i.id, i.key, i.kind, i.title, i.explanation, i.why, i.example, i.help, i.spec, i.status, i.status_reason, i.priority,
  i.perimeter, i.serves_for, i.levers, i.privacy_class, i.availability, i.owner_role_key, i.response_type, i.source_refs,
  i.parent_item_id, i.assignee_contact_id, va.text_hash AS confirmed_text_hash,
  coalesce((SELECT jsonb_agg(b.key ORDER BY b.key) FROM uc_item_blockers ib JOIN uc_blockers b ON b.id = ib.blocker_id
    WHERE ib.item_id = i.id AND b.status IN ('attivo', 'permanente')), '[]'::jsonb) AS active_blockers
FROM uc_items i
LEFT JOIN uc_answers va ON va.id = i.validated_answer_id
WHERE i.case_id = ${uuid(caseId)} AND i.id = ${uuid(itemId)} AND i.kind = 'kpi' AND i.deleted_at IS NULL`);
}

/** Collegamenti di una voce, con le stesse colonne di `linksTouchingKindsSql`. */
function itemLinksSql(caseId: string, itemId: string): UcStatement {
  return toStatement(ucSql`SELECT l.from_item_id, l.to_item_id, l.relation, l.cardinality, l.note,
  f.key AS f_key, f.title AS f_title, f.kind AS f_kind, f.status AS f_status, f.availability AS f_availability, f.response_type AS f_response_type,
  t.key AS t_key, t.title AS t_title, t.kind AS t_kind, t.status AS t_status, t.availability AS t_availability, t.response_type AS t_response_type,
  NULL::text AS f_confirmed_hash
FROM uc_item_links l
JOIN uc_items f ON f.id = l.from_item_id
JOIN uc_items t ON t.id = l.to_item_id
WHERE l.case_id = ${uuid(caseId)} AND f.deleted_at IS NULL AND t.deleted_at IS NULL
  AND (l.from_item_id = ${uuid(itemId)} OR l.to_item_id = ${uuid(itemId)})`);
}

/** Misure di un KPI: il valore sotto la soglia minima non esce mai. */
function kpiMeasurementsOfSql(caseId: string, itemId: string): UcStatement {
  return toStatement(ucSql`SELECT m.item_id, m.phase, m.period_start::text AS period_start, m.period_end::text AS period_end,
  CASE WHEN m.suppressed THEN NULL ELSE m.value END AS value, m.unit, m.suppressed, m.status
FROM uc_kpi_measurements m
WHERE m.case_id = ${uuid(caseId)} AND m.item_id = ${uuid(itemId)}
ORDER BY m.period_start
LIMIT 200`);
}

// ── Pagina Valore ─────────────────────────────────────────────────────

export interface ValuePageData {
  ctx: CaseViewContext;
  roi: RoiView;
  view: ValueView;
}

function leversOf(raw: unknown): Lever[] {
  const list = rowJson<unknown[]>(raw);
  return Array.isArray(list) ? list.filter((l): l is Lever => isVocab(LEVERS, l)) : [];
}

/**
 * Pagina Valore: due giri. Il primo legge contesto, leve, conto (o quello dello
 * schema di partenza) e i KPI in forma leggera; il secondo le domande del conto,
 * con le chiavi che il conto usa.
 *
 * I titoli delle domande arrivano solo a chi apre Domande con tutto il catalogo
 * (DESIGN §2.3, come la Panoramica): AI Board e Osservatore vedono quante sono,
 * non quali, e nei testi la chiave di una domanda sparisce invece di diventare
 * il suo titolo.
 */
export async function loadValuePage(executor: UcExecutor, v: UcViewer): Promise<ValuePageData | null> {
  // Il conto del template viene con il contesto, dalle parti lette una volta per impronta (DESIGN §7.1 P0-5 b).
  const context = caseViewContextReader(v.workspaceId, v.caseId);
  const rows = await executor.batch([context.statement, caseLeversSql(v.workspaceId, v.caseId), roiModelSeenSql(v.caseId), kpiRowsSql(v.caseId)]);
  const ctx = context.parse(rows[0]);
  if (!ctx || !rows[1][0]) return null;
  const roi = buildRoiView(rows[2][0], context.templateRoi(rows[0]));
  const keys = roiKpiKeys(roi);
  const kpis = rows[3].map((r) => rowToKpiRow(r, new Set(keys)));
  const [questionRows] = await executor.batch([roiQuestionsSql(v.caseId, keys)]);
  const seesCatalog = canOpenPage("voci", v.roles) && !seesValidatedOnly(v.roles);
  const questions: RoiQuestion[] = (seesCatalog ? questionRows : []).map((r) => ({
    id: String(r.id),
    key: String(r.key),
    title: rowString(r.title)?.trim() || String(r.key),
    status: String(r.status) as ItemStatus,
  }));
  const view = buildValueView({
    roi,
    caseLevers: leversOf(rows[1][0].levers),
    leverTexts: parseLeverTexts(rows[1][0].leve),
    kpis,
    questions,
    questionTotal: rowNumber(questionRows[0]?.total) ?? 0,
  });
  return { ctx, roi, view };
}

// ── Pagina dei KPI ────────────────────────────────────────────────────

export interface KpiPageData {
  ctx: CaseViewContext;
  view: KpiViewKey;
  q: string | null;
  /** KPI che corrispondono alla ricerca, per vista. */
  counts: Record<KpiViewKey, number>;
  groups: KpiGroup[];
  /** KPI della vista. */
  shown: number;
  /** Il KPI del pannello (`?apri=`), con collegamenti e misure. */
  open: KpiView | null;
}

/**
 * `/valore/kpi` in un giro: KPI in forma leggera con la ricerca nel database,
 * conto per sapere quali sono collegati, e il KPI del pannello se c'è.
 * Raggruppamento per leva sul server.
 */
export async function loadKpiPage(executor: UcExecutor, v: UcViewer, params: KpiParams): Promise<KpiPageData | null> {
  const apri = params.apri && UUID.test(params.apri) ? params.apri : null;
  const context = caseViewContextReader(v.workspaceId, v.caseId);
  const rows = await executor.batch([
    context.statement,
    roiModelSeenSql(v.caseId),
    kpiRowsSql(v.caseId, params.q),
    ...(apri ? [kpiItemSql(v.caseId, apri), itemLinksSql(v.caseId, apri), kpiMeasurementsOfSql(v.caseId, apri)] : []),
  ]);
  const ctx = context.parse(rows[0]);
  if (!ctx) return null;
  const roi = buildRoiView(rows[1][0], context.templateRoi(rows[0]));
  const keys = new Set(roiKpiKeys(roi));
  const raw: KpiRow[] = rows[2].map((r) => rowToKpiRow(r, keys));
  // La frase della riga senza chiavi, codici o articoli (le chiavi diventano titoli).
  const titles = new Map(raw.map((k) => [k.key, k.title]));
  const all = raw.map((k) => ({ ...k, explanation: plainText(k.explanation, titles) }));
  const ls = isLsViewer(v.roles);
  const counts: Record<KpiViewKey, number> = {
    conto: all.filter((k) => k.linked).length,
    tutti: all.length,
    "da-sistemare": ls ? all.filter((k) => k.vanity).length : 0,
  };
  const view = kpiView(params.vista, { linked: counts.conto, ls });
  const shown = kpisInView(all, view);
  const panel = apri ? (buildKpis({ itemRows: rows[3], linkRows: rows[4], measurementRows: rows[5], roles: v.roles, roleLabels: ctx.roleLabels })[0] ?? null) : null;
  // Valore di partenza e obiettivo come gli altri testi del pannello: senza codici dei fatti, articoli e chiavi.
  // Quelli dello schema, con i codici, restano in «Dettagli tecnici» (`item.fields`), per Lateral Space.
  const open: KpiView | null = panel && {
    ...panel,
    baseline: plainText(panel.baseline, titles) ?? DEFAULT_BASELINE,
    target: plainText(panel.target, titles) ?? DEFAULT_TARGET,
  };
  return { ctx, view, q: params.q, counts, groups: groupKpisByLever(shown), shown: shown.length, open };
}

// ── Salvataggio del conto ─────────────────────────────────────────────

const BLOCK_KEY = /^[a-z0-9_]{1,60}$/;
const MAX_ROI_BYTES = 200_000;
const MAX_ROI_LINES = 100;

const RoiLineStatus = z.enum(["da_raccogliere", "stima", "confermato"]);
/**
 * Righe del conto: oggetti stretti, così un campo che il comando non conosce si
 * rifiuta con un messaggio invece di sparire in silenzio. Tipo di costo e leva
 * possono restare da indicare (`null`): le righe dello schema di partenza non
 * sempre li hanno, e il conto resta «da calcolare» finché mancano. (Le stesse
 * regole di `updateCaseRoi`.)
 */
const RoiCostLine = z.strictObject({
  key: z.string().regex(BLOCK_KEY),
  label: z.string().trim().min(1).max(255),
  kind: z.enum(["una_tantum", "ricorrente", "escluso"]).nullable(),
  tipo_testo: z.string().max(255).nullish(),
  how_estimated: z.string().max(1000).nullish(),
  value: z.number().finite().min(0).nullable(),
  status: RoiLineStatus,
  source: z.string().max(500).nullish(),
  authorized_art_8_4: z.boolean().nullable(),
  item_key: z.string().max(160).nullish(),
});
const RoiBenefitLine = z.strictObject({
  key: z.string().regex(BLOCK_KEY),
  lever: z.enum(LEVERS).nullable(),
  lever_label: z.string().trim().max(255).nullish(),
  formula: z.string().max(2000).nullish(),
  inputs: z.array(z.string().max(160)).max(50).default([]),
  value: z.number().finite().nullable(),
  status: RoiLineStatus,
  source: z.string().max(500).nullish(),
  how_to_euro: z.string().max(2000).nullish(),
  data_needed: z.array(z.string().max(500)).max(50).optional(),
  example: z.string().max(2000).nullish(),
  unresolved_refs: z.array(z.string().max(160)).max(100).optional(),
});
const RoiSaveSchema = z.object({
  costLines: z
    .array(RoiCostLine)
    .max(MAX_ROI_LINES)
    .refine((l) => new Set(l.map((c) => c.key)).size === l.length, { message: "chiavi ripetute" })
    .optional(),
  benefitLines: z
    .array(RoiBenefitLine)
    .max(MAX_ROI_LINES)
    .refine((l) => new Set(l.map((b) => b.key)).size === l.length, { message: "chiavi ripetute" })
    .optional(),
  content: z.record(z.string().regex(BLOCK_KEY), z.unknown()).optional(),
  /** `updated_at` del modello come l'ha letto la pagina (`roiModelSeenSql`), oppure null. */
  seen: z.string().max(64).nullish(),
});

/** Messaggio in italiano per il primo problema delle righe del conto. */
function roiIssueMessage(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return "Controlla le righe del conto.";
  const [list, index, field] = issue.path;
  const where = list === "costLines" ? "Riga di costo" : list === "benefitLines" ? "Riga di beneficio" : null;
  if (where && index === undefined) {
    // Un problema dell'elenco intero: la chiave ripetuta (il `refine`), troppe righe, oppure non è un elenco.
    const lines = where === "Riga di costo" ? "Righe di costo" : "Righe di beneficio";
    if (issue.code === "custom") return `${lines}: due righe hanno la stessa chiave.`;
    if (issue.code === "too_big") return `${lines}: al massimo ${MAX_ROI_LINES}.`;
    return `${lines}: controlla l'elenco.`;
  }
  const row = where && typeof index === "number" ? `${where} ${index + 1}` : "Conto";
  if (issue.code === "unrecognized_keys") return `${row}: campo non previsto (${issue.keys.slice(0, 3).join(", ")}).`;
  if (typeof field === "string") return `${row}: controlla il campo «${field}».`;
  return `Controlla le righe del conto (${row}).`;
}

/** Il caso non è chiuso (guardia nei batch che non toccano il catalogo). */
function caseOpenSql(workspaceId: string, caseId: string): UcStatement {
  return toStatement(ucSql`SELECT uc_require(EXISTS (
  SELECT 1 FROM uc_cases WHERE id = ${uuid(caseId)} AND workspace_id = ${uuid(workspaceId)} AND setup_completed_at IS NOT NULL AND status <> 'chiuso'
), 'caso_chiuso') AS ok`);
}

const ROI_MESSAGES: Readonly<Record<string, string>> = {
  caso_chiuso: "Il caso è chiuso: non si modifica più.",
  conflitto: "Il conto è cambiato nel frattempo: aggiorna la pagina e riprova.",
};

function totalsSql(t: RoiTotals) {
  return {
    implementation: cast(t.implementationCost, "numeric"),
    run: cast(t.annualRunCost, "numeric"),
    benefit: cast(t.annualBenefit, "numeric"),
    breakEven: cast(t.breakEvenMonths, "numeric"),
    value5y: cast(t.value5y, "numeric"),
  };
}

/** Totali del conto dalle righe salvate (formato del database) e dai parametri del modello. */
export function totalsFromStored(i: { costLines: unknown; benefitLines: unknown; horizonYears: unknown; discountRate: unknown; adoptionRate: unknown }): RoiTotals {
  return roiTotals({
    costLines: parseCostLines(rowJson(i.costLines) ?? []),
    benefitLines: parseBenefitLines(rowJson(i.benefitLines) ?? []),
    horizonYears: rowNumber(i.horizonYears),
    discountRate: rowNumber(i.discountRate),
    adoptionRate: rowNumber(i.adoptionRate),
  });
}

/**
 * Righe di costo e beneficio del conto in stima (solo il Responsabile Lateral
 * Space), sul modello più recente dello scenario base; lo crea alla prima
 * modifica. Nello stesso UPDATE scrive i totali (`roiTotals`): pieni a conto
 * calcolato, tutti `null` finché è «da calcolare». Con `seen` il comando rifiuta
 * se il modello è cambiato dopo che la pagina l'ha letto. Il tempo di verifica
 * umana resta sempre incluso (vincolo del DDL).
 */
export async function saveCaseRoi(executor: UcExecutor, ctx: UcCommandContext, input: unknown): Promise<Result<{ version: number; totals: RoiTotals }>> {
  if (!can(actorRoles(ctx), "modificare_catalogo")) return fail("attore_non_ammesso", "Solo il responsabile Lateral Space modifica il conto.");
  const parsed = RoiSaveSchema.safeParse(input);
  if (!parsed.success) return fail("dati_non_validi", roiIssueMessage(parsed.error.issues[0]));
  const { seen, ...v } = parsed.data;
  if (JSON.stringify(v).length > MAX_ROI_BYTES) return fail("testo_troppo_lungo", "Il conto è troppo lungo.");
  const text = checkLsText(v);
  if (!text.ok) return text;
  const c = uuid(ctx.caseId);
  const [[current]] = await executor.batch([
    toStatement(ucSql`SELECT id, version, cost_lines, benefit_lines, content, horizon_years, discount_rate, adoption_rate, updated_at::text AS seen
FROM uc_roi_models WHERE case_id = ${c} AND scenario = 'base' ORDER BY version DESC LIMIT 1`),
  ]);
  // `seen` assente: nessun controllo (come `updateCaseRoi`); null: la pagina non aveva ancora un modello.
  if (seen !== undefined && (current ? rowString(current.seen) !== seen : seen !== null)) return fail("conflitto", ROI_MESSAGES.conflitto);
  const event = toStatement(
    eventInsertSql({
      type: "caso.descrizione_modificata",
      workspaceId: ctx.workspaceId,
      caseId: ctx.caseId,
      actor: eventActorFrom(ctx.actor),
      targetType: "caso",
      targetId: ctx.caseId,
      payload: { blocks: ["roi"] },
    }),
  );
  const nextCosts = v.costLines ?? (current ? rowJson(current.cost_lines) : null) ?? [];
  const nextBenefits = v.benefitLines ?? (current ? rowJson(current.benefit_lines) : null) ?? [];
  const totals = totalsFromStored({
    costLines: nextCosts,
    benefitLines: nextBenefits,
    horizonYears: current?.horizon_years ?? 5,
    discountRate: current?.discount_rate ?? null,
    adoptionRate: current?.adoption_rate ?? null,
  });
  const t = totalsSql(totals);
  if (!current) {
    const run = await runCommand(
      executor,
      [
        caseOpenSql(ctx.workspaceId, ctx.caseId),
        toStatement(ucSql`INSERT INTO uc_roi_models (case_id, version, status, scenario, cost_lines, benefit_lines, content,
  implementation_cost, annual_run_cost, annual_benefit, break_even_months, value_5y)
VALUES (${c}, 1, 'stima', 'base', ${jsonb(v.costLines ?? [])}, ${jsonb(v.benefitLines ?? [])}, ${jsonb(v.content ?? {})},
  ${t.implementation}, ${t.run}, ${t.benefit}, ${t.breakEven}, ${t.value5y})`),
        event,
      ],
      ROI_MESSAGES,
    );
    return run.ok ? ok({ version: 1, totals }) : run;
  }
  const run = await runCommand(
    executor,
    [
      caseOpenSql(ctx.workspaceId, ctx.caseId),
      toStatement(
        requireRows(
          ucSql`UPDATE uc_roi_models SET
  cost_lines = ${v.costLines ? jsonb(v.costLines) : raw("cost_lines")},
  benefit_lines = ${v.benefitLines ? jsonb(v.benefitLines) : raw("benefit_lines")},
  content = ${v.content ? jsonb(v.content) : raw("content")},
  implementation_cost = ${t.implementation},
  annual_run_cost = ${t.run},
  annual_benefit = ${t.benefit},
  break_even_months = ${t.breakEven},
  value_5y = ${t.value5y},
  updated_at = now()
WHERE id = ${uuid(String(current.id))} AND cost_lines = ${jsonb(rowJson(current.cost_lines) ?? [])} AND benefit_lines = ${jsonb(rowJson(current.benefit_lines) ?? [])}
  AND horizon_years IS NOT DISTINCT FROM ${cast(rowNumber(current.horizon_years), "int")}
  AND discount_rate IS NOT DISTINCT FROM ${cast(rowNumber(current.discount_rate), "numeric")}
  AND adoption_rate IS NOT DISTINCT FROM ${cast(rowNumber(current.adoption_rate), "numeric")}
RETURNING id`,
          1,
          "conflitto",
        ),
      ),
      event,
    ],
    ROI_MESSAGES,
  );
  return run.ok ? ok({ version: rowNumber(current.version) ?? 1, totals }) : run;
}

// ── Totali salvati ────────────────────────────────────────────────────

/** Totali di `uc_roi_models` (modello più recente dello scenario base) per caso, come li legge la pagina Use case. */
export async function loadRoiTotals(executor: UcExecutor, caseIds: readonly string[]): Promise<Map<string, RoiTotals>> {
  const ids = [...new Set(caseIds.filter((id) => UUID.test(id)))];
  const out = new Map<string, RoiTotals>();
  if (ids.length === 0) return out;
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT ON (r.case_id) r.case_id, r.implementation_cost, r.annual_run_cost, r.annual_benefit, r.break_even_months, r.value_5y
FROM uc_roi_models r
WHERE r.case_id = ANY(${cast(ids, "uuid[]")}) AND r.scenario = 'base'
ORDER BY r.case_id, r.version DESC`),
  ]);
  for (const r of rows) out.set(String(r.case_id), storedTotals(r));
  return out;
}

function storedTotals(r: Row): RoiTotals {
  return {
    implementationCost: rowNumber(r.implementation_cost),
    annualRunCost: rowNumber(r.annual_run_cost),
    annualBenefit: rowNumber(r.annual_benefit),
    breakEvenMonths: rowNumber(r.break_even_months),
    value5y: rowNumber(r.value_5y),
  };
}

export interface RoiTotalsChange {
  id: string;
  caseId: string;
  version: number;
  scenario: string;
  /** `updated_at` letto, per il compare-and-swap. */
  seen: string;
  before: RoiTotals;
  after: RoiTotals;
}

/**
 * Ricalcolo una tantum (`scripts/uc-roi-totals.ts`): i modelli di tutti gli
 * scenari i cui totali salvati non corrispondono alle righe. Solo lettura.
 */
export async function planRoiTotals(executor: UcExecutor): Promise<{ models: number; changes: RoiTotalsChange[] }> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT r.id, r.case_id, r.version, r.scenario, r.cost_lines, r.benefit_lines, r.horizon_years, r.discount_rate, r.adoption_rate,
  r.implementation_cost, r.annual_run_cost, r.annual_benefit, r.break_even_months, r.value_5y, r.updated_at::text AS seen
FROM uc_roi_models r
ORDER BY r.case_id, r.scenario, r.version`),
  ]);
  const changes: RoiTotalsChange[] = [];
  for (const r of rows) {
    const after = totalsFromStored({ costLines: r.cost_lines, benefitLines: r.benefit_lines, horizonYears: r.horizon_years, discountRate: r.discount_rate, adoptionRate: r.adoption_rate });
    const before = storedTotals(r);
    if (sameRoiTotals(before, after)) continue;
    changes.push({ id: String(r.id), caseId: String(r.case_id), version: rowNumber(r.version) ?? 1, scenario: String(r.scenario), seen: String(r.seen), before, after });
  }
  return { models: rows.length, changes };
}

/**
 * Scrive i totali del piano, un modello per volta e solo se il modello non è
 * cambiato dopo la lettura (`updated_at`). I totali non toccano `updated_at`:
 * il conto resta quello di prima. Restituisce quanti modelli ha aggiornato e
 * quelli saltati perché cambiati nel frattempo.
 */
export async function applyRoiTotals(executor: UcExecutor, changes: readonly RoiTotalsChange[]): Promise<{ updated: number; skipped: string[] }> {
  let updated = 0;
  const skipped: string[] = [];
  for (const ch of changes) {
    const t = totalsSql(ch.after);
    const [rows] = await executor.batch([
      toStatement(ucSql`UPDATE uc_roi_models SET implementation_cost = ${t.implementation}, annual_run_cost = ${t.run}, annual_benefit = ${t.benefit},
  break_even_months = ${t.breakEven}, value_5y = ${t.value5y}
WHERE id = ${uuid(ch.id)} AND updated_at = ${cast(ch.seen, "timestamptz")}
RETURNING id`),
    ]);
    if (rows.length === 1) updated += 1;
    else skipped.push(ch.id);
  }
  return { updated, skipped };
}

export type { RoiTotals };

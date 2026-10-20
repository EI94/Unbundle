/**
 * Template dei casi d'uso e creazione di un caso dal template (PIANO §4.3, §4.6).
 *
 * Modulo senza import dell'app (`@/…`, `server-only`): lo usano sia l'app
 * (passando `await getAppUcExecutor()`, dopo `ensureUcAvailable()` di
 * `uc-access.ts`) sia gli script operatore (`ucExecutorForUrl(...)`), come
 * `scripts/uc-load-template.ts` e il seed.
 *
 * - Le query di elenco non selezionano mai `definition`.
 * - Ogni lettura per creare un caso filtra `status = 'pubblicato' AND
 *   (restricted_to_workspace_id IS NULL OR restricted_to_workspace_id = $ws)`:
 *   un template non visibile dà lo stesso esito di un template assente.
 * - Chi può creare un caso (utente Lateral Space con `canReviewWorkspacePortfolio`)
 *   lo decide il chiamante; qui si controlla solo che l'attore sia membro del workspace.
 */
import { z } from "zod";
import { fail, ok, type Json, type Result } from "../../uc/types.ts";
import { GATE_POLICY_SCOPES, LEVERS, type GatePolicyScope, type Lever } from "../../uc/vocab.ts";
import { cast, jsonb, raw, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import {
  caseCodeStateSql,
  caseCreateBatches,
  deleteOwnIncompleteCaseSql,
  deleteStaleIncompleteCaseSql,
  STALE_INCOMPLETE_CASE_MINUTES,
  type CaseCreateHeader,
} from "../../uc/sql/case-create.ts";
import {
  buildCaseRows,
  descriptionFromTemplate,
  initialCaseSettings,
  initialReadiness,
  type BlockerMatcher,
  type CaseBuildCounts,
  type CaseGatePolicy,
} from "../../uc/template/case-build.ts";
import { canonicalDefinition, templateDefinitionHash, type CanonicalDefinition, type TemplateLoadPlan } from "../../uc/template/load.ts";
import { validateTemplate } from "../../uc/template/schema.ts";
import { eventInsertFromSql } from "./uc-events.ts";
import { runUcBatch, type UcExecutor, type UcRow } from "../uc-executor.ts";
import { UUID, isUuid } from "../../uc/ids.ts";

// ── Elenco e lettura ──────────────────────────────────────────────────

export interface TemplateListEntry {
  id: string;
  key: string;
  version: string;
  language: string;
  name: string;
  archetype: string;
  industry: string | null;
  functionArea: string | null;
  /** Riservato a questo workspace (contenuti del cliente). */
  restricted: boolean;
  items: number;
  questions: number;
  publishedAt: string | null;
}

/** Template pubblicati e visibili al workspace, senza `definition` e senza scorrerne le voci. */
export function listTemplatesSql(workspaceId: string): UcStatement {
  return toStatement(ucSql`SELECT t.id, t.key, t.version, t.language, t.name, t.archetype, t.industry, t.function_area,
  t.restricted_to_workspace_id IS NOT NULL AS restricted, t.definition_hash, t.published_at
FROM uc_templates t
WHERE ${visibleTemplate(workspaceId)}
ORDER BY t.name, t.key, t.version`);
}

function visibleTemplate(workspaceId: string) {
  return ucSql`t.status = 'pubblicato'
  AND (t.restricted_to_workspace_id IS NULL OR t.restricted_to_workspace_id = ${cast(workspaceId, "uuid")})`;
}

/**
 * Conteggi delle voci e delle domande, in un solo passaggio sulle voci, per i
 * template visibili la cui impronta non è già in `known` (DESIGN §3.2: lo
 * schema si carica con una sola lettura dei conteggi). Un template pubblicato
 * non cambia (`uc_templates_immutable`): la stessa impronta ha sempre gli
 * stessi conteggi.
 */
export function templateCountsSql(workspaceId: string, known: readonly string[]): UcStatement {
  return toStatement(ucSql`SELECT t.id, t.definition_hash,
  count(e.item)::int AS items,
  count(e.item) FILTER (WHERE e.item ->> 'kind' = 'domanda')::int AS questions
FROM uc_templates t
LEFT JOIN LATERAL jsonb_array_elements(t.definition -> 'items') AS e(item) ON true
WHERE ${visibleTemplate(workspaceId)}
  AND NOT (t.definition_hash = ANY(${cast([...known], "text[]")}))
GROUP BY t.id, t.definition_hash`);
}

const toIso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);

interface TemplateCounts {
  items: number;
  questions: number;
}

/** Conteggi già letti, per impronta della definizione (cache del processo, limitata). */
const TEMPLATE_COUNTS = new Map<string, TemplateCounts>();
const TEMPLATE_COUNTS_MAX = 500;

const hashOf = (v: unknown): string | null => (typeof v === "string" && /^[0-9a-f]{64}$/.test(v.trim()) ? v.trim() : null);

/** Ricorda i conteggi di un'impronta; oltre il limite esce la più vecchia (ordine di inserimento della `Map`). */
function rememberCounts(hash: string, counts: TemplateCounts): void {
  TEMPLATE_COUNTS.delete(hash);
  while (TEMPLATE_COUNTS.size >= TEMPLATE_COUNTS_MAX) {
    const oldest = TEMPLATE_COUNTS.keys().next();
    if (oldest.done) break;
    TEMPLATE_COUNTS.delete(oldest.value);
  }
  TEMPLATE_COUNTS.set(hash, counts);
}

/**
 * Template pubblicati e visibili al workspace, con i conteggi. Un solo giro: la
 * lista e i conteggi dei soli template mai contati in questo processo. I
 * conteggi in memoria si copiano prima della lettura: la query salta proprio
 * quelle impronte, quindi un'altra richiesta che nel frattempo svuota o sfoltisce
 * la cache non li fa sparire (sarebbe «0 domande»).
 */
export async function listTemplatesForWorkspace(executor: UcExecutor, workspaceId: string): Promise<TemplateListEntry[]> {
  if (!isUuid(workspaceId)) return [];
  const known = new Map(TEMPLATE_COUNTS);
  const [rows, countRows = []] = await executor.batch([listTemplatesSql(workspaceId), templateCountsSql(workspaceId, [...known.keys()])]);
  const counted = new Map<string, TemplateCounts>();
  for (const r of countRows) {
    const counts = { items: Number(r.items ?? 0), questions: Number(r.questions ?? 0) };
    counted.set(String(r.id), counts);
    const hash = hashOf(r.definition_hash);
    if (hash) rememberCounts(hash, counts);
  }
  return rows.map((r) => {
    const hash = hashOf(r.definition_hash);
    const counts = counted.get(String(r.id)) ?? (hash ? known.get(hash) : undefined) ?? { items: 0, questions: 0 };
    return {
      id: String(r.id),
      key: String(r.key),
      version: String(r.version),
      language: String(r.language),
      name: String(r.name),
      archetype: String(r.archetype),
      industry: (r.industry as string | null) ?? null,
      functionArea: (r.function_area as string | null) ?? null,
      restricted: r.restricted === true,
      items: counts.items,
      questions: counts.questions,
      publishedAt: toIso(r.published_at),
    };
  });
}

export type TemplateRef = { templateId: string } | { key: string; version: string; language?: string };

export interface VisibleTemplate {
  id: string;
  key: string;
  version: string;
  hash: string;
  restricted: boolean;
  definition: CanonicalDefinition;
}

/** Template pubblicato e visibile al workspace (per id, oppure per chiave e versione). */
export function templateForCaseSql(workspaceId: string, ref: TemplateRef): UcStatement {
  const visible = ucSql`t.status = 'pubblicato' AND (t.restricted_to_workspace_id IS NULL OR t.restricted_to_workspace_id = ${cast(workspaceId, "uuid")})`;
  const where =
    "templateId" in ref
      ? ucSql`t.id = ${cast(ref.templateId, "uuid")}`
      : ucSql`t.key = ${cast(ref.key, "text")} AND t.version = ${cast(ref.version, "text")} AND t.language = ${cast(ref.language ?? "it", "text")}`;
  return toStatement(ucSql`SELECT t.id, t.key, t.version, t.definition, t.definition_hash, t.restricted_to_workspace_id IS NOT NULL AS restricted
FROM uc_templates t WHERE ${where} AND ${visible}`);
}

const TEMPLATE_NOT_FOUND = "Template non trovato.";

/**
 * Template per creare un caso. Assente, non pubblicato o riservato a un altro
 * workspace: stesso esito `template_non_trovato`. La definizione si rivalida e
 * l'impronta si ricontrolla.
 */
export async function getTemplateForCase(executor: UcExecutor, workspaceId: string, ref: TemplateRef): Promise<Result<VisibleTemplate>> {
  if (!isUuid(workspaceId) || ("templateId" in ref && !isUuid(ref.templateId))) return fail("template_non_trovato", TEMPLATE_NOT_FOUND);
  const [rows] = await executor.batch([templateForCaseSql(workspaceId, ref)]);
  const row = rows[0];
  if (!row) return fail("template_non_trovato", TEMPLATE_NOT_FOUND);
  const definition = typeof row.definition === "string" ? (JSON.parse(row.definition) as unknown) : row.definition;
  const validation = validateTemplate(definition);
  if (!validation.ok) return fail("template_non_valido", "Il template salvato non è valido: va ricaricato.");
  const canonical = canonicalDefinition(validation.template);
  if (templateDefinitionHash(canonical) !== row.definition_hash) {
    return fail("template_non_valido", "L'impronta del template salvato non corrisponde.");
  }
  return ok({
    id: String(row.id),
    key: String(row.key),
    version: String(row.version),
    hash: String(row.definition_hash),
    restricted: row.restricted === true,
    definition: canonical,
  });
}

// ── Caricamento (scripts/uc-load-template.ts) ─────────────────────────

/** Attore esistente; workspace riservato esistente e attore suo membro. */
export function loaderPrecheckSql(i: { actorUserId: string; restrictedWorkspaceId: string | null }): UcStatement {
  const actor = cast(i.actorUserId, "uuid");
  const ws = cast(i.restrictedWorkspaceId, "uuid");
  return toStatement(ucSql`SELECT
  EXISTS (SELECT 1 FROM users WHERE id = ${actor}) AS actor_exists,
  (${ws} IS NULL OR EXISTS (SELECT 1 FROM workspaces WHERE id = ${ws})) AS workspace_exists,
  (${ws} IS NULL OR EXISTS (
    SELECT 1 FROM workspaces w WHERE w.id = ${ws} AND (
      EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = w.organization_id AND m.user_id = ${actor})
      OR EXISTS (SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id = w.id AND wm.user_id = ${actor}))
  )) AS actor_member`);
}

export function templateLookupSql(key: string, version: string, language: string): UcStatement {
  return toStatement(ucSql`SELECT id, definition_hash, status, restricted_to_workspace_id
FROM uc_templates WHERE key = ${cast(key, "text")} AND version = ${cast(version, "text")} AND language = ${cast(language, "text")}`);
}

/** INSERT idempotente (`ON CONFLICT DO NOTHING`) con l'evento `template.caricato` solo se la riga è nuova. */
export function templateInsertSql(plan: TemplateLoadPlan, i: { actorUserId: string; publish: boolean }): UcStatement {
  const actor = cast(i.actorUserId, "uuid");
  const status = i.publish ? "pubblicato" : "bozza";
  const event = eventInsertFromSql({
    type: "template.caricato",
    workspaceId: plan.restrictedToWorkspaceId,
    actor: { type: "utente", userId: i.actorUserId },
    targetType: "template",
    from: "ins",
    targetIdColumn: "ins.id",
    toStateColumn: "ins.status",
    payload: { key: plan.key, version: plan.version, hash: plan.hash, items: plan.stats.items },
  });
  return toStatement(ucSql`WITH ins AS (
  INSERT INTO uc_templates (key, version, language, name, archetype, industry, function_area, status, definition, definition_hash,
    restricted_to_workspace_id, created_by_user_id, published_by_user_id, published_at)
  VALUES (${cast(plan.key, "text")}, ${cast(plan.version, "text")}, ${cast(plan.language, "text")}, ${cast(plan.name.slice(0, 255), "text")},
    ${cast(plan.archetype, "text")}, ${cast(plan.industry?.slice(0, 80) ?? null, "text")}, ${cast(plan.functionArea?.slice(0, 80) ?? null, "text")},
    ${cast(status, "text")}, ${jsonb(plan.definition)}, ${cast(plan.hash, "text")}, ${cast(plan.restrictedToWorkspaceId, "uuid")},
    ${actor}, ${i.publish ? actor : cast(null, "uuid")}, ${i.publish ? raw("now()") : raw("NULL::timestamptz")})
  ON CONFLICT (key, version, language) DO NOTHING
  RETURNING id, status
), ev AS (${event})
SELECT id, status FROM ins`);
}

/** Pubblica un template già caricato in bozza, con lo stesso contenuto. */
export function templatePublishSql(plan: TemplateLoadPlan, templateId: string, actorUserId: string): UcStatement {
  const event = eventInsertFromSql({
    type: "template.caricato",
    workspaceId: plan.restrictedToWorkspaceId,
    actor: { type: "utente", userId: actorUserId },
    targetType: "template",
    from: "up",
    targetIdColumn: "up.id",
    toStateColumn: "up.status",
    payload: { key: plan.key, version: plan.version, hash: plan.hash, items: plan.stats.items },
  });
  return toStatement(ucSql`WITH up AS (
  UPDATE uc_templates SET status = 'pubblicato', published_at = now(), published_by_user_id = ${cast(actorUserId, "uuid")}, updated_at = now()
  WHERE id = ${cast(templateId, "uuid")} AND status = 'bozza' AND definition_hash = ${cast(plan.hash, "text")}
  RETURNING id, status
), ev AS (${event})
SELECT uc_require(count(*) = 1, 'conflitto') AS ok FROM up`);
}

export type TemplateLoadStatus = "LOADED" | "ALREADY_LOADED" | "PUBLISHED";

export interface TemplateLoadOutcome {
  status: TemplateLoadStatus;
  templateId: string;
  templateStatus: string;
}

function sameRestriction(row: UcRow, plan: TemplateLoadPlan): boolean {
  const current = (row.restricted_to_workspace_id as string | null) ?? null;
  return (current?.toLowerCase() ?? null) === (plan.restrictedToWorkspaceId?.toLowerCase() ?? null);
}

/**
 * Carica un template pianificato con `planTemplateLoad`. Idempotente:
 * - stessa chiave, versione e lingua con la stessa impronta → `ALREADY_LOADED`, nessuna scrittura
 *   (con `publish` su una bozza: la pubblica, `PUBLISHED`);
 * - impronta diversa → errore «Stessa versione con contenuto diverso»;
 * - riserva di workspace diversa → errore.
 */
export async function applyTemplateLoad(
  executor: UcExecutor,
  plan: TemplateLoadPlan,
  i: { actorUserId: string; publish: boolean },
): Promise<Result<TemplateLoadOutcome>> {
  if (!isUuid(i.actorUserId)) return fail("attore_non_valido", "L'id dell'attore non è valido.");
  const [[pre]] = await executor.batch([loaderPrecheckSql({ actorUserId: i.actorUserId, restrictedWorkspaceId: plan.restrictedToWorkspaceId })]);
  if (pre?.actor_exists !== true) return fail("attore_non_trovato", "L'attore indicato non esiste.");
  if (pre.workspace_exists !== true) return fail("workspace_non_trovato", "Il workspace riservato non esiste.");
  if (pre.actor_member !== true) return fail("attore_non_membro", "L'attore non è membro del workspace riservato.");

  const decide = async (row: UcRow): Promise<Result<TemplateLoadOutcome>> => {
    if (row.definition_hash !== plan.hash) {
      return fail("stessa_versione_diversa", "Stessa versione con contenuto diverso: pubblica una nuova versione.");
    }
    if (!sameRestriction(row, plan)) {
      return fail("riserva_diversa", "Questa versione è già caricata con un'altra riserva di workspace.");
    }
    if (i.publish && row.status === "bozza") {
      const result = await runUcBatch(executor, [templatePublishSql(plan, String(row.id), i.actorUserId)]);
      if (!result.ok) return fail(result.code, result.message);
      return ok({ status: "PUBLISHED", templateId: String(row.id), templateStatus: "pubblicato" });
    }
    return ok({ status: "ALREADY_LOADED", templateId: String(row.id), templateStatus: String(row.status) });
  };

  const lookup = templateLookupSql(plan.key, plan.version, plan.language);
  const [[existing]] = await executor.batch([lookup]);
  if (existing) return decide(existing);

  const [inserted] = await executor.batch([templateInsertSql(plan, i)]);
  if (inserted[0]) return ok({ status: "LOADED", templateId: String(inserted[0].id), templateStatus: String(inserted[0].status) });
  // Corsa: un altro caricamento ha appena scritto la stessa versione. Si rilegge e si confronta.
  const [[raced]] = await executor.batch([lookup]);
  if (!raced) return fail("conflitto", "Caricamento non riuscito: riprova.");
  return decide(raced);
}

// ── Creazione di un caso ──────────────────────────────────────────────

const CreateCaseSchema = z.object({
  workspaceId: z.string().regex(UUID),
  actorUserId: z.string().regex(UUID),
  code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, "Il codice usa lettere maiuscole, cifre e trattini (2–40 caratteri)."),
  title: z.string().trim().min(1).max(255),
  oneLiner: z.string().trim().max(500).nullish(),
  perimeterLabel: z.string().trim().max(255).nullish(),
  levers: z.array(z.enum(LEVERS)).max(LEVERS.length).optional(),
  portfolioUseCaseId: z.string().regex(UUID).nullish(),
  gatePolicyScope: z.enum(GATE_POLICY_SCOPES).optional(),
});

export interface CreateCaseFromTemplateInput {
  workspaceId: string;
  template: TemplateRef;
  actorUserId: string;
  code: string;
  title: string;
  oneLiner?: string | null;
  perimeterLabel?: string | null;
  levers?: Lever[];
  portfolioUseCaseId?: string | null;
  /** Regola del gate del caso; default quella del template (`request_modules`). */
  gatePolicyScope?: GatePolicyScope;
  /** Descrizione iniziale; default il testo del template («In breve»). */
  description?: Record<string, Json>;
  /**
   * Blocchi da mettere sopra la descrizione del template (senza `description`):
   * «Avvia la realizzazione» ci porta «In breve» e «Dallo use case».
   */
  descriptionOverrides?: Record<string, Json>;
  /** Iniettabili per i test e per il seed. */
  newId?: () => string;
  now?: () => Date;
  blockerMatcher?: BlockerMatcher;
}

export interface CreatedCase {
  caseId: string;
  code: string;
  templateId: string;
  policy: CaseGatePolicy;
  counts: CaseBuildCounts;
  /** Un caso incompleto più vecchio di 10 minuti con lo stesso codice è stato cancellato prima. */
  replacedIncompleteCaseId: string | null;
}

/**
 * Crea un caso dal template in più batch (§4.6). Il caso compare solo quando
 * l'ultimo batch è riuscito; se un batch fallisce si cancella il caso appena
 * iniziato (ancora incompleto). Un caso incompleto con lo stesso codice più
 * vecchio di 10 minuti viene cancellato prima di riprovare; con una scheda di
 * portafoglio, nel primo batch, anche quelli fermi sulla stessa scheda.
 */
export async function createCaseFromTemplate(executor: UcExecutor, input: CreateCaseFromTemplateInput): Promise<Result<CreatedCase>> {
  const parsed = CreateCaseSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("dati_non_validi", `${issue.path.join(".") || "dati"}: ${issue.message}`);
  }
  const v = parsed.data;
  const newId = input.newId ?? (() => crypto.randomUUID());
  const now = input.now ?? (() => new Date());

  const template = await getTemplateForCase(executor, v.workspaceId, input.template);
  if (!template.ok) return template;
  const def = template.value.definition;

  const build = buildCaseRows(def, {
    newId,
    policy: v.gatePolicyScope ? { scope: v.gatePolicyScope } : undefined,
    blockerMatcher: input.blockerMatcher,
  });

  // Codice già usato?
  const [state] = await executor.batch([caseCodeStateSql(v.workspaceId, v.code)]);
  let replaced: string | null = null;
  const existing = state[0];
  if (existing) {
    if (existing.complete === true) return fail("codice_in_uso", "Esiste già un caso con questo codice nel workspace.");
    if (existing.stale !== true) return fail("creazione_in_corso", "Un caso con questo codice è in creazione: riprova tra qualche minuto.");
    const cleanup = await runUcBatch(executor, [deleteStaleIncompleteCaseSql(v.workspaceId, v.code, String(existing.id))]);
    if (!cleanup.ok) return fail(cleanup.code, cleanup.message);
    replaced = String(existing.id);
  }

  const caseId = newId();
  const header: CaseCreateHeader = {
    caseId,
    workspaceId: v.workspaceId,
    templateId: template.value.id,
    templateHash: template.value.hash,
    templateKey: template.value.key,
    templateVersion: template.value.version,
    code: v.code,
    title: v.title,
    oneLiner: v.oneLiner ?? null,
    perimeterLabel: v.perimeterLabel ?? null,
    levers: v.levers ?? [],
    portfolioUseCaseId: v.portfolioUseCaseId ?? null,
    description: input.description ?? { ...descriptionFromTemplate(def), ...(input.descriptionOverrides ?? {}) },
    settings: initialCaseSettings({ policy: build.policy, confidential: def.confidential, restricted: template.value.restricted }),
    actorUserId: v.actorUserId,
  };
  const batches = caseCreateBatches(header, build, initialReadiness(build, now()));
  // Nella transazione dell'INSERT: le righe incomplete ferme sulla stessa scheda, con un altro codice.
  if (header.portfolioUseCaseId) batches[0] = [deleteStaleIncompleteCardCasesSql(v.workspaceId, header.portfolioUseCaseId), ...batches[0]];

  for (let index = 0; index < batches.length; index++) {
    let result: Awaited<ReturnType<typeof runUcBatch>>;
    try {
      result = await runUcBatch(executor, batches[index]);
    } catch (error) {
      if (index > 0) await bestEffortCleanup(executor, v.workspaceId, caseId);
      throw error;
    }
    if (!result.ok) {
      if (index > 0) await bestEffortCleanup(executor, v.workspaceId, caseId);
      return fail(result.code, CREATE_MESSAGES[result.code] ?? result.message);
    }
  }
  return ok({ caseId, code: v.code, templateId: template.value.id, policy: build.policy, counts: build.counts, replacedIncompleteCaseId: replaced });
}

const CREATE_MESSAGES: Readonly<Record<string, string>> = {
  workspace_non_trovato: "Workspace non trovato.",
  attore_non_membro: "Per creare un caso devi essere membro del workspace.",
  template_non_disponibile: TEMPLATE_NOT_FOUND,
  scheda_non_trovata: "La scheda di portafoglio indicata non è di questo workspace.",
  codice_in_uso: "Esiste già un caso con questo codice nel workspace.",
  caso_non_in_creazione: "La creazione del caso è stata interrotta: riprova.",
  creazione_incompleta: "La creazione del caso non è andata a buon fine: riprova.",
};

/**
 * Dossier incompleti fermi da oltre 10 minuti sulla stessa scheda, con qualunque
 * codice: li lascia una creazione fallita la cui pulizia non è riuscita. Con
 * l'indice unico tra dossier e scheda (docs/use-case/DESIGN.md §10.4) ognuno
 * bloccherebbe per sempre i nuovi dossier della scheda, e una riga sola non è un
 * doppione per `dossier-dups` né per `uc-doctor`. Stessa regola di
 * `deleteStaleIncompleteCaseSql`: mai una riga completa, mai una creazione recente.
 */
function deleteStaleIncompleteCardCasesSql(workspaceId: string, portfolioUseCaseId: string): UcStatement {
  return toStatement(ucSql`DELETE FROM uc_cases
WHERE workspace_id = ${cast(workspaceId, "uuid")} AND portfolio_use_case_id = ${cast(portfolioUseCaseId, "uuid")}
  AND setup_completed_at IS NULL AND created_at < now() - ${raw(`interval '${STALE_INCOMPLETE_CASE_MINUTES} minutes'`)}`);
}

async function bestEffortCleanup(executor: UcExecutor, workspaceId: string, caseId: string): Promise<void> {
  try {
    await executor.batch([deleteOwnIncompleteCaseSql(workspaceId, caseId)]);
  } catch {
    // Resta un caso incompleto e invisibile: lo cancella il prossimo tentativo dopo 10 minuti.
  }
}

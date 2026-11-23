/**
 * Lo schema di partenza «Dal caso d'uso» (docs/dossier/SCHEMA-DI-PARTENZA.md, R1).
 *
 * Un dossier che parte da qui non copia le voci di uno schema di settore: le sue
 * domande sono le voci di «Cosa serve» dello use case (`use_case_needs` collegate
 * con `use_case_need_links`), solo i requisiti non archiviati. Mappa e regole
 * nascono vuote («Da disegnare»); nessuna entità, variabile, formula o fonte.
 *
 * - Il riferimento stabile tra voce e informazione: `uc_items.shared_item_id` =
 *   id dell'informazione, `template_item_key` (e `key`) = `need.<id>`,
 *   `source_refs` = `["use_case_need:<id>"]`. Lo stato della voce segue quello
 *   dell'informazione (`src/lib/uc/sql/need-items.ts`).
 * - Indispensabili: le voci non facoltative. Una voce è facoltativa se il titolo
 *   comincia con «Facoltativa:» o se l'ordine è tra 500 e 900.
 * - La riga di `uc_templates` (pubblica, chiave stabile) si crea alla prima
 *   occasione e non cambia più: la definizione qui sotto è fissa, l'impronta pure.
 *   La definizione ha una voce segnaposto perché lo schema ne chiede almeno una:
 *   la creazione del dossier non la copia mai.
 *
 * Modulo puro, senza import dell'app.
 */
import type { Json } from "../types.ts";
import type { CaseBlockerRow, CaseBuild, CaseBuildCounts, CaseGatePolicy, CaseItemRow } from "./case-build.ts";
import { caseBlockersFromTemplate } from "./case-build.ts";
import { isPermanentBlocker } from "../blockers.ts";

export const FROM_USE_CASE_TEMPLATE = { key: "unbundle.dal_caso", version: "1.0.0", name: "Dal caso d'uso" } as const;

/** Il nome breve per gli script operatore (`--to dal_caso`). */
export const FROM_USE_CASE_ALIAS = "dal_caso";

export function isFromUseCaseTemplateKey(key: string | null | undefined): boolean {
  return key === FROM_USE_CASE_TEMPLATE.key;
}

/** Prefisso della chiave delle voci collegate a un'informazione di «Cosa serve». */
export const NEED_ITEM_KEY_PREFIX = "need.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function needItemKey(needId: string): string {
  return `${NEED_ITEM_KEY_PREFIX}${needId.toLowerCase()}`;
}

/** L'id dell'informazione di una voce collegata; null per ogni altra voce. */
export function needIdOfItemKey(templateItemKey: string | null | undefined): string | null {
  if (typeof templateItemKey !== "string" || !templateItemKey.startsWith(NEED_ITEM_KEY_PREFIX)) return null;
  const id = templateItemKey.slice(NEED_ITEM_KEY_PREFIX.length);
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

/** Facoltativa: titolo che comincia con «Facoltativa:», oppure ordine tra 500 e 900. */
export function isOptionalNeed(need: { title: string; sortOrder: number }): boolean {
  if (/^\s*facoltativ[ao]\s*:/i.test(need.title)) return true;
  return need.sortOrder >= 500 && need.sortOrder <= 900;
}

/** Gli argomenti dello schema: uno per tipo di informazione, nell'ordine di «Cosa serve». */
export const NEED_TOPICS = [
  { kind: "accesso", title: "Accessi" },
  { kind: "dato", title: "Dati" },
  { kind: "documento", title: "Documenti" },
  { kind: "regola", title: "Regole" },
  { kind: "decisione", title: "Decisioni" },
  { kind: "persona", title: "Persone" },
  { kind: "contratto", title: "Contratti" },
  { kind: "altro", title: "Altro" },
] as const;

export function needTopicKey(kind: string | null | undefined): string {
  const known = NEED_TOPICS.find((t) => t.kind === kind);
  return `cs.${known ? known.kind : "altro"}`;
}

/** Lo stato_reason di una voce «mancante» che segue «Cosa serve» (la voce lo vuole sempre). */
export const NEED_MISSING_REASON = "Segnata come mancante in «Cosa serve».";

/** La nota della risposta di sistema che rende validata una voce collegata. */
export const NEED_VALIDATED_NOTE = "Validata in «Cosa serve».";

/** Definizione della riga `uc_templates`: fissa, così l'impronta non cambia mai. */
export function fromUseCaseDefinition(): Record<string, Json> {
  return {
    schema: "unbundle.uc-template/1",
    key: FROM_USE_CASE_TEMPLATE.key,
    version: FROM_USE_CASE_TEMPLATE.version,
    status: "pubblicato",
    language: "it",
    name: FROM_USE_CASE_TEMPLATE.name,
    archetype: "dal_caso_d_uso",
    confidential: false,
    function_area: "ogni use case",
    description:
      "Le domande del dossier sono le voci di «Cosa serve» dello use case, con il loro stato. Mappa e regole si disegnano dopo, dal Progetto dell'agente quando c'è.",
    vocabularies: {
      priority: ["must", "should", "could"],
      serves_for: ["baseline", "modello", "backtest", "monitoraggio", "roi"],
      privacy_class: ["nessuna", "riservato_azienda", "personale", "personale_equipaggio", "escluso_sanitario"],
      availability: ["oggi_export", "con_api", "dopo_a8", "da_chiedere", "da_costruire", "fuori_foundation"],
      perimeter: { in: "in_contratto", out: "evoluzione" },
      levers: ["tempo", "output", "qualita", "nuove_capacita", "decisioni", "costi", "ricavi", "rischio"],
    },
    roles: [],
    sections: [
      { key: "descrizione", title: "Descrizione" },
      { key: "mappa", title: "Mappa" },
      { key: "kpi", title: "KPI" },
      { key: "modello_dati", title: "Modello dati" },
      { key: "regole", title: "Regole" },
      { key: "documenti_dataset", title: "Documenti e dataset" },
      { key: "roi", title: "ROI" },
      { key: "avanzamento", title: "Avanzamento" },
    ],
    blockers: [],
    gates: [
      {
        key: "G1",
        label: "Pronto per lo sviluppo",
        phase: "modello",
        rule: "tutte le voci indispensabili di «Cosa serve»: validate, non applicabili approvate o in deroga valida",
        approvers: ["ls_lead", "owner_cliente"],
      },
    ],
    gate_policy: { scope: "request_modules", default_serves_for: ["modello"], default_perimeter: "in_contratto" },
    map: { kind: "soluzione", title: "Mappa della soluzione", nodes: [], edges: [] },
    items: [
      {
        key: "obj.domande_da_cosa_serve",
        kind: "obiettivo",
        section: "kpi",
        title: "Le domande arrivano da «Cosa serve»",
        explanation: "Voce dello schema, mai copiata nel dossier.",
        priority: "could",
        serves_for: ["modello"],
        privacy_class: "nessuna",
        perimeter: "in_contratto",
      },
    ],
    request_modules: NEED_TOPICS.map((t) => ({ key: needTopicKey(t.kind), title: t.title, items: [] })),
  };
}

// ── Righe del dossier dalle informazioni ──────────────────────────────

/** Un'informazione di «Cosa serve» collegata allo use case (requisito non archiviato). */
export interface NeedForCase {
  id: string;
  title: string;
  detail: string | null;
  kind: string | null;
  status: string;
  sortOrder: number;
}

/** Stato iniziale della voce: quello dell'informazione, salvo «validata» che arriva con la risposta di sistema. */
function initialStatus(): CaseItemRow["status"] {
  return "da_chiedere";
}

/** Riga di `uc_items` per un'informazione (lo stato vero lo mette `needItemsUpdateSql` nello stesso giro). */
export function needItemRow(need: NeedForCase, index: number, id: string): CaseItemRow & { shared_item_id: string } {
  const required = !isOptionalNeed(need);
  return {
    id,
    key: needItemKey(need.id),
    template_item_key: needItemKey(need.id),
    kind: "domanda",
    section: "documenti_dataset",
    parent_item_id: null,
    title: need.title.slice(0, 600),
    explanation: need.detail?.trim() ? need.detail : null,
    why: null,
    example: null,
    help: null,
    spec: { need_id: need.id.toLowerCase(), from: "cosa_serve" },
    priority: required ? "must" : "could",
    serves_for: ["modello"],
    privacy_class: "riservato_azienda",
    availability: [],
    perimeter: "in_contratto",
    levers: [],
    response_type: null,
    response_config: {},
    request_module_key: needTopicKey(need.kind),
    in_gate_scope: true,
    status: initialStatus(),
    owner_role_key: null,
    requires_validity_period: false,
    freshness_days: null,
    source_refs: [`use_case_need:${need.id.toLowerCase()}`],
    sort_order: Number.isFinite(need.sortOrder) ? need.sortOrder : index,
    shared_item_id: need.id.toLowerCase(),
  };
}

/** Le righe del dossier «Dal caso d'uso»: le voci delle informazioni, i blocchi obbligatori, nessuna mappa. */
export function buildCaseRowsFromNeeds(needs: readonly NeedForCase[], options: { newId: () => string; policy: CaseGatePolicy }): CaseBuild {
  const blockers: CaseBlockerRow[] = caseBlockersFromTemplate([]).map((b) => ({
    id: options.newId(),
    key: b.key,
    label: b.label,
    status: isPermanentBlocker({ key: b.key, permanent: b.permanent === true }) ? "permanente" : "attivo",
    scope: b.scope as Record<string, Json>,
    fallback_allowed: b.fallback_allowed ?? null,
  }));
  const items = needs.map((n, index) => needItemRow(n, index, options.newId()));
  const required = items.filter((i) => i.priority === "must").length;
  const counts: CaseBuildCounts = {
    items: items.length,
    links: 0,
    blockers: blockers.length,
    itemBlockers: 0,
    byStatus: { da_chiedere: items.length, bloccata: 0 },
    questions: { total: items.length, da_chiedere: items.length, bloccata: 0 },
    itemBlockersByKey: { questions: {}, others: {} },
    othersWithMultipleBlockers: 0,
    inGateScope: items.length,
    scopeTotal: items.length,
    scopeByStatus: { da_chiedere: items.length, bloccata: 0 },
    g1Required: required,
    g1Should: 0,
    literalRequired: 0,
    literalCoveredByQuestions: 0,
  };
  return { policy: options.policy, items, links: [], blockers, itemBlockers: [], maps: [], milestones: [], counts };
}

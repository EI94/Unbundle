/**
 * Gate G1–G4: calcolo continuo, deroghe, ripieghi, proposta e firme
 * (PIANO §3.6, D1, spec `gate`).
 *
 * Voci richieste: `R(G) = { i | in_gate_scope ∧ non cancellata ∧ must ∧
 * in_contratto ∧ GATE_PHASE[G] ∈ serves_for }`. `in_gate_scope` e i default di
 * `serves_for`/`perimeter` si fissano con la regola del caso
 * (`settings.gate_policy.scope`):
 * - `request_modules` (default): solo le voci dei moduli di richiesta, con i
 *   default sulle domande (sul template del primo caso: 245);
 * - `letterale`: tutte le voci, senza default (la regola alla lettera: 484);
 * - `unione`: le due insieme (729).
 * La regola letterale resta comunque visibile come «copertura del modello dati»
 * (`literalCoverage`). Sui casi a contratto l'approvazione aspetta la conferma
 * della regola (`gateApprovalAllowed`). Nell'MVP solo G1 è disponibile: G2–G4 si
 * calcolano ma non sono mai pronti né approvabili.
 *
 * Modulo puro e senza dipendenze di Node (l'impronta SHA-256 è scritta qui), così
 * `semaforo.ts` resta importabile anche dai componenti client.
 */
import { isCasePastG1 } from "./case-state.ts";
import { isIsoDate, romeDateOf } from "./freshness.ts";
import { actorClasses, approvalsComplete, ownerRoleSatisfied } from "./permissions.ts";
import { fail, ok, type Actor, type Fallback, type Json, type Result, type UserContext, type Waiver } from "./types.ts";
import {
  GATE_POLICY_SCOPES,
  ITEM_STATUSES,
  PERIMETERS,
  PHASES,
  isVocab,
  type BlockerStatus,
  type CaseStatus,
  type DatasetStatus,
  type FilePersonalData,
  type GateKey,
  type GatePolicyScope,
  type ItemKind,
  type ItemStatus,
  type LinkRelation,
  type Perimeter,
  type Phase,
  type Priority,
  type PrivacyClass,
  type ResponseType,
} from "./vocab.ts";

// ── Regola del gate (`uc_cases.settings.gate_policy`) ──────────────────

export interface GatePolicy {
  scope: GatePolicyScope;
  defaultServesFor: Phase[];
  defaultPerimeter: Perimeter;
  /** Conferma della regola (script operatore), obbligatoria per approvare sui casi a contratto. */
  confirmed: { byUserId: string; at: string; note: string | null } | null;
}

export const DEFAULT_GATE_POLICY: Readonly<GatePolicy> = Object.freeze({
  scope: "request_modules",
  defaultServesFor: ["modello"],
  defaultPerimeter: "in_contratto",
  confirmed: null,
}) as GatePolicy;

/** Regola da `settings.gate_policy` (snake_case); i valori non validi tornano al default. */
export function parseGatePolicy(raw: unknown): GatePolicy {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const servesFor = Array.isArray(o.default_serves_for) ? o.default_serves_for.filter((p): p is Phase => isVocab(PHASES, p)) : [];
  const c = o.confirmed && typeof o.confirmed === "object" && !Array.isArray(o.confirmed) ? (o.confirmed as Record<string, unknown>) : null;
  const confirmed =
    c && typeof c.by_user_id === "string" && c.by_user_id && typeof c.at === "string" && c.at
      ? { byUserId: c.by_user_id, at: c.at, note: typeof c.note === "string" ? c.note : null }
      : null;
  return {
    scope: isVocab(GATE_POLICY_SCOPES, o.scope) ? o.scope : DEFAULT_GATE_POLICY.scope,
    defaultServesFor: servesFor.length > 0 ? [...new Set(servesFor)] : [...DEFAULT_GATE_POLICY.defaultServesFor],
    defaultPerimeter: isVocab(PERIMETERS, o.default_perimeter) ? o.default_perimeter : DEFAULT_GATE_POLICY.defaultPerimeter,
    confirmed,
  };
}

/** Regola per `settings.gate_policy`. */
export function gatePolicyToJson(p: GatePolicy): Json {
  return {
    scope: p.scope,
    default_serves_for: [...p.defaultServesFor],
    default_perimeter: p.defaultPerimeter,
    ...(p.confirmed ? { confirmed: { by_user_id: p.confirmed.byUserId, at: p.confirmed.at, note: p.confirmed.note } } : {}),
  };
}

/** Campi a cui la regola ha dato un default (`spec.defaults_applied`). */
export type GateDefaultField = "serves_for" | "perimeter";

/**
 * `in_gate_scope` e default di una voce secondo la regola. Prima toglie i
 * default applicati in passato (`defaultsApplied`), così cambiare regola non
 * lascia tracce: si ricalcola con un comando di caso, senza migrazione.
 * Una voce «raccolta» è una voce di un modulo di richiesta.
 */
export function gateScopeForItem(
  item: { requestModuleKey: string | null; servesFor: readonly Phase[]; perimeter: Perimeter | null; defaultsApplied?: readonly GateDefaultField[] },
  policy: Pick<GatePolicy, "scope" | "defaultServesFor" | "defaultPerimeter">,
): { inGateScope: boolean; servesFor: Phase[]; perimeter: Perimeter | null; defaultsApplied: GateDefaultField[] } {
  const prior = item.defaultsApplied ?? [];
  let servesFor = prior.includes("serves_for") ? [] : [...item.servesFor];
  let perimeter = prior.includes("perimeter") ? null : item.perimeter;
  const collected = item.requestModuleKey !== null;
  const defaultsApplied: GateDefaultField[] = [];
  if (collected && policy.scope !== "letterale") {
    if (servesFor.length === 0) {
      servesFor = [...policy.defaultServesFor];
      defaultsApplied.push("serves_for");
    }
    if (perimeter === null) {
      perimeter = policy.defaultPerimeter;
      defaultsApplied.push("perimeter");
    }
  }
  return { inGateScope: policy.scope === "request_modules" ? collected : true, servesFor, perimeter, defaultsApplied };
}

/**
 * Si può approvare il gate? Nell'MVP solo G1. Su un caso con `contract_refs` la
 * regola del gate deve essere confermata (`settings.gate_policy.confirmed`):
 * il catalogo approvato diventa l'allegato tecnico del contratto. Proposta,
 * calcolo e Avanzamento funzionano comunque.
 */
export function gateApprovalAllowed(i: { policy: Pick<GatePolicy, "confirmed">; contractRefs: readonly unknown[]; gate?: GateKey; available?: readonly GateKey[] }): Result<void> {
  if (i.gate && i.available && !i.available.includes(i.gate)) return fail("gate_non_disponibile", "Gate non disponibile in questa versione.");
  if (i.contractRefs.length > 0 && !i.policy.confirmed) return fail("regola_gate_da_confermare", "Regola del gate da confermare");
  return ok(undefined);
}

// ── Voci richieste ────────────────────────────────────────────────────

export const GATE_PHASE = { G1: "modello", G2: "backtest", G3: "monitoraggio", G4: "roi" } as const satisfies Record<GateKey, Phase>;

/** Quota massima di deroghe sulle voci richieste. */
export const WAIVER_SHARE = 0.1;

/** Deroghe ammesse con `required` voci: `floor(10%)`, quindi nessuna sotto le 10 voci. */
export function waiverCap(required: number): number {
  if (!Number.isInteger(required) || required < 0) throw new Error("Numero di voci non valido");
  return Math.floor(required / 10);
}

/** Fotografia leggera di una voce per il calcolo dei gate (colonne di stato, mai valori). */
export interface GateItem {
  id: string;
  key: string;
  kind: ItemKind;
  status: ItemStatus;
  statusReason?: string | null;
  priority: Priority | null;
  perimeter: Perimeter | null;
  servesFor: readonly Phase[];
  inGateScope: boolean;
  /** Default messi dalla regola (`spec.defaults_applied`): la regola letterale li ignora. */
  defaultsApplied?: readonly GateDefaultField[];
  deleted?: boolean;
  privacyClass: PrivacyClass;
  responseType: ResponseType | null;
  requestModuleKey: string | null;
  ownerRoleKey: string | null;
  responderRoleKey: string | null;
  confirmedByRoleKey: string | null;
  /** `text_hash` della risposta validata o corrente. */
  answerTextHash: string | null;
  answerVersion: number | null;
  staleAt: Date | null;
  naApprovedAt: Date | null;
  waiver: Waiver | null;
  waiverApprovedAt: Date | null;
  fallback: Fallback | null;
  fallbackApprovedAt: Date | null;
  activeBlockerKeys: readonly string[];
  openClarification: boolean;
  /** `spec.health_rule_question`: domanda sulla regola di esclusione dei dati sanitari. */
  healthRuleQuestion?: boolean;
}

type ScopeFacts = Pick<GateItem, "inGateScope" | "priority" | "perimeter" | "servesFor"> & { deleted?: boolean };

/** La voce è in `R(G)`? */
export function isRequired(item: ScopeFacts, gate: GateKey): boolean {
  return item.inGateScope && !item.deleted && item.priority === "must" && item.perimeter === "in_contratto" && item.servesFor.includes(GATE_PHASE[gate]);
}

export function requiredItems<T extends ScopeFacts>(items: readonly T[], gate: GateKey): T[] {
  return items.filter((i) => isRequired(i, gate));
}

/** Voci should e could della stessa fase: non bloccano, si mostrano «da completare». */
function isToComplete(item: ScopeFacts, gate: GateKey): boolean {
  return item.inGateScope && !item.deleted && (item.priority === "should" || item.priority === "could") && item.perimeter === "in_contratto" && item.servesFor.includes(GATE_PHASE[gate]);
}

/** Voce richiesta dalla regola alla lettera: valori del template, senza default e senza `in_gate_scope`. */
export function isLiterallyRequired(item: ScopeFacts & Pick<GateItem, "defaultsApplied">, gate: GateKey): boolean {
  const applied = item.defaultsApplied ?? [];
  const servesFor = applied.includes("serves_for") ? [] : item.servesFor;
  const perimeter = applied.includes("perimeter") ? null : item.perimeter;
  return !item.deleted && item.priority === "must" && perimeter === "in_contratto" && servesFor.includes(GATE_PHASE[gate]);
}

// ── Deroghe e ripieghi ────────────────────────────────────────────────

const PERSONAL_OR_HEALTH: readonly PrivacyClass[] = ["personale", "personale_equipaggio", "escluso_sanitario"];

/**
 * Perché una deroga è vietata su questa voce, oppure null. Mai su dati
 * personali o sanitari, regole normative (`rule.normativa.*`), vincoli rigidi
 * (`hc.*`), voci con il lucchetto (qualunque blocco attivo o permanente, anche
 * `sanitario` o un blocco aggiunto a mano: per loro c'è solo il ripiego
 * approvato, spec gate), domande sulla regola dei dati sanitari.
 */
export function waiverForbiddenReason(
  item: Pick<GateItem, "key" | "kind" | "privacyClass" | "activeBlockerKeys" | "healthRuleQuestion"> & { status?: ItemStatus },
): string | null {
  if (PERSONAL_OR_HEALTH.includes(item.privacyClass)) return "Nessuna deroga sui dati personali o sanitari.";
  if (item.key.startsWith("rule.normativa.")) return "Nessuna deroga sulle regole normative.";
  if (item.kind === "vincolo_rigido" || item.key.startsWith("hc.")) return "Nessuna deroga sui vincoli rigidi.";
  if (item.activeBlockerKeys.length > 0 || item.status === "bloccata") {
    return "Nessuna deroga sulle voci con il lucchetto: serve un ripiego approvato.";
  }
  if (item.healthRuleQuestion) return "Nessuna deroga sulla regola dei dati sanitari.";
  return null;
}

export interface WaiverInput {
  motivo: string;
  piano: string;
  /** Data entro cui chiudere la voce (`YYYY-MM-DD`). */
  scadenza: string;
}

const MIN_TEXT = 10;

/**
 * Proposta di deroga: voce must, ammessa (`waiverForbiddenReason`), motivo e
 * piano scritti, scadenza non passata, e sotto il limite del 10% delle voci
 * richieste (`existingValidWaivers` senza questa voce). Le due firme (ls_lead e
 * Owner) si raccolgono poi con `addSignature(purpose: "deroga")`.
 */
export function checkWaiver(i: {
  item: Pick<GateItem, "key" | "kind" | "priority" | "privacyClass" | "activeBlockerKeys" | "healthRuleQuestion"> & { status?: ItemStatus };
  waiver: WaiverInput;
  gateRequired: number;
  existingValidWaivers: number;
  today: string;
}): Result<void> {
  if (i.item.priority !== "must") return fail("deroga_non_necessaria", "La deroga serve solo per le voci indispensabili (must).");
  const forbidden = waiverForbiddenReason(i.item);
  if (forbidden) return fail("deroga_vietata", forbidden);
  if ((i.waiver.motivo ?? "").trim().length < MIN_TEXT) return fail("motivo_obbligatorio", "Scrivi il motivo della deroga.");
  if ((i.waiver.piano ?? "").trim().length < MIN_TEXT) return fail("piano_obbligatorio", "Scrivi il piano per chiudere la voce.");
  if (!isIsoDate(i.waiver.scadenza) || i.waiver.scadenza < i.today) return fail("scadenza_non_valida", "Scegli una data di chiusura da oggi in poi.");
  const cap = waiverCap(i.gateRequired);
  if (i.existingValidWaivers + 1 > cap) {
    return fail("limite_deroghe", cap === 0 ? "Con meno di 10 voci richieste non si ammettono deroghe." : `Al massimo ${cap} deroghe su ${i.gateRequired} voci richieste (10%).`);
  }
  return ok(undefined);
}

export interface FallbackInput {
  descrizione: string;
  valido_per: readonly GateKey[];
  /** Data entro cui il ripiego va sostituito (`YYYY-MM-DD`), obbligatoria. */
  da_sostituire_entro: string | null;
}

/**
 * Proposta di ripiego: solo su una voce bloccata, mai sui dati sanitari, con
 * una descrizione, la data entro cui va sostituito (spec: «la data in cui va
 * sostituita») e valida solo per lo sviluppo (G1) [D]. Le due firme si
 * raccolgono con `addSignature(purpose: "ripiego")`.
 */
export function checkFallback(i: { item: Pick<GateItem, "status" | "privacyClass" | "activeBlockerKeys">; fallback: FallbackInput; today: string }): Result<void> {
  if (i.item.status !== "bloccata") return fail("ripiego_non_necessario", "Il ripiego serve solo per una voce bloccata.");
  if (i.item.privacyClass === "escluso_sanitario" || i.item.activeBlockerKeys.includes("sanitario")) {
    return fail("ripiego_vietato", "Nessun ripiego sui dati sanitari.");
  }
  if ((i.fallback.descrizione ?? "").trim().length < MIN_TEXT) return fail("descrizione_obbligatoria", "Descrivi l'alternativa.");
  if (i.fallback.valido_per.length === 0 || i.fallback.valido_per.some((g) => g !== "G1")) {
    return fail("ripiego_solo_sviluppo", "Il ripiego vale solo per lo sviluppo (G1).");
  }
  const until = i.fallback.da_sostituire_entro;
  if (until === null || until === undefined || until === "") return fail("scadenza_obbligatoria", "Indica entro quando il ripiego va sostituito.");
  if (!isIsoDate(until) || until < i.today) return fail("scadenza_non_valida", "Scegli una data di sostituzione da oggi in poi.");
  return ok(undefined);
}

// ── Quando una voce è a posto ─────────────────────────────────────────

export type GateVia = "validata" | "na" | "deroga" | "ripiego";

const STATUS_REASON: Readonly<Record<ItemStatus, string>> = {
  da_chiedere: "Da chiedere",
  chiesta: "Chiesta, in attesa di risposta",
  mancante: "Mancante",
  parziale: "Risposta parziale",
  in_verifica: "In verifica",
  validata: "Validata",
  non_applicabile: "Non applicabile senza le due firme",
  bloccata: "Bloccata",
};

/** Deroga approvata con le due firme, ammessa (anche oggi: niente lucchetto) e non scaduta? */
function waiverState(item: GateItem, today: string): "valida" | "scaduta" | null {
  const w = item.waiver;
  if (!w || !item.waiverApprovedAt || !approvalsComplete(w.approvazioni ?? [], "deroga").complete) return null;
  if (waiverForbiddenReason(item)) return null;
  return isIsoDate(w.scadenza) && w.scadenza >= today ? "valida" : "scaduta";
}

function fallbackValid(item: GateItem, gate: GateKey): boolean {
  const f = item.fallback;
  return (
    item.status === "bloccata" &&
    gate === "G1" &&
    !!f &&
    !!item.fallbackApprovedAt &&
    Array.isArray(f.valido_per) &&
    f.valido_per.includes(gate) &&
    approvalsComplete(f.approvazioni ?? [], "ripiego").complete &&
    item.privacyClass !== "escluso_sanitario" &&
    !item.activeBlockerKeys.includes("sanitario")
  );
}

/**
 * La voce è a posto per il gate? (a) validata e non scaduta; (b) non applicabile
 * con le due firme; (c) deroga valida; (d) ripiego approvato su una voce
 * bloccata, solo per G1 [D].
 */
export function isItemOk(item: GateItem, gate: GateKey, now: Date): { ok: boolean; via: GateVia | null; reason?: string } {
  if (item.status === "validata" && (!item.staleAt || item.staleAt.getTime() > now.getTime())) return { ok: true, via: "validata" };
  if (item.status === "non_applicabile" && item.naApprovedAt) return { ok: true, via: "na" };
  const waiver = waiverState(item, romeDateOf(now));
  if (waiver === "valida") return { ok: true, via: "deroga" };
  if (fallbackValid(item, gate)) return { ok: true, via: "ripiego" };
  let reason: string;
  if (item.status === "validata") reason = "Dato scaduto";
  else if (item.status === "bloccata") reason = item.activeBlockerKeys.length > 0 ? `Bloccata: ${[...item.activeBlockerKeys].sort().join(", ")}` : "Bloccata";
  else if (item.status === "mancante" && item.statusReason) reason = `Mancante: ${item.statusReason}`;
  else reason = STATUS_REASON[item.status];
  if (waiver === "scaduta") reason = `${reason} (deroga scaduta)`;
  return { ok: false, via: null, reason };
}

// ── Calcolo del gate ──────────────────────────────────────────────────

export interface DatasetMeta {
  /** Voce `fonte` a cui il dataset appartiene. */
  itemId: string | null;
  status: DatasetStatus;
  /** Almeno un controllo di qualità con esito `errore`. */
  dqError: boolean;
  personalData: FilePersonalData | null;
  periodFrom: string | null;
  periodTo: string | null;
  deleted?: boolean;
}

export interface BlockerMeta {
  key: string;
  status: BlockerStatus;
}

export interface GateMissingItem {
  itemId: string;
  key: string;
  status: ItemStatus;
  reason: string;
  moduleKey: string | null;
  roleKey: string | null;
}

export interface GateCondition {
  key: string;
  ok: boolean;
  message: string;
}

export interface GateComputation {
  gate: GateKey;
  available: boolean;
  required: number;
  ok: number;
  ready: boolean;
  missing: GateMissingItem[];
  byStatus: Record<ItemStatus, number>;
  /** Voci should e could della fase: «da completare», non bloccano. */
  should: { total: number; ok: number };
  waivers: { used: number; cap: number; keys: string[] };
  conditions: GateCondition[];
  /** Testo canonico che firmano Lateral Space e cliente. */
  summaryText: string;
  /** SHA-256 di `summaryText` (`uc_gate_reviews.summary_text_hash`). */
  summaryTextHash: string;
}

const RULE_KINDS: readonly ItemKind[] = ["regola", "vincolo_rigido", "vincolo_morbido"];
const PERSONAL_DATASET: readonly (FilePersonalData | null)[] = ["pseudonimizzati", "identificativi", "sconosciuto"];

function emptyByStatus(): Record<ItemStatus, number> {
  return Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<ItemStatus, number>;
}

/** La regola è confermata dal ruolo che la possiede, con l'impronta del testo confermato? */
function ruleConfirmed(item: GateItem): boolean {
  if (!item.ownerRoleKey || !item.answerTextHash) return false;
  return ownerRoleSatisfied(item);
}

/**
 * Calcola il gate. Pronto quando: il gate è disponibile; `R(G)` non è vuoto e
 * ogni voce è a posto; nessuna ha un chiarimento aperto; ogni `fonte` validata
 * ha un dataset validato senza errori di qualità; regole e vincoli validati sono
 * confermati dal ruolo titolare (con `text_hash`); le deroghe stanno nel 10%.
 * Solo G2 (non raggiungibile nell'MVP): `a8` sciolto se un dataset ha dati
 * personali e periodo dei dataset che copre il backtest.
 */
export function computeGate(i: {
  gate: GateKey;
  items: readonly GateItem[];
  datasets: readonly DatasetMeta[];
  blockers: readonly BlockerMeta[];
  now: Date;
  available: readonly GateKey[];
  caseCode: string;
  policyScope: GatePolicyScope;
  backtestPeriod?: { from: string; to: string } | null;
}): GateComputation {
  const { gate, now } = i;
  const available = i.available.includes(gate);
  const required = requiredItems(i.items, gate);
  const byStatus = emptyByStatus();
  const missing: GateMissingItem[] = [];
  const waiverKeys: string[] = [];
  const validatedSources: GateItem[] = [];
  const validatedRules: GateItem[] = [];
  const lines: string[] = [];
  let okCount = 0;
  let clarifications = 0;
  for (const item of required) {
    byStatus[item.status]++;
    const r = isItemOk(item, gate, now);
    if (item.openClarification) clarifications++;
    if (r.ok) {
      okCount++;
      if (r.via === "deroga") waiverKeys.push(item.key);
      if (r.via === "validata" && item.kind === "fonte") validatedSources.push(item);
      if (r.via === "validata" && (RULE_KINDS.includes(item.kind) || item.responseType === "conferma_regola")) validatedRules.push(item);
    } else {
      missing.push({ itemId: item.id, key: item.key, status: item.status, reason: r.reason ?? STATUS_REASON[item.status], moduleKey: item.requestModuleKey, roleKey: item.ownerRoleKey });
    }
    lines.push(`${item.key}:${item.status}:${item.answerVersion ?? 0}:${r.via === "deroga" ? "deroga" : "-"}`);
  }
  const toComplete = i.items.filter((x) => isToComplete(x, gate));
  const should = { total: toComplete.length, ok: toComplete.filter((x) => isItemOk(x, gate, now).ok).length };
  const cap = waiverCap(required.length);

  const goodDataset = (itemId: string) => i.datasets.some((d) => d.itemId === itemId && !d.deleted && d.status === "validato" && !d.dqError);
  const sourcesWithout = validatedSources.filter((s) => !goodDataset(s.id));
  const rulesUnconfirmed = validatedRules.filter((r) => !ruleConfirmed(r));

  const conditions: GateCondition[] = [
    { key: "disponibile", ok: available, message: available ? "Gate disponibile." : "Gate non disponibile in questa versione." },
    {
      key: "voci_a_posto",
      ok: required.length > 0 && okCount === required.length,
      message: required.length === 0 ? "Nessuna voce richiesta: controlla la regola del gate." : `${okCount} di ${required.length} voci richieste a posto.`,
    },
    { key: "chiarimenti", ok: clarifications === 0, message: clarifications === 0 ? "Nessun chiarimento aperto." : `${clarifications} chiarimenti aperti.` },
    {
      key: "fonti_con_dataset",
      ok: sourcesWithout.length === 0,
      message: sourcesWithout.length === 0 ? "Ogni fonte validata ha un dataset validato." : `${sourcesWithout.length} fonti senza un dataset validato senza errori.`,
    },
    {
      key: "regole_confermate",
      ok: rulesUnconfirmed.length === 0,
      message: rulesUnconfirmed.length === 0 ? "Regole e vincoli confermati dal ruolo titolare." : `${rulesUnconfirmed.length} regole da confermare dal ruolo che le possiede.`,
    },
    {
      key: "deroghe_entro_limite",
      ok: waiverKeys.length <= cap,
      message: `${waiverKeys.length} deroghe su un massimo di ${cap}.`,
    },
  ];
  if (gate === "G2") {
    const requiredIds = new Set(required.map((x) => x.id));
    const used = i.datasets.filter((d) => d.itemId !== null && requiredIds.has(d.itemId) && !d.deleted && d.status === "validato");
    const personal = used.some((d) => PERSONAL_DATASET.includes(d.personalData));
    const a8 = i.blockers.find((b) => b.key === "a8");
    const a8Ok = !personal || (a8?.status ?? "attivo") === "sciolto";
    conditions.push({ key: "a8_dati_reali", ok: a8Ok, message: a8Ok ? "Nessun dato personale senza scheda A.8." : "Un dataset richiesto contiene dati personali: serve la scheda A.8 approvata." });
    const p = i.backtestPeriod;
    const covered = !!p && used.every((d) => !!d.periodFrom && !!d.periodTo && d.periodFrom <= p.from && d.periodTo >= p.to);
    conditions.push({ key: "periodo_backtest", ok: covered, message: !p ? "Indica il periodo del backtest." : covered ? "I dataset coprono il periodo del backtest." : "Un dataset non copre il periodo del backtest." });
  }

  const ready = conditions.every((c) => c.ok);
  const itemsHash = sha256Hex([...lines].sort().join("\n"));
  const summaryText = [
    gate,
    i.caseCode,
    `regola ${i.policyScope}`,
    `${required.length} richieste, ${okCount} a posto`,
    `deroghe: ${waiverKeys.length > 0 ? [...waiverKeys].sort().join(", ") : "nessuna"}`,
    `hash voci: ${itemsHash}`,
  ].join(" · ");
  return {
    gate,
    available,
    required: required.length,
    ok: okCount,
    ready,
    missing,
    byStatus,
    should,
    waivers: { used: waiverKeys.length, cap, keys: [...waiverKeys].sort() },
    conditions,
    summaryText,
    summaryTextHash: sha256Hex(summaryText),
  };
}

export interface CoverageLink {
  fromItemId: string;
  toItemId: string;
  relation: LinkRelation;
}

export interface LiteralCoverage {
  /** Voci richieste dalla regola alla lettera (sul template del primo caso: 484). */
  literalRequired: number;
  /** Di queste, quante sono precisate da almeno una domanda (`precisa`). */
  coveredByQuestions: number;
  /** A posto da sole, oppure coperte e con tutte le domande che le precisano a posto [D]. */
  ok: number;
  uncovered: { itemId: string; key: string }[];
}

/**
 * «Copertura del modello dati»: la regola alla lettera, mostrata accanto al
 * gate come indicatore informativo (D1). Non cambia `ready`.
 */
export function literalCoverage(i: { items: readonly GateItem[]; links: readonly CoverageLink[]; gate: GateKey; now: Date }): LiteralCoverage {
  const byId = new Map(i.items.map((x) => [x.id, x]));
  const questionsFor = new Map<string, GateItem[]>();
  for (const l of i.links) {
    if (l.relation !== "precisa") continue;
    const q = byId.get(l.fromItemId);
    if (!q || q.kind !== "domanda" || q.deleted) continue;
    questionsFor.set(l.toItemId, [...(questionsFor.get(l.toItemId) ?? []), q]);
  }
  const literal = i.items.filter((x) => isLiterallyRequired(x, i.gate));
  let covered = 0;
  let okCount = 0;
  const uncovered: { itemId: string; key: string }[] = [];
  for (const item of literal) {
    const qs = questionsFor.get(item.id) ?? [];
    if (qs.length > 0) covered++;
    else uncovered.push({ itemId: item.id, key: item.key });
    if (isItemOk(item, i.gate, i.now).ok || (qs.length > 0 && qs.every((q) => isItemOk(q, i.gate, i.now).ok))) okCount++;
  }
  return { literalRequired: literal.length, coveredByQuestions: covered, ok: okCount, uncovered };
}

// ── Proposta e firme ──────────────────────────────────────────────────

/** Stati del caso in cui G1 si propone e si firma: raccolta, oppure dopo G1 per riconfermarlo (non sospeso). */
function caseAllowsGate(gate: GateKey, caseStatus: CaseStatus): Result<void> {
  if (gate !== "G1") return ok(undefined);
  if (caseStatus === "raccolta" || (caseStatus !== "sospeso" && isCasePastG1(caseStatus))) return ok(undefined);
  return fail("stato_caso_non_ammesso", "In questo stato del caso il gate non si propone né si firma.");
}

/**
 * Proposta del gate: solo ls_lead, gate disponibile e pronto. Restituisce
 * l'impronta del testo da firmare. Funziona anche con la regola non confermata.
 */
export function checkGateProposal(i: { computation: GateComputation; caseStatus: CaseStatus; actor: Actor; user?: UserContext | null }): Result<{ summaryTextHash: string }> {
  const c = i.computation;
  if (!c.available) return fail("gate_non_disponibile", "Gate non disponibile in questa versione.");
  if (!actorClasses(i.actor, i.user).has("ls_lead")) return fail("attore_non_ammesso", "Solo il Responsabile del caso propone il gate.");
  const state = caseAllowsGate(c.gate, i.caseStatus);
  if (!state.ok) return state;
  if (!c.ready) return fail("gate_non_pronto", c.missing.length > 0 ? `Il gate non è pronto: mancano ${c.missing.length} voci.` : "Il gate non è pronto.");
  return ok({ summaryTextHash: c.summaryTextHash });
}

/**
 * Dopo una firma (`addSignature(purpose: "gate", expectedTextHash)`): il gate si
 * approva con ls_lead e Owner sullo stesso testo, ricalcolato adesso e ancora
 * pronto; contano solo le firme con `text_hash` uguale al testo proposto (il
 * testo canonico che firmano entrambi, §3.6). Sui casi a contratto servono anche
 * la regola confermata e la prova scritta caricata (email o verbale).
 * `transition`: il caso passa da raccolta a pronto_sviluppo (prima approvazione di G1).
 */
export function checkGateSignature(i: {
  computation: GateComputation;
  proposedSummaryHash: string;
  caseStatus: CaseStatus;
  policy: Pick<GatePolicy, "confirmed">;
  contractRefs: readonly unknown[];
  writtenEvidenceFileId: string | null;
  approvals: Parameters<typeof approvalsComplete>[0];
  available: readonly GateKey[];
}): Result<{ complete: boolean; waitingFor: "lateral_space" | "cliente" | "prova_scritta" | null; transition: boolean }> {
  const c = i.computation;
  const allowed = gateApprovalAllowed({ policy: i.policy, contractRefs: i.contractRefs, gate: c.gate, available: i.available });
  if (!allowed.ok) return allowed;
  const state = caseAllowsGate(c.gate, i.caseStatus);
  if (!state.ok) return state;
  if (!c.ready) return fail("gate_non_pronto", "Il gate non è più pronto: rileggi cosa manca.");
  if (c.summaryTextHash !== i.proposedSummaryHash) return fail("testo_cambiato", "Le voci del gate sono cambiate: va proposto di nuovo.");
  const onProposedText = i.approvals.filter((a) => a.text_hash === i.proposedSummaryHash);
  const s = approvalsComplete(onProposedText, "gate");
  if (!s.complete) return ok({ complete: false, waitingFor: s.ls ? "cliente" : "lateral_space", transition: false });
  if (i.contractRefs.length > 0 && !i.writtenEvidenceFileId) return ok({ complete: false, waitingFor: "prova_scritta", transition: false });
  return ok({ complete: true, waitingFor: null, transition: c.gate === "G1" && i.caseStatus === "raccolta" });
}

// ── SHA-256 (puro, senza `node:crypto`) ───────────────────────────────

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 esadecimale del testo UTF-8. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const length = bytes.length;
  const padded = Math.ceil((length + 9) / 64) * 64;
  const buf = new Uint8Array(padded);
  buf.set(bytes);
  buf[length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padded - 8, Math.floor((length * 8) / 0x100000000));
  view.setUint32(padded - 4, (length * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]];
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

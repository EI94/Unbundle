import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  DEFAULT_GATE_POLICY,
  GATE_PHASE,
  checkFallback,
  checkGateProposal,
  checkGateSignature,
  checkWaiver,
  computeGate,
  gateApprovalAllowed,
  gatePolicyToJson,
  gateScopeForItem,
  isItemOk,
  isLiterallyRequired,
  isRequired,
  literalCoverage,
  parseGatePolicy,
  requiredItems,
  sha256Hex,
  waiverCap,
  waiverForbiddenReason,
  type DatasetMeta,
  type GateComputation,
  type GateItem,
} from "./gates.ts";
import type { Actor, Approval, Fallback, Waiver } from "./types.ts";
import { GATE_KEYS, type GateKey, type GatePolicyScope } from "./vocab.ts";

const NOW = new Date("2026-10-07T10:00:00Z");
const TODAY = "2026-10-07";
const AT = "2026-10-05T10:00:00Z";
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

const LS_SIG: Approval = { ruolo: "ls_lead", user_id: "u-lead", at: AT, metodo: "account" };
const OWNER_SIG: Approval = { ruolo: "owner_cliente", contact_id: "c-owner", at: AT, metodo: "link" };
const SIGNED = [LS_SIG, OWNER_SIG];

function gi(id: string, over: Partial<GateItem> = {}): GateItem {
  return {
    id,
    key: `q.area.${id}`,
    kind: "domanda",
    status: "validata",
    statusReason: null,
    priority: "must",
    perimeter: "in_contratto",
    servesFor: ["modello"],
    inGateScope: true,
    defaultsApplied: [],
    deleted: false,
    privacyClass: "riservato_azienda",
    responseType: "numero",
    requestModuleKey: "mod.area.1",
    ownerRoleKey: "resp_area",
    responderRoleKey: "resp_area",
    confirmedByRoleKey: null,
    answerTextHash: "a".repeat(64),
    answerVersion: 1,
    staleAt: null,
    naApprovedAt: null,
    waiver: null,
    waiverApprovedAt: null,
    fallback: null,
    fallbackApprovedAt: null,
    activeBlockerKeys: [],
    openClarification: false,
    healthRuleQuestion: false,
    ...over,
  };
}

const waiver = (over: Partial<Waiver> = {}): Waiver => ({ motivo: "Il dato arriva dopo la chiusura", piano: "Lo chiede il referente entro fine mese", scadenza: "2026-11-30", approvazioni: SIGNED, ...over });
const fallback = (over: Partial<Fallback> = {}): Fallback => ({ descrizione: "Casi sintetici al posto dei dati reali", valido_per: ["G1"], da_sostituire_entro: "2027-01-31", approvazioni: SIGNED, ...over });

function gate(items: GateItem[], over: Partial<Parameters<typeof computeGate>[0]> = {}): GateComputation {
  return computeGate({ gate: "G1", items, datasets: [], blockers: [], now: NOW, available: ["G1"], caseCode: "ES-001", policyScope: "request_modules", ...over });
}

// ── Regola del gate ───────────────────────────────────────────────────

test("gate policy: defaults, parsing and round trip", () => {
  assert.deepEqual(parseGatePolicy(undefined), { scope: "request_modules", defaultServesFor: ["modello"], defaultPerimeter: "in_contratto", confirmed: null });
  assert.deepEqual(parseGatePolicy({ scope: "tutte", default_serves_for: ["x"], default_perimeter: "y" }), parseGatePolicy(null));
  const confirmed = parseGatePolicy({ scope: "unione", default_serves_for: ["modello", "backtest", "modello"], default_perimeter: "in_contratto", confirmed: { by_user_id: "u-op", at: AT, note: "verbale" } });
  assert.deepEqual(confirmed, { scope: "unione", defaultServesFor: ["modello", "backtest"], defaultPerimeter: "in_contratto", confirmed: { byUserId: "u-op", at: AT, note: "verbale" } });
  assert.deepEqual(parseGatePolicy(gatePolicyToJson(confirmed)), confirmed);
  assert.equal(parseGatePolicy({ confirmed: { by_user_id: "", at: AT } }).confirmed, null);
  assert.deepEqual(GATE_PHASE, { G1: "modello", G2: "backtest", G3: "monitoraggio", G4: "roi" });
});

test("in_gate_scope and defaults for the three rules, recomputable without traces", () => {
  const question = { requestModuleKey: "mod.a", servesFor: [], perimeter: null };
  const field = { requestModuleKey: null, servesFor: ["modello" as const], perimeter: "in_contratto" as const };
  const policy = (scope: GatePolicyScope) => ({ ...DEFAULT_GATE_POLICY, scope });
  assert.deepEqual(gateScopeForItem(question, policy("request_modules")), { inGateScope: true, servesFor: ["modello"], perimeter: "in_contratto", defaultsApplied: ["serves_for", "perimeter"] });
  assert.deepEqual(gateScopeForItem(field, policy("request_modules")), { inGateScope: false, servesFor: ["modello"], perimeter: "in_contratto", defaultsApplied: [] });
  assert.deepEqual(gateScopeForItem(question, policy("letterale")), { inGateScope: true, servesFor: [], perimeter: null, defaultsApplied: [] });
  assert.deepEqual(gateScopeForItem(field, policy("letterale")).inGateScope, true);
  assert.deepEqual(gateScopeForItem(question, policy("unione")), { inGateScope: true, servesFor: ["modello"], perimeter: "in_contratto", defaultsApplied: ["serves_for", "perimeter"] });
  // Switching rule removes the defaults applied before.
  const stored = { requestModuleKey: "mod.a", servesFor: ["modello" as const], perimeter: "in_contratto" as const, defaultsApplied: ["serves_for", "perimeter"] as const };
  assert.deepEqual(gateScopeForItem(stored, policy("letterale")), { inGateScope: true, servesFor: [], perimeter: null, defaultsApplied: [] });
  // A question with its own values keeps them.
  assert.deepEqual(gateScopeForItem({ requestModuleKey: "mod.a", servesFor: ["backtest"], perimeter: "evoluzione" }, policy("request_modules")).defaultsApplied, []);
});

test("R(G1) on an example catalog with the three rules", () => {
  // Raw catalog: 4 must questions without serves_for/perimeter (one of them evolution), 1 should question,
  // 3 must fields for the model (one in evolution), 1 must field for backtest only, 1 deleted must field.
  const raw = [
    { id: "q1", requestModuleKey: "m", servesFor: [], perimeter: null, priority: "must" },
    { id: "q2", requestModuleKey: "m", servesFor: [], perimeter: null, priority: "must" },
    { id: "q3", requestModuleKey: "m", servesFor: [], perimeter: null, priority: "must" },
    { id: "q4", requestModuleKey: "m", servesFor: [], perimeter: "evoluzione", priority: "must" },
    { id: "q5", requestModuleKey: "m", servesFor: [], perimeter: null, priority: "should" },
    { id: "f1", requestModuleKey: null, servesFor: ["modello"], perimeter: "in_contratto", priority: "must" },
    { id: "f2", requestModuleKey: null, servesFor: ["modello", "backtest"], perimeter: "in_contratto", priority: "must" },
    { id: "f3", requestModuleKey: null, servesFor: ["modello"], perimeter: "evoluzione", priority: "must" },
    { id: "f4", requestModuleKey: null, servesFor: ["backtest"], perimeter: "in_contratto", priority: "must" },
    { id: "f5", requestModuleKey: null, servesFor: ["modello"], perimeter: "in_contratto", priority: "must", deleted: true },
  ] as const;
  const build = (scope: GatePolicyScope) =>
    raw.map((r) => {
      const s = gateScopeForItem({ requestModuleKey: r.requestModuleKey, servesFor: [...r.servesFor], perimeter: r.perimeter }, { ...DEFAULT_GATE_POLICY, scope });
      return gi(r.id, { requestModuleKey: r.requestModuleKey, priority: r.priority, deleted: "deleted" in r, ...s });
    });
  const ids = (scope: GatePolicyScope, g: GateKey = "G1") => requiredItems(build(scope), g).map((x) => x.id);
  assert.deepEqual(ids("request_modules"), ["q1", "q2", "q3"]);
  assert.deepEqual(ids("letterale"), ["f1", "f2"]);
  assert.deepEqual(ids("unione"), ["q1", "q2", "q3", "f1", "f2"]);
  assert.deepEqual(ids("letterale", "G2"), ["f2", "f4"]);
  // The literal rule ignores defaults and in_gate_scope.
  assert.deepEqual(build("request_modules").filter((x) => isLiterallyRequired(x, "G1")).map((x) => x.id), ["f1", "f2"]);
  assert.equal(isRequired(gi("x", { perimeter: "evoluzione" }), "G1"), false, "evolution is never in R");
});

// ── Voci a posto ──────────────────────────────────────────────────────

test("isItemOk: validated and fresh, NA with signatures, valid waiver, fallback only for G1", () => {
  const later = new Date("2026-12-01T00:00:00Z");
  const cases: [string, GateItem, GateKey, string | null, string?][] = [
    ["validated", gi("a"), "G1", "validata"],
    ["validated, fresh", gi("a", { staleAt: later }), "G1", "validata"],
    ["validated but stale = missing", gi("a", { staleAt: new Date("2026-10-07T09:00:00Z") }), "G1", null, "Dato scaduto"],
    ["NA approved", gi("a", { status: "non_applicabile", naApprovedAt: NOW }), "G1", "na"],
    ["NA without approval", gi("a", { status: "non_applicabile" }), "G1", null, "Non applicabile senza le due firme"],
    ["waiver valid", gi("a", { status: "in_verifica", waiver: waiver(), waiverApprovedAt: NOW }), "G1", "deroga"],
    ["waiver ending today", gi("a", { status: "in_verifica", waiver: waiver({ scadenza: TODAY }), waiverApprovedAt: NOW }), "G1", "deroga"],
    ["waiver expired", gi("a", { status: "in_verifica", waiver: waiver({ scadenza: "2026-10-06" }), waiverApprovedAt: NOW }), "G1", null, "In verifica (deroga scaduta)"],
    ["waiver not approved", gi("a", { status: "in_verifica", waiver: waiver() }), "G1", null, "In verifica"],
    ["waiver with one signature", gi("a", { status: "in_verifica", waiver: waiver({ approvazioni: [LS_SIG] }), waiverApprovedAt: NOW }), "G1", null],
    ["waiver on personal data", gi("a", { status: "in_verifica", privacyClass: "personale", waiver: waiver(), waiverApprovedAt: NOW }), "G1", null],
    ["waiver on an item locked by health data", gi("a", { status: "bloccata", activeBlockerKeys: ["sanitario"], waiver: waiver(), waiverApprovedAt: NOW }), "G1", null, "Bloccata: sanitario"],
    ["waiver on an item locked by system access", gi("a", { status: "bloccata", activeBlockerKeys: ["accesso_sistema"], waiver: waiver(), waiverApprovedAt: NOW }), "G1", null],
    ["fallback for G1", gi("a", { status: "bloccata", activeBlockerKeys: ["accesso_sistema"], fallback: fallback(), fallbackApprovedAt: NOW }), "G1", "ripiego"],
    ["fallback never for G2", gi("a", { status: "bloccata", activeBlockerKeys: ["accesso_sistema"], fallback: fallback({ valido_per: ["G1", "G2"] }), fallbackApprovedAt: NOW }), "G2", null],
    ["fallback not approved", gi("a", { status: "bloccata", activeBlockerKeys: ["a8"], fallback: fallback() }), "G1", null, "Bloccata: a8"],
    ["fallback on health data", gi("a", { status: "bloccata", activeBlockerKeys: ["a8", "sanitario"], fallback: fallback(), fallbackApprovedAt: NOW }), "G1", null, "Bloccata: a8, sanitario"],
    ["missing with its reason", gi("a", { status: "mancante", statusReason: "Il dato oggi non esiste" }), "G1", null, "Mancante: Il dato oggi non esiste"],
    ["asked", gi("a", { status: "chiesta" }), "G1", null, "Chiesta, in attesa di risposta"],
    ["to ask", gi("a", { status: "da_chiedere" }), "G1", null, "Da chiedere"],
    ["partial", gi("a", { status: "parziale" }), "G1", null, "Risposta parziale"],
  ];
  for (const [name, item, g, via, reason] of cases) {
    const r = isItemOk(item, g, NOW);
    assert.equal(r.via, via, name);
    assert.equal(r.ok, via !== null, name);
    if (reason) assert.equal(r.reason, reason, name);
  }
});

test("waiver cap is floor(10%) and nothing below 10 required items", () => {
  assert.deepEqual([0, 9, 10, 19, 20, 52, 245].map(waiverCap), [0, 0, 1, 1, 2, 5, 24]);
  assert.throws(() => waiverCap(-1));
  assert.throws(() => waiverCap(2.5));
});

test("waivers: forbidden items, written reason and plan, deadline, cap", () => {
  const base = { waiver: { motivo: "Il dato arriva dopo la chiusura", piano: "Lo chiede il referente entro fine mese", scadenza: "2026-11-30" }, gateRequired: 20, existingValidWaivers: 0, today: TODAY };
  const cases: [string, Partial<GateItem>, Partial<typeof base>, string][] = [
    ["allowed", {}, {}, "ok"],
    ["should item", { priority: "should" }, {}, "deroga_non_necessaria"],
    ["personal", { privacyClass: "personale" }, {}, "deroga_vietata"],
    ["crew personal", { privacyClass: "personale_equipaggio" }, {}, "deroga_vietata"],
    ["health", { privacyClass: "escluso_sanitario" }, {}, "deroga_vietata"],
    ["regulatory rule", { key: "rule.normativa.esempio", kind: "regola" }, {}, "deroga_vietata"],
    ["hard constraint by kind", { key: "vincolo.altro", kind: "vincolo_rigido" }, {}, "deroga_vietata"],
    ["hard constraint by key", { key: "hc.esempio", kind: "vincolo_rigido" }, {}, "deroga_vietata"],
    ["blocked by a8", { activeBlockerKeys: ["a8"] }, {}, "deroga_vietata"],
    ["outside Foundation", { activeBlockerKeys: ["fuori_foundation"] }, {}, "deroga_vietata"],
    // A locked item opens the gate only with an approved fallback (spec gate), whatever the blocker.
    ["blocked by system access", { activeBlockerKeys: ["accesso_sistema"] }, {}, "deroga_vietata"],
    ["health lock from a manual link", { activeBlockerKeys: ["sanitario"] }, {}, "deroga_vietata"],
    ["manual cost blocker", { activeBlockerKeys: ["costi_art_8_4"] }, {}, "deroga_vietata"],
    ["locked status", { status: "bloccata" }, {}, "deroga_vietata"],
    ["health rule question", { healthRuleQuestion: true }, {}, "deroga_vietata"],
    ["short reason", {}, { waiver: { ...base.waiver, motivo: "boh" } }, "motivo_obbligatorio"],
    ["short plan", {}, { waiver: { ...base.waiver, piano: "poi" } }, "piano_obbligatorio"],
    ["past deadline", {}, { waiver: { ...base.waiver, scadenza: "2026-10-06" } }, "scadenza_non_valida"],
    ["invalid deadline", {}, { waiver: { ...base.waiver, scadenza: "30/11/2026" } }, "scadenza_non_valida"],
    ["9 required: cap 0", {}, { gateRequired: 9 }, "limite_deroghe"],
    ["cap reached", {}, { existingValidWaivers: 2 }, "limite_deroghe"],
    ["last one under the cap", {}, { existingValidWaivers: 1 }, "ok"],
  ];
  for (const [name, item, over, expected] of cases) {
    assert.equal(code(checkWaiver({ ...base, ...over, item: gi("w", item) })), expected, name);
  }
  assert.equal(waiverForbiddenReason(gi("w")), null);
});

test("fallbacks: only on blocked items, never on health data, only for development", () => {
  const blocked = gi("f", { status: "bloccata", activeBlockerKeys: ["accesso_sistema"] });
  const input = { descrizione: "Tabella compilata a mano", valido_per: ["G1"] as GateKey[], da_sostituire_entro: "2026-12-31" };
  assert.equal(code(checkFallback({ item: blocked, fallback: input, today: TODAY })), "ok");
  // The replacement date is mandatory (spec: «la data in cui va sostituita»).
  assert.equal(code(checkFallback({ item: blocked, fallback: { ...input, da_sostituire_entro: null }, today: TODAY })), "scadenza_obbligatoria");
  assert.equal(code(checkFallback({ item: blocked, fallback: { ...input, da_sostituire_entro: "" }, today: TODAY })), "scadenza_obbligatoria");
  assert.equal(code(checkFallback({ item: gi("f"), fallback: input, today: TODAY })), "ripiego_non_necessario");
  assert.equal(code(checkFallback({ item: { ...blocked, activeBlockerKeys: ["sanitario"] }, fallback: input, today: TODAY })), "ripiego_vietato");
  assert.equal(code(checkFallback({ item: blocked, fallback: { ...input, valido_per: ["G1", "G2"] }, today: TODAY })), "ripiego_solo_sviluppo");
  assert.equal(code(checkFallback({ item: blocked, fallback: { ...input, valido_per: [] }, today: TODAY })), "ripiego_solo_sviluppo");
  assert.equal(code(checkFallback({ item: blocked, fallback: { ...input, descrizione: "csv" }, today: TODAY })), "descrizione_obbligatoria");
  assert.equal(code(checkFallback({ item: blocked, fallback: { ...input, da_sostituire_entro: "2026-01-01" }, today: TODAY })), "scadenza_non_valida");
});

// ── Calcolo del gate ──────────────────────────────────────────────────

test("G1 opens when every required item is in place, and lists what is missing otherwise", () => {
  const items = [
    gi("1"),
    gi("2", { status: "non_applicabile", naApprovedAt: NOW }),
    gi("3", { status: "bloccata", activeBlockerKeys: ["accesso_sistema"], fallback: fallback(), fallbackApprovedAt: NOW }),
    gi("4", { priority: "should", status: "chiesta" }),
    gi("5", { priority: "could", status: "validata" }),
    gi("6", { perimeter: "evoluzione", status: "bloccata", activeBlockerKeys: ["decisione_board"] }),
    gi("7", { inGateScope: false, status: "da_chiedere" }),
  ];
  const open = gate(items);
  assert.equal(open.required, 3);
  assert.equal(open.ok, 3);
  assert.equal(open.ready, true);
  assert.deepEqual(open.should, { total: 2, ok: 1 });
  assert.deepEqual(open.missing, []);
  assert.ok(open.conditions.every((c) => c.ok));

  const closed = gate([...items, gi("8", { status: "in_verifica", requestModuleKey: "mod.b", ownerRoleKey: "operativo" }), gi("9", { status: "validata", staleAt: new Date("2026-10-01T00:00:00Z") })]);
  assert.equal(closed.ready, false);
  assert.equal(closed.required, 5);
  assert.equal(closed.ok, 3);
  assert.deepEqual(closed.missing, [
    { itemId: "8", key: "q.area.8", status: "in_verifica", reason: "In verifica", moduleKey: "mod.b", roleKey: "operativo" },
    { itemId: "9", key: "q.area.9", status: "validata", reason: "Dato scaduto", moduleKey: "mod.area.1", roleKey: "resp_area" },
  ]);
  assert.equal(closed.byStatus.validata, 2);
  assert.equal(closed.byStatus.in_verifica, 1);
  assert.equal(closed.conditions.find((c) => c.key === "voci_a_posto")?.message, "3 di 5 voci richieste a posto.");
  // An empty R never opens the gate.
  const empty = gate([gi("x", { priority: "should" })]);
  assert.equal(empty.ready, false);
  assert.equal(empty.conditions.find((c) => c.key === "voci_a_posto")?.ok, false);
});

test("G1 conditions: clarifications, sources with datasets, rules confirmed by their owner, waiver cap", () => {
  const condition = (g: GateComputation, key: string) => g.conditions.find((c) => c.key === key)?.ok;
  // Open clarification on a validated item.
  const clar = gate([gi("1", { openClarification: true })]);
  assert.equal(clar.ready, false);
  assert.equal(condition(clar, "chiarimenti"), false);
  // A validated source needs a validated dataset without quality errors.
  const source = gi("s", { kind: "fonte", key: "src.gestionale.export" });
  const ds = (over: Partial<DatasetMeta> = {}): DatasetMeta => ({ itemId: "s", status: "validato", dqError: false, personalData: "no", periodFrom: null, periodTo: null, ...over });
  assert.equal(condition(gate([source]), "fonti_con_dataset"), false);
  assert.equal(condition(gate([source], { datasets: [ds({ status: "profilato" })] }), "fonti_con_dataset"), false);
  assert.equal(condition(gate([source], { datasets: [ds({ dqError: true })] }), "fonti_con_dataset"), false);
  assert.equal(condition(gate([source], { datasets: [ds({ deleted: true })] }), "fonti_con_dataset"), false);
  assert.equal(gate([source], { datasets: [ds({ dqError: true }), ds()] }).ready, true);
  // Rules: confirmed by the owner role, with the hash of the confirmed text.
  const rule = (over: Partial<GateItem>) => gi("r", { kind: "regola", key: "rule.area.esempio", responseType: null, ...over });
  assert.equal(gate([rule({})]).ready, true);
  assert.equal(condition(gate([rule({ responderRoleKey: "operativo" })]), "regole_confermate"), false, "confirmed by another role");
  assert.equal(gate([rule({ responderRoleKey: "operativo", confirmedByRoleKey: "resp_area" })]).ready, true, "a later confirmation by the owner role");
  assert.equal(condition(gate([rule({ answerTextHash: null })]), "regole_confermate"), false, "no text hash");
  assert.equal(condition(gate([rule({ ownerRoleKey: null, responderRoleKey: null })]), "regole_confermate"), false, "no owner role");
  assert.equal(condition(gate([gi("c", { responseType: "conferma_regola", responderRoleKey: "operativo" })]), "regole_confermate"), false, "rule confirmation question");
  assert.equal(gate([rule({ status: "non_applicabile", naApprovedAt: NOW, answerTextHash: null })]).ready, true, "an NA rule needs no confirmation");
  // Waivers: 10 required → at most 1.
  const tenWith = (n: number) => Array.from({ length: 10 }, (_, k) => (k < n ? gi(`w${k}`, { status: "in_verifica", waiver: waiver(), waiverApprovedAt: NOW }) : gi(`v${k}`)));
  const one = gate(tenWith(1));
  assert.equal(one.ready, true);
  assert.deepEqual(one.waivers, { used: 1, cap: 1, keys: ["q.area.w0"] });
  const two = gate(tenWith(2));
  assert.equal(two.ready, false);
  assert.equal(condition(two, "deroghe_entro_limite"), false);
  assert.equal(two.ok, 10, "items are in place, the cap fails the gate");
});

test("G2–G4 are computed but never available in the MVP", () => {
  const items = [gi("1", { servesFor: ["modello", "backtest", "monitoraggio", "roi"] })];
  for (const g of ["G2", "G3", "G4"] as const) {
    const c = gate(items, { gate: g });
    assert.equal(c.available, false, g);
    assert.equal(c.ready, false, g);
    assert.equal(c.required, 1, g);
  }
  // G2 when available (after the MVP): personal data needs a8, datasets must cover the backtest period.
  const source = gi("s", { kind: "fonte", key: "src.gestionale.voli", servesFor: ["backtest"] });
  const ds: DatasetMeta = { itemId: "s", status: "validato", dqError: false, personalData: "pseudonimizzati", periodFrom: "2025-01-01", periodTo: "2025-12-31" };
  const all = [...GATE_KEYS];
  const g2 = (over: Partial<Parameters<typeof computeGate>[0]>) => gate([source], { gate: "G2", available: all, datasets: [ds], ...over });
  assert.equal(g2({ blockers: [{ key: "a8", status: "attivo" }], backtestPeriod: { from: "2025-07-01", to: "2025-07-31" } }).ready, false);
  assert.equal(g2({ blockers: [{ key: "a8", status: "sciolto" }], backtestPeriod: { from: "2025-07-01", to: "2025-07-31" } }).ready, true);
  assert.equal(g2({ blockers: [{ key: "a8", status: "sciolto" }], backtestPeriod: { from: "2024-07-01", to: "2024-07-31" } }).ready, false);
  assert.equal(g2({ blockers: [{ key: "a8", status: "sciolto" }] }).ready, false, "no backtest period");
});

test("the summary text is canonical, depends only on R(G) and changes with it", () => {
  const items = [gi("1"), gi("2", { status: "in_verifica", answerVersion: 2 }), gi("3", { status: "in_verifica", waiver: waiver(), waiverApprovedAt: NOW })];
  const outside = gi("out", { priority: "should", status: "chiesta" });
  const a = gate([...items, outside]);
  assert.match(a.summaryText, /^G1 · ES-001 · regola request_modules · 3 richieste, 2 a posto · deroghe: q\.area\.3 · hash voci: [0-9a-f]{64}$/);
  assert.equal(a.summaryTextHash, sha256Hex(a.summaryText));
  // Same items in another order, and a change outside R: same text.
  const b = gate([{ ...outside, status: "in_verifica" }, ...[...items].reverse()]);
  assert.equal(b.summaryText, a.summaryText);
  // A new answer version on a required item changes it, and so does the rule.
  assert.notEqual(gate([items[0], { ...items[1], answerVersion: 3 }, items[2]]).summaryText, a.summaryText);
  assert.notEqual(gate(items, { policyScope: "unione" }).summaryTextHash, a.summaryTextHash);
  assert.match(gate([gi("1")]).summaryText, /deroghe: nessuna/);
});

test("sha256Hex matches node:crypto", () => {
  const samples = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "b".repeat(1000), "G1 · città · perché · €", "riga1\nriga2"];
  for (const s of samples) assert.equal(sha256Hex(s), createHash("sha256").update(s, "utf8").digest("hex"), JSON.stringify(s).slice(0, 20));
});

test("literal coverage: fields and KPIs of the model, covered by questions through «precisa»", () => {
  const items = [
    gi("f1", { kind: "campo", key: "ent_a.campo_1", requestModuleKey: null, inGateScope: false, status: "da_chiedere" }),
    gi("f2", { kind: "campo", key: "ent_a.campo_2", requestModuleKey: null, inGateScope: false, status: "da_chiedere" }),
    gi("f3", { kind: "kpi", key: "kpi.area.uno", requestModuleKey: null, inGateScope: false, status: "validata" }),
    gi("f4", { kind: "campo", key: "ent_a.campo_4", requestModuleKey: null, inGateScope: false, status: "da_chiedere", priority: "should" }),
    gi("q1", { status: "validata", defaultsApplied: ["serves_for", "perimeter"] }),
    gi("q2", { status: "in_verifica", defaultsApplied: ["serves_for", "perimeter"] }),
  ];
  const links = [
    { fromItemId: "q1", toItemId: "f1", relation: "precisa" as const },
    { fromItemId: "q2", toItemId: "f2", relation: "precisa" as const },
    { fromItemId: "q1", toItemId: "f2", relation: "precisa" as const },
    { fromItemId: "q1", toItemId: "f3", relation: "usa" as const },
  ];
  const c = literalCoverage({ items, links, gate: "G1", now: NOW });
  assert.equal(c.literalRequired, 3, "questions with defaults and should items do not count");
  assert.equal(c.coveredByQuestions, 2);
  assert.equal(c.ok, 2, "f1 through its validated question, f3 by itself; f2 waits for q2");
  assert.deepEqual(c.uncovered, [{ itemId: "f3", key: "kpi.area.uno" }]);
});

// ── Approvazione ──────────────────────────────────────────────────────

test("gateApprovalAllowed: contract cases wait for the rule to be confirmed; G2–G4 are not available", () => {
  const unconfirmed = parseGatePolicy({});
  const confirmed = parseGatePolicy({ confirmed: { by_user_id: "u-op", at: AT } });
  const r = gateApprovalAllowed({ policy: unconfirmed, contractRefs: ["art. 5.3"] });
  assert.equal(code(r), "regola_gate_da_confermare");
  assert.equal(!r.ok && r.message, "Regola del gate da confermare");
  assert.equal(code(gateApprovalAllowed({ policy: confirmed, contractRefs: ["art. 5.3"] })), "ok");
  assert.equal(code(gateApprovalAllowed({ policy: unconfirmed, contractRefs: [] })), "ok");
  assert.equal(code(gateApprovalAllowed({ policy: confirmed, contractRefs: [], gate: "G2", available: ["G1"] })), "gate_non_disponibile");
});

const LEAD: Actor = { type: "utente", userId: "u-lead", roles: ["ls_lead"] };

test("gate proposal: ls_lead, gate ready, case collecting or past G1 to reconfirm", () => {
  const ready = gate([gi("1")]);
  const notReady = gate([gi("1", { status: "chiesta" })]);
  assert.deepEqual(((r) => r.ok && r.value)(checkGateProposal({ computation: ready, caseStatus: "raccolta", actor: LEAD })), { summaryTextHash: ready.summaryTextHash });
  assert.equal(code(checkGateProposal({ computation: notReady, caseStatus: "raccolta", actor: LEAD })), "gate_non_pronto");
  assert.equal(code(checkGateProposal({ computation: ready, caseStatus: "raccolta", actor: { type: "utente", userId: "u-a", roles: ["ls_analista"] } })), "attore_non_ammesso");
  assert.equal(code(checkGateProposal({ computation: ready, caseStatus: "raccolta", actor: LEAD, user: { userId: "u-lead", emailVerified: true, emailDomain: "x.test", isLateralSpace: false } })), "attore_non_ammesso");
  assert.equal(code(checkGateProposal({ computation: ready, caseStatus: "bozza", actor: LEAD })), "stato_caso_non_ammesso");
  assert.equal(code(checkGateProposal({ computation: ready, caseStatus: "sospeso", actor: LEAD })), "stato_caso_non_ammesso");
  assert.equal(code(checkGateProposal({ computation: ready, caseStatus: "in_sviluppo", actor: LEAD })), "ok");
  assert.equal(code(checkGateProposal({ computation: gate([gi("1")], { gate: "G2" }), caseStatus: "in_sviluppo", actor: LEAD })), "gate_non_disponibile");
});

test("gate signatures: two sides on the same text, contract cases need the rule and written evidence", () => {
  const ready = gate([gi("1")]);
  const base = {
    computation: ready,
    proposedSummaryHash: ready.summaryTextHash,
    caseStatus: "raccolta" as const,
    policy: parseGatePolicy({}),
    contractRefs: [] as string[],
    writtenEvidenceFileId: null,
    approvals: SIGNED.map((a) => ({ ...a, text_hash: ready.summaryTextHash })),
    available: ["G1"] as GateKey[],
  };
  const [lsOnText, ownerOnText] = base.approvals;
  assert.deepEqual(((r) => r.ok && r.value)(checkGateSignature(base)), { complete: true, waitingFor: null, transition: true });
  assert.deepEqual(((r) => r.ok && r.value)(checkGateSignature({ ...base, approvals: [lsOnText] })), { complete: false, waitingFor: "cliente", transition: false });
  assert.deepEqual(((r) => r.ok && r.value)(checkGateSignature({ ...base, approvals: [ownerOnText] })), { complete: false, waitingFor: "lateral_space", transition: false });
  // Only signatures on the proposed text count: no hash, or another text, is no signature.
  assert.deepEqual(((r) => r.ok && r.value)(checkGateSignature({ ...base, approvals: SIGNED })), { complete: false, waitingFor: "lateral_space", transition: false });
  assert.deepEqual(((r) => r.ok && r.value)(checkGateSignature({ ...base, approvals: [lsOnText, { ...ownerOnText, text_hash: "0".repeat(64) }] })), { complete: false, waitingFor: "cliente", transition: false });
  assert.equal(code(checkGateSignature({ ...base, proposedSummaryHash: "0".repeat(64) })), "testo_cambiato");
  assert.equal(code(checkGateSignature({ ...base, computation: gate([gi("1", { status: "in_verifica" })]) })), "gate_non_pronto");
  // Contract case: the rule must be confirmed, then the written evidence completes the approval.
  assert.equal(code(checkGateSignature({ ...base, contractRefs: ["art. 5.3"] })), "regola_gate_da_confermare");
  const confirmed = parseGatePolicy({ confirmed: { by_user_id: "u-op", at: AT } });
  assert.deepEqual(((r) => r.ok && r.value)(checkGateSignature({ ...base, contractRefs: ["art. 5.3"], policy: confirmed })), { complete: false, waitingFor: "prova_scritta", transition: false });
  assert.deepEqual(((r) => r.ok && r.value)(checkGateSignature({ ...base, contractRefs: ["art. 5.3"], policy: confirmed, writtenEvidenceFileId: "file-1" })), { complete: true, waitingFor: null, transition: true });
  // Reconfirmation after G1: complete, no case transition.
  assert.deepEqual(((r) => r.ok && r.value)(checkGateSignature({ ...base, caseStatus: "in_sviluppo" })), { complete: true, waitingFor: null, transition: false });
  assert.equal(code(checkGateSignature({ ...base, caseStatus: "chiuso" })), "stato_caso_non_ammesso");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ITEM_TRANSITIONS,
  ITEM_TRIGGERS,
  checkImportedState,
  checkItemTransition,
  checkNaProposal,
  checkNaRejection,
  isAllowedItemTransition,
  itemTransitionRules,
  triggersFor,
  type ItemTransitionInput,
  type ItemTrigger,
} from "./item-state.ts";
import { actorClasses } from "./permissions.ts";
import type { Actor, AnswerMeta, ItemSnapshot } from "./types.ts";
import { ITEM_STATUSES, type ItemStatus } from "./vocab.ts";

const NOW = new Date("2026-10-07T10:00:00Z");
const EARLIER = new Date("2026-10-01T10:00:00Z");

function answer(over: Partial<AnswerMeta> = {}): AnswerMeta {
  return {
    id: "ans-1",
    version: 1,
    kind: "valore",
    sourceKind: "referente",
    responderContactId: "contact-1",
    responderUserId: null,
    requestId: "req-1",
    validFrom: null,
    createdAt: EARLIER,
    textHash: null,
    typed: true,
    ...over,
  };
}

function snap(over: Partial<ItemSnapshot> = {}): ItemSnapshot {
  return {
    id: "item-1",
    key: "q.modulo.01",
    kind: "domanda",
    status: "da_chiedere",
    priority: "must",
    perimeter: "in_contratto",
    servesFor: ["modello"],
    inGateScope: true,
    privacyClass: "riservato_azienda",
    responseType: "numero",
    ownerRoleKey: "resp_commerciale",
    assigneeContactId: "contact-1",
    requiresValidityPeriod: false,
    freshnessDays: null,
    staleAt: null,
    currentAnswer: null,
    answerResponderUserIds: [],
    currentAnswerTokenIssuerUserIds: [],
    confirmedByContactId: null,
    confirmedByRoleKey: null,
    responderRoleKey: null,
    na: { reason: null, proposedAt: null, lsUserId: null, clientUserId: null, clientContactId: null, approvedAt: null },
    waiver: null,
    fallback: null,
    partialNa: null,
    activeBlockerKeys: [],
    openClarification: false,
    hasActiveRequestItem: true,
    lastAutoCheckError: false,
    ...over,
  };
}

const ACTORS = {
  sistema: { type: "sistema", job: "blocchi" },
  referente: { type: "referente", contactId: "contact-1", requestId: "req-1", roleKey: "resp_commerciale" },
  ls_lead: { type: "utente", userId: "u-lead", roles: ["ls_lead"] },
  ls_analista: { type: "utente", userId: "u-analista", roles: ["ls_analista"] },
  ls_sviluppatore: { type: "utente", userId: "u-dev", roles: ["ls_sviluppatore"] },
  cliente: { type: "utente", userId: "u-owner", roles: ["owner_cliente"] },
  owner_link: { type: "owner_link", contactId: "contact-owner", requestId: "req-appr", designation: "owner" },
  privacy_link: { type: "owner_link", contactId: "contact-privacy", requestId: "req-appr-2", designation: "privacy" },
  approvatore_privacy: { type: "utente", userId: "u-privacy", roles: ["approvatore_privacy"] },
  osservatore: { type: "utente", userId: "u-oss", roles: ["osservatore"] },
} as const satisfies Record<string, Actor>;
type ActorKey = keyof typeof ACTORS;

const NA_SIGNED = { reason: "Il dato non serve a questo caso", proposedAt: EARLIER, lsUserId: "u-lead", clientUserId: "u-owner", clientContactId: null, approvedAt: null };
const VALIDATABLE = {
  currentAnswer: answer(),
  responderRoleKey: "resp_commerciale",
};
const PARTIAL_NA = {
  parte_mancante: "metà",
  motivo: "non esiste",
  approvazioni: [
    { ruolo: "ls_lead", user_id: "u-lead", at: "2026-10-02T09:00:00Z", metodo: "account" },
    { ruolo: "owner_cliente", user_id: "u-owner", at: "2026-10-02T10:00:00Z", metodo: "account" },
  ],
  approved_at: "2026-10-02T10:00:00Z",
} satisfies ItemSnapshot["partialNa"];
/** Riga `uc_request_items` del referente di prova (`req-1`). */
const REF_ITEM = { requestId: "req-1", state: "da_fare" } as const;

interface Scenario {
  row: string;
  from: ItemStatus;
  to: ItemStatus;
  trigger: ItemTrigger;
  actor: ActorKey;
  input?: Partial<Omit<ItemTransitionInput, "item" | "to" | "trigger" | "actor" | "now">>;
  item?: Partial<ItemSnapshot>;
}

const lsValue = { kind: "valore", sourceKind: "documento", sourceRef: "verbale 3" } as const;
const refValue = { kind: "valore", sourceKind: "referente" } as const;

/** Uno scenario valido per ogni riga e ogni motivo della tabella del PIANO §3.2. */
const SCENARIOS: Scenario[] = [
  { row: "1", from: "da_chiedere", to: "chiesta", trigger: "invio_richiesta", actor: "ls_lead" },
  { row: "2", from: "da_chiedere", to: "in_verifica", trigger: "inserimento_ls", actor: "ls_analista", input: { answer: lsValue } },
  { row: "3", from: "da_chiedere", to: "bloccata", trigger: "blocco_attivato", actor: "sistema", input: { blockerKeys: ["a8"] } },
  { row: "4", from: "da_chiedere", to: "non_applicabile", trigger: "na_approvata", actor: "cliente", item: { na: NA_SIGNED } },
  { row: "5", from: "chiesta", to: "in_verifica", trigger: "risposta", actor: "referente", input: { answer: refValue } },
  { row: "5", from: "chiesta", to: "in_verifica", trigger: "inserimento_ls", actor: "ls_lead", input: { answer: lsValue } },
  { row: "6", from: "chiesta", to: "parziale", trigger: "risposta_parziale", actor: "referente", input: { answer: refValue, reason: "Solo 12 righe su 20" } },
  { row: "7a/7d", from: "chiesta", to: "mancante", trigger: "scadenza", actor: "sistema",
    input: { request: { reminderCount: 2, expiresAt: new Date("2026-11-01T00:00:00Z") }, dueAt: EARLIER } },
  { row: "7b", from: "chiesta", to: "mancante", trigger: "non_so", actor: "referente", input: { answer: { kind: "non_so", sourceKind: "referente" } } },
  { row: "7c", from: "chiesta", to: "mancante", trigger: "esito_mancante", actor: "ls_analista", input: { reason: "Il dato oggi non esiste" } },
  { row: "8", from: "chiesta", to: "chiesta", trigger: "delega", actor: "referente" },
  { row: "8", from: "chiesta", to: "chiesta", trigger: "riassegna", actor: "cliente" },
  { row: "9", from: "chiesta", to: "bloccata", trigger: "blocco_attivato", actor: "sistema", input: { blockerKeys: ["a8"] } },
  { row: "10", from: "mancante", to: "chiesta", trigger: "invio_richiesta", actor: "ls_lead", item: { assigneeContactId: "contact-2" } },
  { row: "10", from: "mancante", to: "chiesta", trigger: "riassegna", actor: "cliente", item: { assigneeContactId: "contact-2" } },
  { row: "11", from: "mancante", to: "in_verifica", trigger: "risposta", actor: "referente",
    input: { answer: refValue, actorRequestItem: { requestId: "req-1", state: "non_so" } }, item: { hasActiveRequestItem: false } },
  { row: "11", from: "mancante", to: "in_verifica", trigger: "inserimento_ls", actor: "ls_analista", input: { answer: lsValue } },
  { row: "12", from: "mancante", to: "non_applicabile", trigger: "na_approvata", actor: "ls_lead", item: { na: NA_SIGNED } },
  { row: "13", from: "mancante", to: "bloccata", trigger: "blocco_attivato", actor: "ls_lead", input: { blockerKeys: ["costi_art_8_4"] } },
  { row: "14", from: "parziale", to: "in_verifica", trigger: "risposta", actor: "referente", input: { answer: refValue } },
  { row: "14", from: "parziale", to: "in_verifica", trigger: "inserimento_ls", actor: "ls_lead", input: { answer: lsValue } },
  { row: "15", from: "parziale", to: "chiesta", trigger: "invio_richiesta", actor: "ls_lead" },
  { row: "16", from: "parziale", to: "validata", trigger: "valida", actor: "ls_analista", item: { ...VALIDATABLE, partialNa: PARTIAL_NA } },
  { row: "17", from: "parziale", to: "mancante", trigger: "esito_mancante", actor: "ls_lead", input: { reason: "Il resto non arriverà" } },
  { row: "18", from: "in_verifica", to: "validata", trigger: "valida", actor: "ls_lead", item: VALIDATABLE },
  { row: "19", from: "in_verifica", to: "chiesta", trigger: "chiarimento", actor: "ls_analista", item: VALIDATABLE },
  { row: "19", from: "in_verifica", to: "chiesta", trigger: "richiesta_conferma", actor: "ls_lead",
    item: { currentAnswer: answer({ sourceKind: "dichiarato_in_call", responderContactId: null }) } },
  { row: "19-na", from: "in_verifica", to: "chiesta", trigger: "na_respinta", actor: "ls_lead",
    input: { reason: "Il dato serve al modello" },
    item: { currentAnswer: answer({ kind: "proposta_na" }), na: { ...NA_SIGNED, lsUserId: null, clientUserId: null } } },
  { row: "20", from: "in_verifica", to: "parziale", trigger: "esito_parziale", actor: "ls_analista", input: { reason: "Mancano 8 aeroporti" } },
  { row: "21", from: "in_verifica", to: "mancante", trigger: "esito_mancante", actor: "ls_lead", input: { reason: "Bocciato in verifica" } },
  { row: "22", from: "in_verifica", to: "non_applicabile", trigger: "na_approvata", actor: "owner_link", item: { na: { ...NA_SIGNED, clientUserId: null, clientContactId: "contact-owner" } } },
  { row: "23", from: "validata", to: "in_verifica", trigger: "nuova_versione", actor: "referente",
    input: { answer: { kind: "correzione", sourceKind: "referente" }, actorRequestItem: { requestId: "req-1", state: "inviata" } } },
  { row: "23", from: "validata", to: "in_verifica", trigger: "nuova_versione", actor: "ls_analista", input: { answer: lsValue } },
  { row: "24", from: "validata", to: "in_verifica", trigger: "dato_scaduto", actor: "sistema", item: { staleAt: EARLIER } },
  { row: "25", from: "validata", to: "bloccata", trigger: "blocco_attivato", actor: "sistema", input: { blockerKeys: ["a8"] } },
  { row: "26", from: "non_applicabile", to: "da_chiedere", trigger: "riapri", actor: "ls_lead", input: { reason: "Serve di nuovo" }, item: { na: { ...NA_SIGNED, approvedAt: EARLIER } } },
  { row: "26b", from: "non_applicabile", to: "bloccata", trigger: "riapri", actor: "ls_lead", input: { reason: "Serve di nuovo" },
    item: { na: { ...NA_SIGNED, approvedAt: EARLIER }, privacyClass: "escluso_sanitario", activeBlockerKeys: ["a8", "sanitario"] } },
  { row: "27", from: "bloccata", to: "da_chiedere", trigger: "blocco_sciolto", actor: "sistema", input: { blockerKeys: [] }, item: { activeBlockerKeys: ["a8"] } },
  { row: "28", from: "bloccata", to: "chiesta", trigger: "invio_richiesta", actor: "ls_lead" },
  { row: "29", from: "bloccata", to: "non_applicabile", trigger: "na_approvata", actor: "ls_lead", item: { na: NA_SIGNED, activeBlockerKeys: ["a8"] } },
  { row: "30", from: "parziale", to: "bloccata", trigger: "blocco_attivato", actor: "sistema", input: { blockerKeys: ["a8"] } },
  { row: "30", from: "in_verifica", to: "bloccata", trigger: "blocco_attivato", actor: "sistema", input: { blockerKeys: ["a8"] } },
  { row: "31", from: "chiesta", to: "da_chiedere", trigger: "richiesta_revocata", actor: "ls_lead" },
  { row: "32", from: "chiesta", to: "non_applicabile", trigger: "na_approvata", actor: "ls_lead", item: { na: NA_SIGNED } },
];

function run(s: Scenario, over: Partial<ItemTransitionInput> = {}) {
  return checkItemTransition({
    item: snap({ status: s.from, ...s.item }),
    to: s.to,
    trigger: s.trigger,
    actor: ACTORS[s.actor],
    now: NOW,
    case: { status: "raccolta" },
    actorRequestItem: REF_ITEM,
    ...s.input,
    ...over,
  });
}

/** Le 32 coppie del PIANO (28 della specifica + 4), più non_applicabile → bloccata (riapertura sotto lucchetto). */
const EXPECTED_PAIRS = [
  "da_chiedere>chiesta", "da_chiedere>in_verifica", "da_chiedere>bloccata", "da_chiedere>non_applicabile",
  "chiesta>in_verifica", "chiesta>parziale", "chiesta>mancante", "chiesta>chiesta", "chiesta>bloccata",
  "mancante>chiesta", "mancante>in_verifica", "mancante>non_applicabile", "mancante>bloccata",
  "parziale>in_verifica", "parziale>chiesta", "parziale>validata", "parziale>mancante",
  "in_verifica>validata", "in_verifica>chiesta", "in_verifica>parziale", "in_verifica>mancante", "in_verifica>non_applicabile",
  "validata>in_verifica", "validata>bloccata",
  "non_applicabile>da_chiedere", "non_applicabile>bloccata",
  "bloccata>da_chiedere", "bloccata>chiesta", "bloccata>non_applicabile",
  "parziale>bloccata", "in_verifica>bloccata",
  "chiesta>da_chiedere",
  "chiesta>non_applicabile",
];

test("the whitelist has exactly the 33 pairs (the 32 of the plan plus reopening under a lock)", () => {
  const allowed = ITEM_STATUSES.flatMap((from) => ITEM_TRANSITIONS[from].map((to) => `${from}>${to}`));
  assert.equal(allowed.length, 33);
  assert.deepEqual([...allowed].sort(), [...EXPECTED_PAIRS].sort());
});

test("all 64 pairs: the 33 allowed are reachable, the 31 others are rejected for every trigger", () => {
  let rejected = 0;
  for (const from of ITEM_STATUSES) {
    for (const to of ITEM_STATUSES) {
      const pair = `${from}>${to}`;
      assert.equal(isAllowedItemTransition(from, to), EXPECTED_PAIRS.includes(pair), pair);
      if (EXPECTED_PAIRS.includes(pair)) {
        assert.ok(SCENARIOS.some((s) => s.from === from && s.to === to), `no scenario for ${pair}`);
        continue;
      }
      rejected++;
      for (const trigger of ITEM_TRIGGERS.filter((t) => t !== "import")) {
        for (const actor of Object.values(ACTORS)) {
          const r = checkItemTransition({ item: snap({ status: from }), to, trigger, actor, now: NOW, case: { status: "raccolta" }, reason: "motivo valido" });
          assert.equal(r.ok, false, `${pair} via ${trigger}`);
          assert.equal(!r.ok && r.code, "transizione_non_ammessa", `${pair} via ${trigger}`);
        }
      }
    }
  }
  assert.equal(rejected, 31);
});

test("every row and trigger of the table has a passing scenario", () => {
  for (const rule of itemTransitionRules()) {
    for (const trigger of rule.triggers) {
      const s = SCENARIOS.find((x) => x.row === rule.row && x.from === rule.from && x.to === rule.to && x.trigger === trigger);
      assert.ok(s, `missing scenario for row ${rule.row} ${rule.from}>${rule.to} via ${trigger}`);
    }
  }
  for (const s of SCENARIOS) {
    const r = run(s);
    assert.ok(r.ok, `row ${s.row} ${s.from}>${s.to} via ${s.trigger}: ${!r.ok ? r.code : ""}`);
    if (r.ok) {
      assert.equal(r.value.row, s.row);
      assert.equal(r.value.patch.status, s.to);
    }
  }
});

test("for every row the wrong actors are rejected", () => {
  const rules = itemTransitionRules();
  for (const s of SCENARIOS) {
    const allowedActors = new Set(
      rules.filter((r) => r.from === s.from && r.to === s.to && r.triggers.includes(s.trigger)).flatMap((r) => r.actors),
    );
    for (const key of Object.keys(ACTORS) as ActorKey[]) {
      const classes = actorClasses(ACTORS[key]);
      if ([...classes].some((c) => allowedActors.has(c))) continue;
      const r = run(s, { actor: ACTORS[key] });
      assert.equal(r.ok, false, `row ${s.row} via ${s.trigger} by ${key}`);
      assert.equal(!r.ok && r.code, "attore_non_ammesso", `row ${s.row} via ${s.trigger} by ${key}`);
    }
  }
});

test("a trigger that does not belong to an allowed pair is rejected", () => {
  const r = checkItemTransition({ item: snap({ status: "in_verifica" }), to: "validata", trigger: "risposta", actor: ACTORS.ls_lead, now: NOW, case: { status: "raccolta" } });
  assert.equal(!r.ok && r.code, "motivo_non_ammesso");
  assert.deepEqual(triggersFor("validata", "in_verifica").sort(), ["dato_scaduto", "nuova_versione"]);
});

test("the reason is mandatory where the plan asks for it, and missing items always show one", () => {
  const required = itemTransitionRules().filter((r) => r.reasonRequired);
  assert.ok(required.length >= 7);
  for (const rule of required) {
    for (const trigger of rule.triggers) {
      const s = SCENARIOS.find((x) => x.row === rule.row && x.trigger === trigger)!;
      const r = run(s, { reason: "  " });
      assert.equal(!r.ok && r.code, "motivo_obbligatorio", `row ${rule.row}`);
    }
  }
  for (const s of SCENARIOS.filter((x) => x.to === "mancante")) {
    const r = run(s);
    assert.ok(r.ok && r.value.patch.statusReason, `row ${s.row}`);
  }
});

test("import is outside the state machine and only the system writes initial states", () => {
  const r = checkItemTransition({ item: snap(), to: "in_verifica", trigger: "import", actor: { type: "sistema", job: "seed" }, now: NOW, case: { status: "bozza" } });
  assert.equal(!r.ok && r.code, "import_fuori_macchina");
  const seed: Actor = { type: "sistema", job: "seed" };
  assert.ok(checkImportedState({ actor: seed, status: "in_verifica", blockerKeys: [] }).ok);
  assert.ok(checkImportedState({ actor: { type: "sistema", job: "creazione" }, status: "bloccata", blockerKeys: ["a8"] }).ok);
  assert.equal(checkImportedState({ actor: seed, status: "da_chiedere", blockerKeys: ["a8"] }).ok, false);
  assert.equal(checkImportedState({ actor: seed, status: "bloccata", blockerKeys: [] }).ok, false);
  assert.equal(checkImportedState({ actor: seed, status: "validata", blockerKeys: [] }).ok, false);
  assert.equal(checkImportedState({ actor: seed, status: "mancante", blockerKeys: [] }).ok, false);
  assert.ok(checkImportedState({ actor: seed, status: "mancante", blockerKeys: [], statusReason: "Non esiste oggi" }).ok);
  assert.equal(checkImportedState({ actor: ACTORS.ls_lead, status: "in_verifica", blockerKeys: [] }).ok, false);
  assert.equal(checkImportedState({ actor: { type: "sistema", job: "uc-reminders" }, status: "in_verifica", blockerKeys: [] }).ok, false);
});

test("row 1: sending needs an assignee, an active request item and no blocker; the first send opens the collection", () => {
  const s = SCENARIOS.find((x) => x.row === "1")!;
  const first = run(s, { case: { status: "bozza" } });
  assert.ok(first.ok);
  assert.deepEqual(first.ok && first.value.sideEffects, ["caso_in_raccolta"]);
  assert.equal(first.ok && first.value.requestItemState, null);
  const later = run(s);
  assert.deepEqual(later.ok && later.value.sideEffects, []);
  assert.equal(run({ ...s, item: { assigneeContactId: null } }).ok, false);
  assert.equal(run({ ...s, item: { hasActiveRequestItem: false } }).ok, false);
  const blocked = run({ ...s, item: { activeBlockerKeys: ["a8"] } });
  assert.equal(!blocked.ok && blocked.code, "blocco_attivo");
});

test("row 31: single and bulk revocation bring the item back to da_chiedere and take it out of the link", () => {
  const s = SCENARIOS.find((x) => x.row === "31")!;
  for (const actor of [ACTORS.ls_lead, { type: "sistema", job: "uc-reminders" } as const]) {
    const r = run(s, { actor });
    assert.ok(r.ok);
    assert.equal(r.ok && r.value.patch.status, "da_chiedere");
    assert.equal(r.ok && r.value.requestItemState, "riassegnata");
  }
  // The revocation that comes with the closing of the case still passes.
  const closing = run(s, { actor: { type: "sistema", job: "blocchi" }, case: { status: "chiuso" } });
  assert.ok(closing.ok);
});

test("row 7: missing after two reminders, or because the link expired", () => {
  const s = SCENARIOS.find((x) => x.row === "7a/7d")!;
  const a = run(s);
  assert.equal(a.ok && a.value.patch.statusReason, "Scaduta dopo 2 promemoria");
  const d = run(s, { request: { reminderCount: 0, expiresAt: EARLIER }, dueAt: null });
  assert.equal(d.ok && d.value.patch.statusReason, "Link scaduto senza risposta");
  const oneReminder = run(s, { request: { reminderCount: 1, expiresAt: new Date("2026-11-01T00:00:00Z") } });
  assert.equal(!oneReminder.ok && oneReminder.code, "non_scaduta");
  const notDue = run(s, { dueAt: new Date("2026-10-20T00:00:00Z") });
  assert.equal(!notDue.ok && notDue.code, "non_scaduta");
});

test("row 7b: «Non lo so» is a valid answer that makes the item missing, with a visible reason", () => {
  const s = SCENARIOS.find((x) => x.row === "7b")!;
  const r = run(s);
  assert.ok(r.ok);
  assert.equal(r.ok && r.value.requestItemState, "non_so");
  assert.match(r.ok ? r.value.patch.statusReason ?? "" : "", /Non lo so/);
  // A delegation is not «Non lo so».
  assert.equal(run(s, { answer: { kind: "delega", sourceKind: "referente" } }).ok, false);
});

test("row 32 and the other NA rows need both signatures", () => {
  for (const s of SCENARIOS.filter((x) => x.trigger === "na_approvata")) {
    const onlyLs = run(s, { item: snap({ status: s.from, ...s.item, na: { ...NA_SIGNED, clientUserId: null, clientContactId: null } }) });
    assert.equal(!onlyLs.ok && onlyLs.code, "firme_mancanti", `row ${s.row} only LS`);
    const onlyClient = run(s, { item: snap({ status: s.from, ...s.item, na: { ...NA_SIGNED, lsUserId: null } }) });
    assert.equal(!onlyClient.ok && onlyClient.code, "firme_mancanti", `row ${s.row} only client`);
    const noReason = run(s, { item: snap({ status: s.from, ...s.item, na: { ...NA_SIGNED, reason: null } }) });
    assert.equal(noReason.ok, false, `row ${s.row} without reason`);
    const both = run(s);
    assert.ok(both.ok, `row ${s.row} both`);
    assert.equal(both.ok && both.value.patch.naApprovedAt, NOW);
  }
  const r32 = run(SCENARIOS.find((x) => x.row === "32")!);
  assert.equal(r32.ok && r32.value.requestItemState, "riassegnata");
});

test("NA proposed by the referent goes to verification; rejected, it goes back to chiesta", () => {
  const s = SCENARIOS.find((x) => x.row === "5" && x.trigger === "risposta")!;
  const short = run(s, { answer: { kind: "proposta_na", sourceKind: "referente" }, reason: "no" });
  assert.equal(!short.ok && short.code, "motivo_obbligatorio");
  const r = run(s, { answer: { kind: "proposta_na", sourceKind: "referente" }, reason: "Non usiamo questo listino" });
  assert.ok(r.ok);
  assert.equal(r.ok && r.value.patch.status, "in_verifica");
  assert.equal(r.ok && r.value.patch.naProposedAt, NOW);
  assert.equal(r.ok && r.value.patch.naProposedByContactId, "contact-1");
  assert.equal(r.ok && r.value.patch.naReason, "Non usiamo questo listino");

  const proposed = snap({ status: "in_verifica", currentAnswer: answer({ kind: "proposta_na" }), na: { ...NA_SIGNED, lsUserId: null, clientUserId: null } });
  const rejected = checkNaRejection({ item: proposed, actor: ACTORS.cliente, reason: "Il dato serve", now: NOW, case: { status: "raccolta" } });
  assert.ok(rejected.ok && rejected.value.kind === "transizione");
  if (rejected.ok && rejected.value.kind === "transizione") {
    assert.equal(rejected.value.plan.patch.status, "chiesta");
    assert.equal(rejected.value.plan.patch.naProposedAt, null);
    assert.equal(rejected.value.plan.requestItemState, "da_fare");
  }
  const byReferent = checkNaRejection({ item: proposed, actor: ACTORS.referente, reason: "x", now: NOW, case: { status: "raccolta" } });
  assert.equal(byReferent.ok, false);
});

test("NA proposed by Lateral Space keeps the state; rejected, the proposal is cleared", () => {
  const item = snap({ status: "chiesta" });
  const p = checkNaProposal({ item, actor: ACTORS.ls_analista, reason: "Fuori dal perimetro del modello", now: NOW, case: { status: "raccolta" } });
  assert.ok(p.ok);
  assert.equal(p.ok && p.value.patch.naProposedByUserId, "u-analista");
  assert.equal(p.ok && "status" in p.value.patch, false);
  assert.equal(checkNaProposal({ item, actor: ACTORS.cliente, reason: "Fuori dal perimetro", now: NOW, case: { status: "raccolta" } }).ok, false);
  assert.equal(checkNaProposal({ item, actor: ACTORS.ls_lead, reason: "corto", now: NOW, case: { status: "raccolta" } }).ok, false);
  assert.equal(checkNaProposal({ item: snap({ status: "validata" }), actor: ACTORS.ls_lead, reason: "Fuori dal perimetro", now: NOW, case: { status: "raccolta" } }).ok, false);
  const already = snap({ status: "chiesta", na: { ...NA_SIGNED, lsUserId: null, clientUserId: null } });
  assert.equal(checkNaProposal({ item: already, actor: ACTORS.ls_lead, reason: "Fuori dal perimetro", now: NOW, case: { status: "raccolta" } }).ok, false);
  const rejected = checkNaRejection({ item: already, actor: ACTORS.ls_lead, reason: "Serve", now: NOW, case: { status: "raccolta" } });
  assert.ok(rejected.ok && rejected.value.kind === "azzera");
});

test("validation writes the validated answer, the validator and the freshness deadline", () => {
  const s = SCENARIOS.find((x) => x.row === "18")!;
  const r = run(s, { item: snap({ status: "in_verifica", ...VALIDATABLE, freshnessDays: 7, currentAnswer: answer({ validFrom: "2026-10-05" }) }) });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.patch.validatedAnswerId, "ans-1");
    assert.equal(r.value.patch.validatedByUserId, "u-lead");
    assert.equal(r.value.patch.validatedAt, NOW);
    assert.equal(r.value.patch.staleAt?.toISOString(), "2026-10-11T22:00:00.000Z");
  }
  // Four eyes: the analyst who answered cannot validate (full guards in permissions.test.ts).
  const own = run(s, { item: snap({ status: "in_verifica", ...VALIDATABLE, answerResponderUserIds: ["u-lead"] }) });
  assert.equal(!own.ok && own.code, "stessa_persona");
  // Partial → validated only with the missing part declared not applicable by both signatures.
  const p = SCENARIOS.find((x) => x.row === "16")!;
  const noPartialNa = run(p, { item: snap({ status: "parziale", ...VALIDATABLE }) });
  assert.equal(!noPartialNa.ok && noPartialNa.code, "parte_mancante_non_approvata");
});

test("roles are recomputed with the user context: a Lateral Space role without a Lateral Space user does not count", () => {
  const s = SCENARIOS.find((x) => x.row === "18")!;
  const notLs = run(s, { user: { userId: "u-lead", emailVerified: true, emailDomain: "cliente.test", isLateralSpace: false } });
  assert.equal(!notLs.ok && notLs.code, "attore_non_ammesso");
  const ls = run(s, { user: { userId: "u-lead", emailVerified: true, emailDomain: "ls.test", isLateralSpace: true } });
  assert.ok(ls.ok);
  const otherUser = run(s, { user: { userId: "u-x", emailVerified: true, emailDomain: "ls.test", isLateralSpace: true } });
  assert.equal(otherUser.ok, false);
});

test("a regression of a green or blue item after G1 asks to reconfirm the gate", () => {
  const s = SCENARIOS.find((x) => x.row === "23" && x.actor === "referente")!;
  const before = run(s);
  assert.equal(before.ok && before.value.gateReconfirm, false);
  const after = run(s, { case: { status: "pronto_sviluppo" } });
  assert.equal(after.ok && after.value.gateReconfirm, true);
  const suspended = run({ ...s, actor: "ls_analista", input: { answer: lsValue } }, { case: { status: "sospeso", statusBeforeSuspension: "in_sviluppo" } });
  assert.equal(suspended.ok && suspended.value.gateReconfirm, true);
  for (const row of ["24", "25", "26"]) {
    const x = SCENARIOS.find((y) => y.row === row)!;
    const r = run(x, { case: { status: "in_sviluppo" } });
    assert.equal(r.ok && r.value.gateReconfirm, true, `row ${row}`);
  }
  const notResting = run(SCENARIOS.find((y) => y.row === "21")!, { case: { status: "in_sviluppo" } });
  assert.equal(notResting.ok && notResting.value.gateReconfirm, false);
});

test("a closed case freezes items; a suspended case refuses referents, sends and expiries", () => {
  const send = SCENARIOS.find((x) => x.row === "1")!;
  const r = run(send, { case: { status: "chiuso" } });
  assert.equal(!r.ok && r.code, "caso_chiuso");
  assert.equal(((x) => !x.ok && x.code)(run(send, { case: { status: "sospeso", statusBeforeSuspension: "raccolta" } })), "caso_sospeso");
  const answerRow = SCENARIOS.find((x) => x.row === "5" && x.actor === "referente")!;
  assert.equal(((x) => !x.ok && x.code)(run(answerRow, { case: { status: "sospeso", statusBeforeSuspension: "raccolta" } })), "caso_sospeso");
  const expiry = SCENARIOS.find((x) => x.row === "7a/7d")!;
  assert.equal(((x) => !x.ok && x.code)(run(expiry, { case: { status: "sospeso", statusBeforeSuspension: "raccolta" } })), "caso_sospeso");
  // Lateral Space can still verify while the case is suspended.
  assert.ok(run(SCENARIOS.find((x) => x.row === "18")!, { case: { status: "sospeso", statusBeforeSuspension: "raccolta" } }).ok);
});

test("guards on answers, blockers, confirmations and request items", () => {
  // Row 2: Lateral Space needs a known source and a reference.
  const r2 = SCENARIOS.find((x) => x.row === "2")!;
  assert.equal(((x) => !x.ok && x.code)(run(r2, { answer: { kind: "valore", sourceKind: "referente", sourceRef: "x" } })), "fonte_non_ammessa");
  assert.equal(((x) => !x.ok && x.code)(run(r2, { answer: { kind: "valore", sourceKind: "documento", sourceRef: " " } })), "fonte_obbligatoria");
  assert.equal(((x) => !x.ok && x.code)(run(r2, { answer: null })), "risposta_assente");
  // Row 5: a referent answers only from an active request item and as «referente».
  const r5 = SCENARIOS.find((x) => x.row === "5" && x.actor === "referente")!;
  assert.equal(((x) => !x.ok && x.code)(run(r5, { item: snap({ status: "chiesta", hasActiveRequestItem: false }) })), "richiesta_assente");
  assert.equal(((x) => !x.ok && x.code)(run(r5, { answer: { kind: "valore", sourceKind: "lateral_space" } })), "fonte_non_ammessa");
  const r5ok = run(r5);
  assert.equal(r5ok.ok && r5ok.value.requestItemState, "inviata");
  // Lateral Space inserting a value on an asked item takes it out of the link.
  const r5ls = run(SCENARIOS.find((x) => x.row === "5" && x.actor === "ls_lead")!);
  assert.equal(r5ls.ok && r5ls.value.requestItemState, "riassegnata");
  // Row 8 keeps the state and records an assignment event.
  const r8 = run(SCENARIOS.find((x) => x.row === "8" && x.trigger === "delega")!);
  assert.ok(r8.ok);
  assert.equal(r8.ok && r8.value.eventType, "voce.assegnata");
  assert.equal(r8.ok && r8.value.patch.statusChangedAt, undefined);
  assert.equal(r8.ok && r8.value.requestItemState, "delegata");
  // Blocking needs a blocker; unblocking needs none left.
  assert.equal(((x) => !x.ok && x.code)(run(SCENARIOS.find((x) => x.row === "3")!, { blockerKeys: [] })), "blocco_assente");
  const r27 = SCENARIOS.find((x) => x.row === "27")!;
  assert.equal(((x) => !x.ok && x.code)(run(r27, { blockerKeys: ["decisione_board"] })), "blocco_attivo");
  const r9 = run(SCENARIOS.find((x) => x.row === "9")!);
  assert.equal(r9.ok && r9.value.requestItemState, "riassegnata");
  assert.equal(r9.ok && r9.value.patch.statusReason, "Bloccata: a8");
  // Row 19: a confirmation is asked only when the value does not come from its owner.
  const conf = SCENARIOS.find((x) => x.trigger === "richiesta_conferma")!;
  const fromOwner = run(conf, { item: snap({ status: "in_verifica", ...VALIDATABLE }) });
  assert.equal(!fromOwner.ok && fromOwner.code, "conferma_non_necessaria");
  const wrongRole = run(conf, { item: snap({ status: "in_verifica", currentAnswer: answer(), responderRoleKey: "operativo" }) });
  assert.ok(wrongRole.ok);
  const clar = SCENARIOS.find((x) => x.trigger === "chiarimento")!;
  const clarNoContact = run(clar, { item: snap({ status: "in_verifica", currentAnswer: answer({ responderContactId: null, sourceKind: "documento" }) }) });
  assert.equal(!clarNoContact.ok && clarNoContact.code, "referente_assente");
  const clarOk = run(clar);
  assert.deepEqual(clarOk.ok && clarOk.value.sideEffects, ["chiarimento_al_referente"]);
  assert.equal(clarOk.ok && clarOk.value.requestItemState, "da_fare");
  // Row 24 needs an expired value.
  assert.equal(((x) => !x.ok && x.code)(run(SCENARIOS.find((x) => x.row === "24")!, { item: snap({ status: "validata", staleAt: new Date("2026-12-01T00:00:00Z") }) })), "non_scaduta");
  // Row 26 clears the NA signatures (they stay in the events).
  const r26 = run(SCENARIOS.find((x) => x.row === "26")!);
  assert.equal(r26.ok && r26.value.patch.naApprovedAt, null);
  assert.deepEqual(r26.ok && r26.value.sideEffects, ["firme_na_azzerate"]);
});

test("after G1 only items required by G1 ask to reconfirm the gate", () => {
  const s = SCENARIOS.find((x) => x.row === "23" && x.actor === "referente")!;
  const required = run(s, { case: { status: "in_sviluppo" } });
  assert.equal(required.ok && required.value.gateReconfirm, true);
  for (const over of [{ priority: "should" as const }, { perimeter: "evoluzione" as const }, { inGateScope: false }, { servesFor: ["backtest" as const] }]) {
    const r = run({ ...s, item: { ...s.item, ...over } }, { case: { status: "in_sviluppo" } });
    assert.equal(r.ok && r.value.gateReconfirm, false, JSON.stringify(over));
  }
});

test("a referent acts only on items assigned to them and present in their own request", () => {
  const referentRows = SCENARIOS.filter((s) => s.actor === "referente");
  assert.ok(referentRows.length >= 7);
  for (const s of referentRows) {
    const label = `row ${s.row} via ${s.trigger}`;
    // Another contact, from another request: the item was reassigned.
    const other = run(s, {
      actor: { type: "referente", contactId: "contact-old", requestId: "req-old", roleKey: "resp_commerciale" },
      actorRequestItem: { requestId: "req-old", state: "da_fare" },
    });
    assert.equal(!other.ok && other.code, "referente_non_assegnato", label);
    // The request item read for another request does not count.
    const mismatch = run(s, { actorRequestItem: { requestId: "req-other", state: "da_fare" } });
    assert.equal(!mismatch.ok && mismatch.code, "richiesta_assente", label);
    // Without the request item nothing passes.
    const missing = run(s, { actorRequestItem: null });
    assert.equal(!missing.ok && missing.code, "richiesta_assente", label);
    // A referent who delegated the item, or whose item was reassigned, does not answer late.
    for (const state of ["delegata", "riassegnata"] as const) {
      const gone = run(s, { actorRequestItem: { requestId: "req-1", state } });
      assert.equal(!gone.ok && gone.code, "richiesta_assente", `${label} ${state}`);
    }
  }
  // Row 11: a late answer after «Non lo so» still passes, but only on the referent's own request.
  const late = SCENARIOS.find((s) => s.row === "11" && s.actor === "referente")!;
  assert.ok(run(late).ok);
  assert.ok(run(late, { actorRequestItem: { requestId: "req-1", state: "inviata" } }).ok);
  // Rows other than 11 need an active request item: «Non lo so» is not enough.
  const r5 = SCENARIOS.find((s) => s.row === "5" && s.actor === "referente")!;
  assert.equal(((x) => !x.ok && x.code)(run(r5, { actorRequestItem: { requestId: "req-1", state: "non_so" } })), "richiesta_assente");
});

test("every new answer clears the old confirmation by the data owner; a confirmation from the link records the contact", () => {
  const confirmed = { confirmedByContactId: "contact-9", confirmedByRoleKey: "resp_commerciale" };
  const answerTriggers = new Set(["risposta", "risposta_parziale", "inserimento_ls", "non_so", "nuova_versione"]);
  for (const s of SCENARIOS.filter((x) => answerTriggers.has(x.trigger))) {
    const r = run(s, { item: snap({ status: s.from, ...s.item, ...confirmed }) });
    assert.ok(r.ok, `row ${s.row} via ${s.trigger}`);
    assert.equal(r.ok && r.value.patch.confirmedByContactId, null, `row ${s.row} via ${s.trigger}`);
  }
  const r5 = SCENARIOS.find((s) => s.row === "5" && s.actor === "referente")!;
  const conferma = run(r5, { answer: { kind: "conferma", sourceKind: "referente" } });
  assert.equal(conferma.ok && conferma.value.patch.confirmedByContactId, "contact-1");
  // Validation and status-only changes leave the confirmation alone.
  const r18 = run(SCENARIOS.find((s) => s.row === "18")!, { item: snap({ status: "in_verifica", ...VALIDATABLE, ...confirmed }) });
  assert.ok(r18.ok && !("confirmedByContactId" in r18.value.patch));
});

test("reopening a not-applicable item with an active or permanent blocker keeps the lock", () => {
  const locked = SCENARIOS.find((s) => s.row === "26b")!;
  const r = run(locked);
  assert.ok(r.ok);
  assert.equal(r.ok && r.value.patch.status, "bloccata");
  assert.equal(r.ok && r.value.patch.statusReason, "Bloccata: a8, sanitario");
  assert.equal(r.ok && r.value.patch.naApprovedAt, null);
  assert.deepEqual(r.ok && r.value.sideEffects, ["firme_na_azzerate"]);
  // The health lock never opens: back to da_chiedere is refused while a blocker is there.
  const open = run({ ...locked, to: "da_chiedere" });
  assert.equal(!open.ok && open.code, "blocco_attivo");
  // Without blockers the item goes back to da_chiedere, never to bloccata.
  const free = run({ ...locked, item: { ...locked.item, privacyClass: "riservato_azienda", activeBlockerKeys: [] } });
  assert.equal(!free.ok && free.code, "blocco_assente");
});

test("a partial answer is validated only with the missing part signed by both sides", () => {
  const p = SCENARIOS.find((x) => x.row === "16")!;
  const dateOnly = run(p, { item: snap({ status: "parziale", ...VALIDATABLE, partialNa: { ...PARTIAL_NA, approvazioni: [] } }) });
  assert.equal(!dateOnly.ok && dateOnly.code, "parte_mancante_non_approvata");
  const lsOnly = run(p, { item: snap({ status: "parziale", ...VALIDATABLE, partialNa: { ...PARTIAL_NA, approvazioni: [PARTIAL_NA.approvazioni[0]] } }) });
  assert.equal(!lsOnly.ok && lsOnly.code, "parte_mancante_non_approvata");
  assert.ok(run(p).ok);
});

test("blocking a missing item takes it out of the link; only the lead sends the rest of a partial answer", () => {
  const r13 = SCENARIOS.find((x) => x.row === "13")!;
  assert.equal(((x) => x.ok && x.value.requestItemState)(run(r13)), "riassegnata");
  assert.equal(((x) => x.ok && x.value.requestItemState)(run(r13, { item: snap({ status: "mancante", hasActiveRequestItem: false }) })), null);
  const r15 = SCENARIOS.find((x) => x.row === "15")!;
  assert.equal(((x) => !x.ok && x.code)(run(r15, { actor: ACTORS.ls_analista })), "attore_non_ammesso");
});

test("only da_chiedere, in_verifica, mancante (with a reason) and bloccata can be imported", () => {
  const seed: Actor = { type: "sistema", job: "seed" };
  for (const status of ["chiesta", "parziale", "validata", "non_applicabile"] as const) {
    const r = checkImportedState({ actor: seed, status, blockerKeys: [], statusReason: "Motivo qualsiasi" });
    assert.equal(!r.ok && r.code, "stato_non_importabile", status);
  }
  for (const status of ["da_chiedere", "in_verifica"] as const) assert.ok(checkImportedState({ actor: seed, status, blockerKeys: [] }).ok, status);
});

test("an NA signature from the link of a contact who is no longer the designated Owner does not count", () => {
  const s = SCENARIOS.find((x) => x.row === "22")!;
  assert.ok(run(s, { designatedOwnerContactId: "contact-owner" }).ok);
  const changed = run(s, { designatedOwnerContactId: "contact-new-owner" });
  assert.equal(!changed.ok && changed.code, "firme_mancanti");
  const none = run(s, { designatedOwnerContactId: null });
  assert.equal(!none.ok && none.code, "firme_mancanti");
});

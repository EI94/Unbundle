import test from "node:test";
import assert from "node:assert/strict";
import { computeGate, type GateItem } from "../gates.ts";
import type { CaseRole } from "../vocab.ts";
import { findForbiddenIn } from "./copy-guard.ts";
import {
  BLOCKER_SHORT_LABEL,
  CASE_STATUS_HELP,
  CATALOG_VERSION_REASON_LABEL,
  GATE_DECISION_LABEL,
  REJECTED_BY_LABEL,
  SIGNATURE_ROLE_LABEL,
  BLOCKERS_VISIBLE,
  OVERVIEW_SIDE_SECTIONS,
  TOPICS_VISIBLE,
  VIA_EVIDENCE_HINT,
  VIA_EVIDENCE_MISSING,
  VIA_POLICY_TEXT,
  VIA_RECONFIRM_NOTE,
  VIA_RULE_TEXT,
  VIA_RULE_TO_CONFIRM,
  VIA_THEN_TEXT,
  VIA_WAITING_LABEL,
  blockerPanelParam,
  blockerResolver,
  blockerShortLabel,
  caseStepper,
  casePhaseGroups,
  catalogVersionRow,
  coverageText,
  exceptionsText,
  firstSentence,
  latestApproval,
  milestoneView,
  moduleProgress,
  nextMilestoneText,
  nextMilestones,
  noRequiredText,
  overviewBlockerTitle,
  overviewBlockers,
  overviewLayout,
  parseOverviewPanel,
  reviewHistoryRow,
  topTopics,
  topicOpenText,
  viaAction,
  viaConditions,
  viaEverApproved,
  viaFailureMessage,
  viaGroupLinks,
  viaHowText,
  viaOpenConditions,
  viaProgress,
  viaProposeWhen,
  viaShownSignatures,
  viaSignatures,
  viaSignaturesLine,
  viaState,
  viaStateView,
} from "./progress.ts";
import { GATE_STATES } from "./labels.ts";

const NOW = new Date("2026-10-14T10:00:00Z");
const OCT3 = "2026-10-03T09:00:00Z";

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

// ── Panoramica ────────────────────────────────────────────────────────

test("(rilascio 10, §3.5) overview layout: three blocks plus the topics, per role, in reading order", () => {
  const of = (...roles: CaseRole[]) => overviewLayout(roles);
  assert.deepEqual(of("ls_lead").sections, ["fare", "via", "tappe", "argomenti", "blocchi"]);
  assert.equal(of("ls_lead").audience, "ls");
  assert.deepEqual(of("ls_analista").sections, ["fare", "via", "tappe", "argomenti", "blocchi"]);
  assert.equal(of("ls_sviluppatore").kind, "sviluppatore");
  assert.deepEqual(of("ls_sviluppatore").sections, ["fare", "via", "tappe", "argomenti"], "the developer resolves no blocker");
  assert.deepEqual(of("owner_cliente").sections, ["fare", "via", "tappe", "argomenti"], "Lateral Space handles the blockers; no signature box (F-032)");
  assert.equal(of("owner_cliente").audience, "cliente");
  for (const r of ["osservatore", "ai_board"] as const) {
    assert.deepEqual(of(r).sections, ["via", "tappe"], r);
    assert.equal(of(r).audience, "cliente");
  }
  assert.equal(of("ls_lead", "osservatore").kind, "ls", "the role that sees the most wins");
  assert.equal(of("ls_sviluppatore", "ls_analista").kind, "ls");
  // «Il caso» goes to Soluzione (F-031), the approved note to the via line (F-033): none of them is a section any more.
  for (const r of ["ls_lead", "owner_cliente", "osservatore"] as const) assert.ok(!(of(r).sections as string[]).some((x) => ["caso", "firma"].includes(x)), r);
  // Prototype S4: «Da fare» and «Via allo sviluppo» on the left; the next milestone, the topics and the blockers on the right.
  assert.deepEqual([...OVERVIEW_SIDE_SECTIONS], ["tappe", "argomenti", "blocchi"]);
});

test("via progress: the big number, the yellow part and the open groups without zeros, in the viewer's words", () => {
  const items = [
    { moduleKey: "a", status: "validata" as const, ok: true },
    { moduleKey: "a", status: "validata" as const, ok: false }, // scaduta: resta da fare
    { moduleKey: "a", status: "da_chiedere" as const, ok: false },
    { moduleKey: "b", status: "in_verifica" as const, ok: false },
    { moduleKey: "b", status: "in_verifica" as const, ok: false },
    { moduleKey: "b", status: "bloccata" as const, ok: false },
    { moduleKey: "b", status: "bloccata" as const, ok: true }, // ripiego approvato
  ];
  const ls = viaProgress(items, "ls");
  assert.deepEqual([ls.required, ls.ok, ls.inReview], [7, 2, 2]);
  assert.deepEqual(
    ls.open.map((g) => [g.slug, g.text]),
    [
      ["da-fare", "2 da fare"],
      ["da-verificare", "2 da verificare"],
      ["bloccate", "1 bloccata"],
    ],
  );
  assert.deepEqual(
    viaProgress(items, "cliente").open.map((g) => g.text),
    ["2 da rispondere", "2 in verifica", "1 in attesa"],
  );
  assert.deepEqual(viaProgress([{ moduleKey: null, status: "validata", ok: true }], "ls").open, [], "a group at zero is not shown");
  // (Rilascio 10, §3.5, prototipo S4) The groups as links under the big number: label then count; the ones the filled button says are skipped.
  assert.deepEqual(
    viaGroupLinks(ls, "ls").map((g) => [g.slug, g.text]),
    [
      ["da-fare", "Da fare 2"],
      ["da-verificare", "Da verificare 2"],
      ["bloccate", "In attesa 1"],
    ],
  );
  assert.equal(VIA_WAITING_LABEL, "In attesa", "the stopped questions are «In attesa» for everyone, as the group of Domande");
  assert.deepEqual(viaGroupLinks(viaProgress(items, "cliente"), "cliente").map((g) => g.text), ["Da rispondere 2", "In verifica 2", "In attesa 1"]);
  assert.deepEqual(viaGroupLinks(ls, "ls", { skip: ["da_verificare"] }).map((g) => g.group), ["da_fare", "bloccate"], "«Verifica N risposte» is already the filled button");
});

test("per topic: who misses the most first, then the template order, other questions last", () => {
  const facts = [
    ...Array.from({ length: 3 }, () => ({ moduleKey: "m.a", ok: true })),
    { moduleKey: "m.a", ok: false },
    ...Array.from({ length: 4 }, () => ({ moduleKey: "m.b", ok: false })),
    { moduleKey: "m.c", ok: false },
    { moduleKey: null, ok: false },
    { moduleKey: "m.d", ok: true },
  ];
  const rows = moduleProgress(
    facts,
    [
      { key: "m.a", title: "Prezzi e sconti", roleKey: "comm" },
      { key: "m.b", title: "Canali di vendita", roleKey: "comm" },
      { key: "m.c", title: "Sistemi ed export", roleKey: null },
      { key: "m.d", title: "Già a posto", roleKey: null },
      { key: "m.e", title: "Senza indispensabili", roleKey: null },
    ],
    { roleLabels: { comm: "Commerciale" } },
  );
  assert.deepEqual(
    rows.map((r) => [r.key, r.title, r.roleLabel, r.ok, r.total, r.missing]),
    [
      ["m.b", "Canali di vendita", "Commerciale", 0, 4, 4],
      ["m.a", "Prezzi e sconti", "Commerciale", 3, 4, 1],
      ["m.c", "Sistemi ed export", null, 0, 1, 1],
      [null, "Altre domande", null, 0, 1, 1],
      ["m.d", "Già a posto", null, 1, 1, 0],
    ],
  );
  assert.equal(rows.some((r) => r.key === "m.e"), false, "a topic without indispensable questions is not listed");
});

test("blockers: active ones with questions plus the privacy sheet, never the health one, short labels and their line", () => {
  const rows = overviewBlockers([
    { id: "b1", key: "accesso_sistema", label: "Accesso in lettura al sistema delle richieste", status: "attivo", items: 4 },
    { id: "b2", key: "a8", label: "Scheda A.8 approvata per iscritto", status: "attivo", items: 0, a8WaitingFor: "cliente" },
    { id: "b3", key: "sanitario", label: "Dati sanitari", status: "attivo", items: 9 },
    { id: "b4", key: "decisione_board", label: "Decisione del comitato", status: "sciolto", items: 3 },
    { id: "b5", key: "fuori_foundation", label: "Fuori dal primo rilascio", status: "attivo", items: 0 },
    { id: "b6", key: "costi_extra", label: "Costi aggiuntivi da autorizzare (art. 8.4). Poi si riparte.", status: "attivo", items: 7 },
    { id: "b7", key: "sanitario", label: "Dati sanitari", status: "permanente", items: 2 },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.id, r.label, r.line]),
    [
      ["b2", "Scheda privacy", "Manca la firma del cliente."],
      ["b6", "Costi aggiuntivi da autorizzare", "Ferma 7 domande."],
      ["b1", "Accesso al sistema", "Lo sblocca Lateral Space quando è attivo."],
    ],
  );
  assert.equal(rows[0].fullLabel, "Scheda privacy approvata per iscritto", "the full label loses the code of the privacy sheet");
  assert.equal(rows[1].fullLabel, "Costi aggiuntivi da autorizzare. Poi si riparte.");
  assert.equal(overviewBlockers([{ id: "x", key: "a8", label: "A.8", status: "attivo", items: 2, a8WaitingFor: null }])[0].line, "Manca la firma di Lateral Space.");
  assert.equal(overviewBlockers([{ id: "x", key: "a8", label: "A.8", status: "attivo", items: 2, a8WaitingFor: "lateral_space" }])[0].line, "Manca la firma di Lateral Space.");
  assert.equal(overviewBlockers([{ id: "x", key: "zz", label: "Altro", status: "attivo", items: 1 }])[0].line, "Ferma 1 domanda.");
  assert.deepEqual(Object.keys(BLOCKER_SHORT_LABEL).sort(), ["a8", "accesso_sistema", "costi_art_8_4", "decisione_board", "fuori_foundation"]);
  assert.equal(blockerShortLabel("costi_art_8_4", "Costi (art. 8.4)"), "Costi da approvare");
  assert.equal(firstSentence("Prima frase. Seconda."), "Prima frase");
  assert.equal(firstSentence("Senza punto"), "Senza punto");
});

test("every blocker says who resolves it, in plain words; the health one never", () => {
  assert.match(blockerResolver("a8"), /due firme sulla scheda privacy/);
  assert.match(blockerResolver("sanitario"), /mai/);
  assert.match(blockerResolver("altro"), /responsabile Lateral Space/);
  assert.match(blockerResolver("costi_art_8_4"), /approvazione scritta dei costi\.$/);
});

test("panel from the address: a blocker by id or all milestones, anything else is ignored", () => {
  const id = "3F2A1B4C-0000-4000-8000-000000000001";
  assert.deepEqual(parseOverviewPanel(blockerPanelParam(id)), { kind: "blocco", blockerId: id.toLowerCase() });
  assert.deepEqual(parseOverviewPanel("tappe"), { kind: "tappe" });
  assert.deepEqual(parseOverviewPanel(["tappe", "x"]), { kind: "tappe" });
  assert.equal(parseOverviewPanel("blocco:'; drop"), null);
  assert.equal(parseOverviewPanel(undefined), null);
});

test("milestones: next ones not done, when and grey suffixes; the path for paused and closed realizations", () => {
  const ms = [
    { key: "a", title: "Specifiche", plannedDate: "2026-10-02", plannedLabel: null, isProposal: false, toConfirm: false, done: true },
    { key: "b", title: "Mappatura dei dati", plannedDate: "2026-10-23", plannedLabel: null, isProposal: true, toConfirm: false, done: false },
    { key: "c", title: "Prova sul passato", plannedDate: null, plannedLabel: "settimana 6 (proposta)", isProposal: true, toConfirm: true, done: false },
    { key: "d", title: "Rodaggio", plannedDate: null, plannedLabel: null, isProposal: false, toConfirm: false, done: false },
  ];
  assert.deepEqual(
    nextMilestones(ms).map((x) => x.key),
    ["b", "c"],
  );
  assert.deepEqual(milestoneView(ms[1], NOW), { key: "b", title: "Mappatura dei dati", when: "23 ott", suffix: "(proposta)", done: false });
  assert.deepEqual(milestoneView(ms[2], NOW).suffix, "da confermare", "the label already says «(proposta)»");
  assert.equal(milestoneView(ms[3], NOW).when, null);
  // The path of «Tutte le tappe»: the phase of now, the one before a pause, none once closed.
  const current = (status: Parameters<typeof casePhaseGroups>[0], before: Parameters<typeof casePhaseGroups>[1] = null) => casePhaseGroups(status, before).find((g) => g.current)?.phase ?? null;
  assert.equal(current("raccolta"), "preparazione");
  assert.equal(casePhaseGroups("pronto_sviluppo", null)[0].done, true, "Preparazione ✓");
  assert.equal(current("sospeso", "collaudo"), "prova");
  assert.equal(current("chiuso"), null);
});

test("(rilascio 10, §3.5) the next milestone in one line, the top 3 topics with open questions, the blocker rows", () => {
  assert.equal(nextMilestoneText({ title: "Via allo sviluppo", when: "12 dic", suffix: null }), "Via allo sviluppo · 12 dic");
  assert.equal(nextMilestoneText({ title: "Prova sul passato", when: "settimana 6", suffix: "da confermare" }), "Prova sul passato · settimana 6 da confermare");
  assert.equal(nextMilestoneText({ title: "Rodaggio", when: null, suffix: null }), "Rodaggio");
  const rows = moduleProgress(
    [
      ...Array.from({ length: 12 }, () => ({ moduleKey: "volumi", ok: false })),
      ...Array.from({ length: 9 }, () => ({ moduleKey: "sistemi", ok: false })),
      ...Array.from({ length: 6 }, () => ({ moduleKey: "eccezioni", ok: false })),
      ...Array.from({ length: 2 }, () => ({ moduleKey: "persone", ok: false })),
      { moduleKey: "fatto", ok: true },
    ],
    [
      { key: "volumi", title: "Volumi e tempi", roleKey: null },
      { key: "sistemi", title: "Sistemi", roleKey: null },
      { key: "eccezioni", title: "Eccezioni", roleKey: null },
      { key: "persone", title: "Persone", roleKey: null },
      { key: "fatto", title: "Già a posto", roleKey: null },
    ],
  );
  assert.equal(TOPICS_VISIBLE, 3);
  assert.deepEqual(topTopics(rows).map((r) => [r.title, topicOpenText(r.missing)]), [
    ["Volumi e tempi", "12 aperte"],
    ["Sistemi", "9 aperte"],
    ["Eccezioni", "6 aperte"],
  ]);
  assert.equal(topicOpenText(1), "1 aperta");
  assert.deepEqual(topTopics(rows.filter((r) => r.key === "fatto")), [], "a topic with nothing open is not shown (the zero)");
  assert.equal(BLOCKERS_VISIBLE, 3, "three rows, then «Vedi tutti (n)»");
  assert.equal(overviewBlockerTitle("Accesso al sistema"), "Blocco: Accesso al sistema");
  // Un caso chiuso dopo il via ha ancora il suo catalogo validato.
  assert.equal(viaEverApproved({ status: "chiuso", statusBeforeSuspension: null, catalogVersion: 1 }), true);
  assert.equal(viaEverApproved({ status: "chiuso", statusBeforeSuspension: null, catalogVersion: 0 }), false);
  assert.equal(viaEverApproved({ status: "sospeso", statusBeforeSuspension: "in_sviluppo", catalogVersion: 0 }), true);
  assert.equal(viaEverApproved({ status: "raccolta", statusBeforeSuspension: null, catalogVersion: 0 }), false);
});

test("no indispensable questions: a hint for Lateral Space only, nothing for the client (the zero does not show)", () => {
  assert.equal(noRequiredText("ls"), "Nessuna domanda indispensabile: controlla la regola del via in Diagnostica.");
  assert.equal(noRequiredText("cliente"), null);
  const g1 = computeGate({ gate: "G1", items: [gi("1", { priority: "should" })], datasets: [], blockers: [], now: NOW, available: ["G1"], caseCode: "ES-001", policyScope: "request_modules" });
  assert.equal(g1.required, 0);
  const detail = (audience: "ls" | "cliente") => viaConditions(g1.conditions, { required: 0, ok: 0, waivers: g1.waivers, audience }).open.find((c) => c.key === "voci_a_posto")?.detail;
  assert.equal(detail("ls"), "nessuna domanda indispensabile: controlla la regola in Diagnostica");
  assert.equal(detail("cliente"), null);
});

// ── Via allo sviluppo ─────────────────────────────────────────────────

test("via state: not yet, can be proposed, waiting for signatures, approved on a day, to confirm again", () => {
  const base = { status: "raccolta" as const, statusBeforeSuspension: null, gateReconfirm: false, ready: false, pending: false, approved: false };
  assert.equal(viaState(base), "non_ancora");
  assert.equal(viaState({ ...base, ready: true }), "si_puo_proporre");
  assert.equal(viaState({ ...base, ready: true, pending: true }), "in_attesa_firme");
  assert.equal(viaState({ ...base, status: "in_sviluppo", approved: true }), "approvato");
  assert.equal(viaState({ ...base, status: "sospeso", statusBeforeSuspension: "pronto_sviluppo", approved: true }), "approvato");
  assert.equal(viaState({ ...base, status: "in_sviluppo", gateReconfirm: true, approved: true }), "da_riconfermare");
  // Si propone solo in preparazione: in bozza, in pausa o a caso chiuso no, anche se le domande sono a posto.
  assert.equal(viaState({ ...base, status: "bozza", ready: true }), "non_ancora");
  assert.equal(viaState({ ...base, status: "sospeso", statusBeforeSuspension: "raccolta", ready: true }), "non_ancora");
  assert.equal(viaState({ ...base, status: "sospeso", statusBeforeSuspension: "raccolta", ready: true, pending: true }), "in_attesa_firme");
  // A caso chiuso conta la storia del via.
  assert.equal(viaState({ ...base, status: "chiuso", ready: true }), "non_ancora");
  assert.equal(viaState({ ...base, status: "chiuso", ready: true, approved: true }), "approvato");
  assert.equal(viaState({ ...base, status: "chiuso", gateReconfirm: true, approved: true }), "approvato");
  assert.deepEqual(viaStateView("approvato", OCT3, NOW), { label: "Approvato il 3 ott", tone: "verde" });
  assert.deepEqual(viaStateView("non_ancora", null, NOW), { label: "Non ancora", tone: "grigio" });
});

test("via conditions in plain words, from the real computation; the always-true one is gone; (rilascio 10) only the open ones show", () => {
  const items = [
    gi("1"),
    gi("2", { status: "da_chiedere" }),
    gi("3", { openClarification: true }),
    gi("4", { kind: "fonte", key: "src.crm.x" }),
    gi("5", { kind: "regola", key: "rule.x.1", responderRoleKey: "altro", confirmedByRoleKey: null }),
  ];
  const g1 = computeGate({ gate: "G1", items, datasets: [], blockers: [], now: NOW, available: ["G1"], caseCode: "ES-001", policyScope: "request_modules" });
  const { open, done } = viaConditions(g1.conditions, { required: g1.required, ok: g1.ok, waivers: g1.waivers, audience: "ls" });
  assert.deepEqual(
    open.map((c) => [c.key, c.label, c.detail, c.segment]),
    [
      ["voci_a_posto", "Tutte le domande indispensabili a posto", "mancano 1", "domande"],
      ["chiarimenti", "Chiarimenti aperti chiusi", "1", "domande"],
      ["fonti_con_dataset", "Fonti e dataset approvati", "1", "domande/documenti"],
      ["regole_confermate", "Regole confermate da chi le possiede", "1", "soluzione/regole"],
    ],
  );
  assert.deepEqual(
    done.map((c) => c.key),
    ["deroghe_entro_limite"],
  );
  assert.equal([...open, ...done].some((c) => c.key === "disponibile"), false);
  // (Rilascio 10, §3.5) The questions are the big number: the open conditions list the others; the done ones are not shown (§1 rule 5).
  assert.deepEqual(viaOpenConditions(open).map((c) => c.key), ["chiarimenti", "fonti_con_dataset", "regole_confermate"]);
});

test("via signatures: the two sides, signed on a day (from the link) or still to sign, never a name", () => {
  assert.deepEqual(viaSignatures([], NOW), [
    { side: "ls", label: "Lateral Space", text: "Da firmare", signed: false },
    { side: "cliente", label: "Cliente", text: "Da firmare", signed: false },
  ]);
  const lines = viaSignatures(
    [
      { ruolo: "ls_lead", at: OCT3, metodo: "account" },
      { ruolo: "owner_cliente", at: "2026-10-08T09:00:00Z", metodo: "link" },
    ],
    NOW,
  );
  assert.deepEqual(
    lines.map((l) => l.text),
    ["Firmato il 3 ott", "Firmato l'8 ott dal link"],
  );
});

test("signatures shown: the open proposal's, else the latest approval's (also to confirm again or closed), else none", () => {
  const sig = (ruolo: string, at: string) => ({ ruolo, at, metodo: "account" });
  const approvedOld = { decision: "approvato", decidedAt: "2026-09-01T09:00:00Z", signatures: [sig("ls_lead", "2026-09-01T08:00:00Z")] };
  const approvedNew = { decision: "approvato", decidedAt: OCT3, signatures: [sig("ls_lead", OCT3), sig("owner_cliente", OCT3)] };
  const rejected = { decision: "respinto", decidedAt: "2026-10-10T09:00:00Z", signatures: [sig("ls_lead", "2026-10-09T09:00:00Z")] };
  const pending = { signatures: [sig("ls_lead", "2026-10-12T09:00:00Z")] };
  assert.equal(viaShownSignatures(pending, [rejected, approvedNew]), pending.signatures);
  assert.equal(viaShownSignatures(null, [rejected, approvedOld, approvedNew]), approvedNew.signatures);
  assert.deepEqual(
    viaSignatures(viaShownSignatures(null, [rejected, approvedNew]), NOW).map((l) => l.text),
    ["Firmato il 3 ott", "Firmato il 3 ott"],
    "a via to confirm again keeps the two signatures it had",
  );
  assert.deepEqual(viaShownSignatures(null, [rejected]), []);
});

test("the page action follows every row of the state table of DESIGN §3.5", () => {
  const base = {
    roles: ["ls_lead"] as CaseRole[],
    signable: true,
    status: "raccolta" as const,
    statusBeforeSuspension: null,
    ready: false,
    required: 245,
    ok: 0,
    pending: null,
    evidenceMissing: false,
    reconfirm: false,
    canSendLink: false,
    approved: null,
    now: NOW,
  };
  // (Rilascio 10, §3.5, F-036) Non pronto: niente pulsante spento, la riga «Si propone quando …».
  assert.deepEqual(viaAction(base), { kind: "proponi", disabled: true, note: "Si propone quando sono tutte a posto." });
  assert.deepEqual(viaAction({ ...base, ok: 245 }), { kind: "proponi", disabled: true, note: "Si propone quando le condizioni qui sotto sono a posto." });
  // In bozza il via si propone solo dopo la prima richiesta: la riga lo dice.
  assert.deepEqual(viaAction({ ...base, status: "bozza" }), { kind: "proponi", disabled: true, note: "Si propone quando sono tutte a posto." });
  assert.deepEqual(viaAction({ ...base, status: "bozza", ready: true, ok: 245 }), { kind: "proponi", disabled: true, note: "Si propone dopo la prima richiesta a un referente." });
  assert.deepEqual(viaAction({ ...base, status: "bozza", roles: ["ls_analista"] }), { kind: "nessuna", note: null });
  // Pronto, nessuna proposta.
  assert.deepEqual(viaAction({ ...base, ready: true, ok: 245 }), { kind: "proponi", disabled: false, note: null });
  // Proposto, il responsabile Lateral Space non ha firmato.
  assert.deepEqual(viaAction({ ...base, ready: true, pending: { signatures: [] } }), { kind: "firma_ls", note: null });
  // Lateral Space ha firmato, il cliente no.
  const lsSigned = { signatures: [{ ruolo: "ls_lead", at: OCT3 }] };
  assert.deepEqual(viaAction({ ...base, ready: true, pending: lsSigned, canSendLink: true }), {
    kind: "manda_link",
    canSend: true,
    attachEvidence: false,
    note: "Hai firmato il 3 ott. Manca il responsabile del cliente.",
  });
  // Caso a contratto senza la prova scritta: mentre si aspetta il cliente, la prova si allega già (la firma dal link non la porta).
  assert.equal((viaAction({ ...base, ready: true, pending: lsSigned, canSendLink: true, evidenceMissing: true }) as { attachEvidence: boolean }).attachEvidence, true);
  assert.equal((viaAction({ ...base, ready: true, pending: lsSigned }) as { canSend: boolean }).canSend, false, "without email the line stays, the button goes");
  // Il responsabile del cliente deve firmare.
  assert.deepEqual(viaAction({ ...base, roles: ["owner_cliente"], ready: true, pending: lsSigned }), { kind: "firma_cliente", note: null });
  // Le due firme ci sono ma manca la prova scritta: chi ha firmato la allega, il via si chiude.
  const bothSigned = { signatures: [{ ruolo: "ls_lead", at: OCT3 }, { ruolo: "owner_cliente", at: OCT3 }] };
  const attach = { kind: "allega_prova", note: "Hanno firmato tutti e due: allega la prova scritta per chiudere il via." };
  assert.deepEqual(viaAction({ ...base, ready: true, pending: bothSigned, evidenceMissing: true }), attach);
  assert.deepEqual(viaAction({ ...base, roles: ["owner_cliente"], ready: true, pending: bothSigned, evidenceMissing: true }), attach);
  assert.deepEqual(viaAction({ ...base, roles: ["ls_analista"], ready: true, pending: bothSigned, evidenceMissing: true }), { kind: "nessuna", note: null });
  assert.deepEqual(viaAction({ ...base, ready: true, pending: bothSigned, evidenceMissing: true, signable: false }), { kind: "nessuna", note: null });
  assert.deepEqual(viaAction({ ...base, roles: ["owner_cliente"], ready: true, pending: bothSigned, evidenceMissing: true, signable: false }), { kind: "nessuna", note: null });
  // Approvato.
  assert.deepEqual(viaAction({ ...base, status: "pronto_sviluppo", approved: { at: OCT3, catalogVersion: 1 } }), { kind: "nessuna", note: "Approvato il 3 ott · catalogo v1" });
  // Da riconfermare: la data e il catalogo, poi come si torna a posto.
  assert.deepEqual(viaAction({ ...base, status: "in_sviluppo", reconfirm: true, approved: { at: OCT3, catalogVersion: 1 } }), {
    kind: "nessuna",
    note: `Approvato il 3 ott · catalogo v1. ${VIA_RECONFIRM_NOTE}`,
  });
  // Chiuso dopo il via: la storia resta; chiuso prima del via: niente.
  assert.deepEqual(viaAction({ ...base, status: "chiuso", signable: false, approved: { at: OCT3, catalogVersion: 1 } }), { kind: "nessuna", note: "Approvato il 3 ott · catalogo v1" });
  assert.deepEqual(viaAction({ ...base, status: "chiuso", signable: false, ready: true }), { kind: "nessuna", note: null });
  // Nessuna azione per chi non firma, in pausa o in sola lettura.
  assert.deepEqual(viaAction({ ...base, roles: ["ls_analista"], ready: true }), { kind: "nessuna", note: null });
  assert.deepEqual(viaAction({ ...base, roles: ["owner_cliente"], ready: true }), { kind: "nessuna", note: null });
  assert.deepEqual(viaAction({ ...base, signable: false, ready: true }), { kind: "nessuna", note: null });
  assert.deepEqual(viaAction({ ...base, roles: ["owner_cliente"], pending: { signatures: [{ ruolo: "ls_lead", at: OCT3 }, { ruolo: "owner_cliente", at: OCT3 }] } }), { kind: "nessuna", note: null });
});

test("action failures speak of the via, never of gate, G1 or Owner; other messages stay", () => {
  const gateCodes = ["gate_non_pronto", "testo_cambiato", "gate_gia_deciso", "gate_non_disponibile", "regola_gate_da_confermare", "stato_caso_non_ammesso", "proposta_aperta", "firmatario_non_ammesso"];
  const commands = ["proponi", "firma", "rifiuta"] as const;
  const texts = commands.flatMap((cmd) => [...gateCodes, "attore_non_ammesso", "ruolo_non_ammesso"].map((code) => viaFailureMessage(cmd, { code, message: "Il gate G1 non è pronto (Owner del cliente)." })));
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
  assert.equal(texts.some((t) => /Owner|Responsabile del caso/.test(t)), false);
  assert.equal(viaFailureMessage("proponi", { code: "attore_non_ammesso", message: "x" }), "Solo il responsabile Lateral Space propone il via allo sviluppo.");
  assert.equal(viaFailureMessage("firma", { code: "attore_non_ammesso", message: "x" }), "Firmano solo il responsabile Lateral Space e il responsabile del cliente.");
  assert.equal(viaFailureMessage("rifiuta", { code: "dati_non_validi", message: "Scrivi il motivo." }), "Scrivi il motivo.");
  assert.equal(viaFailureMessage("firma", { code: "conflitto", message: "Aggiorna la pagina e riprova." }), "Aggiorna la pagina e riprova.");
});

test("history and catalog versions: titles without gate codes, signatures by role and day", () => {
  const reviews = [
    { id: "r2", decision: "approvato", proposedAt: OCT3, decidedAt: "2026-10-05T09:00:00Z", catalogVersion: 1, signatures: [{ ruolo: "ls_lead", at: OCT3, metodo: "account" }, { ruolo: "owner_cliente", at: "2026-10-05T09:00:00Z", metodo: "link" }] },
    { id: "r1", decision: "respinto", proposedAt: "2026-10-01T09:00:00Z", decidedAt: "2026-10-02T09:00:00Z", catalogVersion: null, signatures: [] },
  ];
  assert.deepEqual(reviewHistoryRow(reviews[0], NOW), {
    id: "r2",
    title: "Via allo sviluppo · Approvato · catalogo v1",
    detail: "Proposto il 3 ott, deciso il 5 ott · firme: Responsabile Lateral Space (3 ott), Responsabile del cliente (5 ott, dal link)",
  });
  // «Respinto» vale per chi ritira e per chi non approva: si dice chi ha chiuso, altrimenti una parola neutra.
  assert.equal(reviewHistoryRow(reviews[1], NOW).title, "Via allo sviluppo · Chiuso senza approvazione");
  assert.equal(reviewHistoryRow({ ...reviews[1], rejectedBy: "ls_lead" }, NOW).title, "Via allo sviluppo · Proposta ritirata da Lateral Space");
  assert.equal(reviewHistoryRow({ ...reviews[1], rejectedBy: "owner_cliente" }, NOW).title, "Via allo sviluppo · Non approvato dal cliente");
  assert.equal(reviewHistoryRow({ ...reviews[1], rejectedBy: "altro" }, NOW).title, "Via allo sviluppo · Chiuso senza approvazione");
  assert.deepEqual(latestApproval(reviews), { at: "2026-10-05T09:00:00Z", catalogVersion: 1 });
  assert.equal(latestApproval([reviews[1]]), null);
  assert.deepEqual(catalogVersionRow({ version: 1, reason: "gate", createdAt: "2026-10-05T09:00:00Z", changeNote: null, diff: { added: 12, changed: 1, removed: 0 } }, NOW), {
    title: "Catalogo v1 · Via allo sviluppo approvato",
    detail: "5 ott · 12 aggiunte, 1 cambiata, 0 tolte",
  });
  assert.equal(SIGNATURE_ROLE_LABEL.ls_lead, "Responsabile Lateral Space");
  assert.equal(SIGNATURE_ROLE_LABEL.owner_cliente, "Responsabile del cliente");
});

test("(rilascio 10) the path in «Tutte le tappe»: the 5 phases hold the 9 states of the path, pause and closure are states", () => {
  const groups = casePhaseGroups("collaudo", null);
  assert.deepEqual(
    groups.map((g) => [g.phase, g.steps.map((s) => s.status)]),
    [
      ["preparazione", ["bozza", "raccolta", "pronto_sviluppo"]],
      ["sviluppo", ["in_sviluppo"]],
      ["prova", ["backtest", "collaudo"]],
      ["rodaggio", ["stabilizzazione"]],
      ["in_uso", ["in_esercizio", "misura_roi"]],
    ],
  );
  assert.deepEqual(
    groups.map((g) => [g.current, g.done]),
    [
      [false, true],
      [false, true],
      [true, false],
      [false, false],
      [false, false],
    ],
  );
  assert.equal(casePhaseGroups("pronto_sviluppo", null)[0].done, true, "Preparazione ✓");
  assert.equal(casePhaseGroups("sospeso", "in_sviluppo")[1].current, true, "a paused case shows the phase it was in");
  assert.equal(casePhaseGroups("chiuso", null).some((g) => g.current), false);
});

test("stepper: 11 states, current marked, earlier ones done, suspension remembers the state", () => {
  const steps = caseStepper("raccolta", null);
  assert.equal(steps.length, 11);
  assert.deepEqual(
    steps.filter((s) => s.done).map((s) => s.status),
    ["bozza"],
  );
  assert.equal(steps.find((s) => s.current)?.status, "raccolta");
  const order = steps.map((s) => s.status);
  assert.ok(order.indexOf("stabilizzazione") < order.indexOf("in_esercizio"), "stabilization comes before operation");
  const suspended = caseStepper("sospeso", "in_sviluppo");
  assert.equal(suspended.find((s) => s.current)?.status, "sospeso");
  assert.equal(suspended.find((s) => s.before)?.status, "in_sviluppo");
  assert.deepEqual(
    suspended.filter((s) => s.done).map((s) => s.status),
    ["bozza", "raccolta", "pronto_sviluppo"],
  );
  assert.equal(caseStepper("chiuso", null).filter((s) => s.done).length, 0);
});

test("every text of the overview and of the via page passes the copy guard for the client", () => {
  const texts: string[] = [
    ...Object.values(CASE_STATUS_HELP).flatMap((h) => [h.meaning, h.next]),
    ...Object.values(VIA_RULE_TEXT),
    ...Object.values(VIA_POLICY_TEXT),
    ...(["request_modules", "letterale", "unione"] as const).map(viaHowText),
    VIA_THEN_TEXT,
    VIA_RULE_TO_CONFIRM,
    VIA_EVIDENCE_HINT,
    ...Object.values(GATE_DECISION_LABEL),
    ...Object.values(REJECTED_BY_LABEL),
    VIA_EVIDENCE_MISSING,
    VIA_RECONFIRM_NOTE,
    ...Object.values(SIGNATURE_ROLE_LABEL),
    ...Object.values(CATALOG_VERSION_REASON_LABEL),
    ...Object.values(BLOCKER_SHORT_LABEL),
    ...["a8", "decisione_board", "costi_art_8_4", "accesso_sistema", "fuori_foundation", "sanitario", "altro"].map(blockerResolver),
    ...overviewBlockers([
      { id: "1", key: "a8", label: "Scheda A.8", status: "attivo", items: 1, a8WaitingFor: "cliente" },
      { id: "2", key: "costi_art_8_4", label: "Costi (art. 8.4)", status: "attivo", items: 1 },
      { id: "3", key: "x", label: "Altro blocco (art. 7.2)", status: "attivo", items: 2 },
    ]).flatMap((b) => [b.label, b.line, b.fullLabel]),
    ...GATE_STATES.map((s) => viaStateView(s, OCT3, NOW).label),
    ...viaConditions(
      computeGate({ gate: "G1", items: [gi("1", { status: "da_chiedere", openClarification: true })], datasets: [], blockers: [], now: NOW, available: ["G1"], caseCode: "ES-001", policyScope: "request_modules" }).conditions,
      { required: 1, ok: 0, waivers: { used: 0, cap: 0 }, audience: "cliente" },
    ).open.flatMap((c) => [c.label, c.detail ?? ""]),
    // Il responsabile del cliente legge anche la riga per allegare la prova scritta.
    viaAction({
      roles: ["owner_cliente"],
      signable: true,
      status: "raccolta",
      statusBeforeSuspension: null,
      ready: true,
      required: 1,
      ok: 1,
      pending: { signatures: [{ ruolo: "ls_lead", at: OCT3 }, { ruolo: "owner_cliente", at: OCT3 }] },
      evidenceMissing: true,
      reconfirm: false,
      canSendLink: false,
      approved: null,
      now: NOW,
    }).note ?? "",
    ...(["bozza", "raccolta"] as const).flatMap((status) => [0, 1, 245].map((ok) => viaProposeWhen({ status, ready: false, required: ok === 1 ? 1 : 245, ok }) ?? "")),
    viaSignaturesLine(viaSignatures([{ ruolo: "ls_lead", at: OCT3, metodo: "account" }], NOW)),
    ...viaGroupLinks(viaProgress([{ moduleKey: "a", status: "bloccata", ok: false }, { moduleKey: "a", status: "chiesta", ok: false }], "cliente"), "cliente").map((g) => g.text),
    topicOpenText(12),
    overviewBlockerTitle("Accesso al sistema"),
    nextMilestoneText({ title: "Via allo sviluppo", when: "12 dic", suffix: "(proposta)" }),
    reviewHistoryRow({ id: "r", decision: "approvato_con_riserva", proposedAt: OCT3, decidedAt: OCT3, catalogVersion: 2, signatures: [{ ruolo: "owner_cliente", at: OCT3, metodo: "link" }] }, NOW).title,
    catalogVersionRow({ version: 2, reason: "correzione", createdAt: OCT3, changeNote: null, diff: { added: 0, changed: 0, removed: 0 } }, NOW).title,
    exceptionsText({ waivers: { used: 2, cap: 24 }, should: { total: 80, ok: 30 } }),
    coverageText({ literalRequired: 484, coveredByQuestions: 300, ok: 10 }),
  ];
  assert.deepEqual(findForbiddenIn(texts, "cliente"), []);
});

test("(rilascio 10, §3.5, F-036) the line instead of the dead «Proponi» button: when the via can be proposed", () => {
  const at = (status: "bozza" | "raccolta" | "pronto_sviluppo" | "in_sviluppo" | "sospeso", over: Partial<{ ready: boolean; required: number; ok: number }> = {}) =>
    viaProposeWhen({ status, ready: false, required: 245, ok: 186, ...over });
  assert.equal(at("raccolta"), "Si propone quando sono tutte a posto.", "prototype S4");
  assert.equal(at("raccolta", { required: 1, ok: 0 }), "Si propone quando è a posto.");
  assert.equal(at("raccolta", { ok: 245 }), "Si propone quando le condizioni qui sotto sono a posto.", "the questions are done, other conditions are not");
  assert.equal(at("bozza", { ok: 245, ready: true }), "Si propone dopo la prima richiesta a un referente.");
  assert.equal(at("raccolta", { ok: 245, ready: true }), null, "ready: the lead has «Proponi», the others read the state");
  for (const status of ["pronto_sviluppo", "in_sviluppo", "sospeso"] as const) assert.equal(at(status), null, status);
});

test("(rilascio 10, §3.5) the signatures in one row and «Come funziona» in the «?» of three lines at most", () => {
  assert.equal(viaSignaturesLine(viaSignatures([], NOW)), "Lateral Space: da firmare · Cliente: da firmare");
  assert.equal(
    viaSignaturesLine(viaSignatures([{ ruolo: "ls_lead", at: OCT3, metodo: "account" }, { ruolo: "owner_cliente", at: "2026-10-08T09:00:00Z", metodo: "link" }], NOW)),
    "Lateral Space: firmato il 3 ott · Cliente: firmato l'8 ott dal link",
  );
  for (const scope of ["request_modules", "letterale", "unione"] as const) {
    const how = viaHowText(scope);
    assert.ok(how.endsWith(VIA_THEN_TEXT), scope);
    assert.match(how, /Lateral Space e il cliente/, scope);
    assert.ok(how.split(/\s+/).length <= 50, `${scope}: ${how.split(/\s+/).length} words, three lines of the popover`);
    assert.doesNotMatch(how, /qui sotto/, "no list below any more");
  }
  assert.match(viaHowText("request_modules"), /«Non si applica», «Partire senza risposta», «Soluzione provvisoria»/, "the three exceptions keep their names");
});

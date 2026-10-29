import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbiddenIn } from "./copy-guard.ts";
import { FIGURE_SEPARATOR } from "./format.ts";
import {
  needAgents,
  needAlsoForText,
  needAskPieces,
  needDoneSummaryText,
  needForText,
  needStepsLaterText,
  needStepsUndatedText,
  needsSummaryPieces,
  quarterAskSummaryText,
  stepsHorizon,
  NEED_AREAS,
  NEED_ERRORS,
  NEED_REQUIREMENT_STATUSES,
  buildNeedsBoard,
  componentFormulaText,
  emptyNeedAskCounts,
  isBoardEmpty,
  isNeedDone,
  monthHeading,
  needAreaOf,
  needAskCountsOf,
  needDueText,
  needListsOfUseCase,
  needOwnerText,
  needRow,
  needStatusView,
  panelNeeds,
  returnsToConfirm,
  validateArchiveReason,
  validateNeedInput,
  validateNeedPatch,
  type NeedAskCounts,
  type NeedBoardItem,
  type NeedStepMonth,
  type NeedsBoardFilter,
  type NeedView,
} from "./needs.ts";
import { DEFAULT_VALUE_PARAMS, type ValueModel } from "./value-model.ts";

// «Cosa serve» (spec di Pierpaolo, 25/10/2026): vocabolari, validazione e i blocchi della sua vista,
// del pannello e della scheda, da un elenco già letto. Dati sintetici.

const PARAMS = { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11" as const };
const TODAY = "2026-10-25";

let seq = 0;
function need(over: Partial<NeedView> = {}): NeedView {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    type: "requisito",
    kind: "altro",
    title: `Esigenza ${seq}`,
    detail: null,
    ownerLabel: null,
    ownerSide: null,
    status: "da_chiedere",
    availability: null,
    dueOn: null,
    dueLabel: null,
    dueIsProposal: false,
    forLabel: null,
    sortOrder: 0,
    version: 1,
    importKey: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    doneAt: null,
    archivedAt: null,
    archiveReason: null,
    useCaseIds: [],
    ...over,
  };
}

const FIX_A: ValueModel = {
  v: 1,
  primary: "tempo",
  components: [
    { key: "capacita", lever: "nuove_capacita", label: "Risposte fuori orario", kind: "qualitativo", confidence: "fonte" },
    { key: "tempo", lever: "tempo", label: "Smistamento delle richieste", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" },
    { key: "qualita", lever: "qualita", label: "Meno errori", kind: "qualitativo", confidence: "da_misurare" },
    { key: "costi", lever: "costi", label: "Meno licenze", kind: "euro", eurYear: 535, confidence: "misurato" },
  ],
  confirmBy: "Responsabile del servizio clienti",
};

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const ITEMS: NeedBoardItem[] = [
  { id: B, code: "XV-0002", title: "Fatture", phase: "approvato", targetQuarter: "2027-Q1", valueModel: null },
  { id: A, code: "XV-0001", title: "Smistamento", phase: "approvato", targetQuarter: "2026-Q4", valueModel: FIX_A },
  { id: C, code: "XV-0003", title: "Preventivi", phase: "da_valutare", targetQuarter: null, valueModel: null },
];

test("vocabolari: aree dai tipi, stati per tipo, fatto e colori", () => {
  assert.deepEqual(
    NEED_AREAS.map((area) => area.label),
    ["Accessi", "Dati e documenti", "Regole e decisioni", "Persone e ruoli", "Contratto e governance", "Altro"],
  );
  assert.equal(needAreaOf("accesso"), "accessi");
  assert.equal(needAreaOf("documento"), "dati");
  assert.equal(needAreaOf("decisione"), "regole");
  assert.equal(needAreaOf("persona"), "persone");
  assert.equal(needAreaOf("contratto"), "contratto");
  assert.equal(needAreaOf("altro"), "altro");

  assert.equal(isNeedDone("requisito", "validata"), true);
  assert.equal(isNeedDone("requisito", "non_applicabile"), true);
  assert.equal(isNeedDone("requisito", "in_verifica"), false);
  assert.equal(isNeedDone("passo", "fatta"), true);
  assert.equal(isNeedDone("passo", "confermata"), false);
  assert.deepEqual(needStatusView("requisito", "mancante"), { label: "Manca il dato", tone: "rosso" });
  assert.deepEqual(needStatusView("requisito", "bloccata"), { label: "Bloccata", tone: "lucchetto" });
  assert.deepEqual(needStatusView("passo", "confermata"), { label: "Confermato", tone: "blu" });

  assert.equal(needOwnerText({ ownerLabel: "Giulia", ownerSide: "cliente" }), "Giulia · Cliente");
  assert.equal(needOwnerText({ ownerLabel: null, ownerSide: "lateral_space" }), "Lateral Space");
  assert.equal(needOwnerText({ ownerLabel: "Lateral Space", ownerSide: "lateral_space" }), "Lateral Space", "il nome che è la parte non si ripete");
  assert.equal(needOwnerText({ ownerLabel: null, ownerSide: null }), null);
  assert.equal(needDueText({ dueOn: "2026-11-15", dueLabel: null, dueIsProposal: false }, TODAY), "15 nov");
  assert.equal(needDueText({ dueOn: "2027-01-10", dueLabel: null, dueIsProposal: true }, TODAY), "10 gen 2027 (proposta)");
  assert.equal(needDueText({ dueOn: null, dueLabel: "a fine mese", dueIsProposal: false }, TODAY), "a fine mese");
  assert.equal(needDueText({ dueOn: null, dueLabel: null, dueIsProposal: true }, TODAY), null);
  assert.equal(monthHeading("2026-11"), "Novembre 2026");
  // A schermo, su un passo «Proposto», la data non dice «(proposta)»: lo dice già lo stato accanto.
  const proposedStep = need({ type: "passo", kind: "decisione", status: "proposta", dueOn: "2026-12-03", dueIsProposal: true });
  assert.equal(needRow(proposedStep, new Map(), TODAY).due, "3 dic");
  assert.equal(needRow(proposedStep, new Map(), TODAY).status.label, "Proposto");
  assert.equal(needDueText(proposedStep, TODAY), "3 dic (proposta)", "il MCP del team la tiene");
  assert.equal(needRow({ ...proposedStep, status: "confermata" }, new Map(), TODAY).due, "3 dic (proposta)", "un passo confermato con la data ancora da confermare");
  assert.equal(needRow(need({ dueOn: "2026-12-03", dueIsProposal: true }), new Map(), TODAY).due, "3 dic (proposta)", "un requisito");
});

test("validazione: stato predefinito per tipo, testi ripuliti, errori in italiano", () => {
  const ok = validateNeedInput({ type: "requisito", title: "  Accesso al gestionale  ", kind: "accesso", ownerLabel: " ", dueOn: "2026-11-15" });
  assert.ok(ok.ok);
  assert.equal(ok.value.title, "Accesso al gestionale");
  assert.equal(ok.value.status, "da_chiedere");
  assert.equal(ok.value.ownerLabel, null, "vuoto vale null");
  assert.equal(ok.value.dueOn, "2026-11-15");
  assert.equal(ok.value.dueIsProposal, false);
  const step = validateNeedInput({ type: "passo", title: "Riunione di avvio" });
  assert.ok(step.ok);
  assert.equal(step.value.status, "proposta");
  assert.equal(step.value.kind, "altro");

  const wrong = validateNeedInput({ type: "passo", title: "x", status: "validata" });
  assert.deepEqual(wrong, { ok: false, fieldErrors: { status: NEED_ERRORS.status } });
  const empty = validateNeedInput({ type: "requisito", title: "   " });
  assert.equal(!empty.ok && empty.fieldErrors.title, NEED_ERRORS.title);
  const many = validateNeedInput({ type: "requisito", title: "x".repeat(301), dueOn: "2026-02-30", kind: "nuvola", extra: 1 });
  assert.ok(!many.ok);
  assert.equal(many.fieldErrors.title, "Al massimo 300 caratteri.");
  assert.equal(many.fieldErrors.dueOn, NEED_ERRORS.dueOn);
  assert.equal(many.fieldErrors.kind, NEED_ERRORS.invalid);
  assert.equal(many.fieldErrors.extra, NEED_ERRORS.invalid, "chiavi fuori elenco rifiutate");

  // Una modifica: lo stato vale per il tipo di dopo; cambiando tipo, lo stato riparte.
  const current = { type: "requisito" as const, status: "in_verifica" as const };
  const patch = validateNeedPatch({ status: "validata", ownerLabel: null }, current);
  assert.deepEqual(patch, { ok: true, value: { status: "validata", ownerLabel: null } });
  assert.deepEqual(validateNeedPatch({ type: "passo" }, current), { ok: true, value: { type: "passo", status: "proposta" } });
  assert.deepEqual(validateNeedPatch({ status: "fatta" }, current), { ok: false, fieldErrors: { status: NEED_ERRORS.status } });
  assert.deepEqual(validateNeedPatch({}, current), { ok: true, value: {} });

  assert.deepEqual(validateArchiveReason("  Non serve più "), { ok: true, value: "Non serve più" });
  assert.deepEqual(validateArchiveReason(" "), { ok: false, fieldErrors: { archiveReason: NEED_ERRORS.archiveReason } });
});

test("il ritorno da confermare: le voci a ipotesi e da misurare, con la formula", () => {
  const [, hours] = FIX_A.components;
  assert.equal(componentFormulaText(hours, PARAMS), "6.600 all'anno × 1,5 min × 70% ≈ 116 h · 4.043 €");
  assert.equal(componentFormulaText({ ...hours, kind: "ore", unit: "richieste" } as typeof hours, PARAMS), "6.600 richieste all'anno × 1,5 min × 70% ≈ 116 h · 4.043 €");
  const lines = returnsToConfirm(FIX_A, PARAMS);
  assert.deepEqual(
    lines.map((line) => [line.label, line.text, line.confidence]),
    [
      ["Smistamento delle richieste", "6.600 all'anno × 1,5 min × 70% ≈ 116 h · 4.043 €", "Ipotesi"],
      ["Meno errori", "qualitativo", "Da misurare"],
    ],
    "le voci da una fonte o misurate non si chiedono",
  );
  assert.deepEqual(returnsToConfirm(null, PARAMS), []);
});

test("Cosa serve: requisiti per area, a posto da parte; passi per mese; questo trimestre per use case", () => {
  const needs = [
    need({ kind: "accesso", title: "Accesso al gestionale", useCaseIds: [A.toUpperCase(), B], dueOn: "2026-11-15", ownerLabel: "Giulia", ownerSide: "cliente", availability: "subito" }),
    need({ kind: "dato", title: "Estratto delle fatture", status: "validata", useCaseIds: [B] }),
    need({ kind: "documento", title: "Procedura di smistamento", status: "parziale", useCaseIds: [A], availability: "dopo_a8" }),
    need({ kind: "decisione", title: "Chi approva le risposte", useCaseIds: [A], availability: "subito" }),
    need({ kind: "persona", title: "Un referente", forLabel: "Tutto il programma" }),
    need({ kind: "contratto", title: "DPA firmato", status: "non_applicabile", useCaseIds: [A] }),
    need({ kind: "regola", title: "Archiviata", archivedAt: "2026-10-20T10:00:00.000Z", useCaseIds: [A] }),
    need({ type: "passo", status: "confermata", title: "Avvio con il team", dueOn: "2026-11-03", useCaseIds: [A] }),
    need({ type: "passo", status: "proposta", title: "Demo", dueOn: "2026-12-01" }),
    need({ type: "passo", status: "proposta", title: "Da fissare" }),
    need({ type: "passo", status: "fatta", title: "Kick-off", dueOn: "2026-10-10" }),
  ];
  const board = buildNeedsBoard(needs, ITEMS, { today: TODAY, params: PARAMS });
  assert.deepEqual(
    board.areas.map((area) => [area.label, area.open.map((r) => r.title), area.done.map((r) => r.title)]),
    [
      ["Accessi", ["Accesso al gestionale"], []],
      ["Dati e documenti", ["Procedura di smistamento"], ["Estratto delle fatture"]],
      ["Regole e decisioni", ["Chi approva le risposte"], []],
      ["Persone e ruoli", ["Un referente"], []],
      ["Contratto e governance", [], ["DPA firmato"]],
    ],
    "l'archiviata non c'è; le aree vuote nemmeno",
  );
  const access = board.areas[0].open[0];
  assert.deepEqual(access.useCases.map((ref) => ref.code), ["XV-0001", "XV-0002"], "per codice, anche con l'id in maiuscolo");
  assert.equal(access.owner, "Giulia · Cliente");
  assert.equal(access.due, "15 nov");
  assert.equal(board.areas[3].open[0].forLabel, "Tutto il programma");

  assert.deepEqual(
    board.steps.map((month) => [month.label, month.rows.map((r) => r.title)]),
    [
      ["Novembre 2026", ["Avvio con il team"]],
      ["Dicembre 2026", ["Demo"]],
      ["Senza data", ["Da fissare"]],
    ],
  );
  assert.deepEqual(board.stepsDone.map((r) => r.title), ["Kick-off"]);

  assert.deepEqual(board.quarter.map((card) => card.code), ["XV-0001"], "solo gli approvati di questo trimestre");
  const [card] = board.quarter;
  assert.equal(card.confirmBy, "Responsabile del servizio clienti");
  assert.equal(card.returns[0].text, "6.600 all'anno × 1,5 min × 70% ≈ 116 h · 4.043 €");
  assert.deepEqual(card.now.map((r) => r.title), ["Accesso al gestionale"]);
  assert.deepEqual(card.afterA8.map((r) => r.title), ["Procedura di smistamento"]);
  assert.deepEqual(card.toDecide.map((r) => r.title), ["Chi approva le risposte"]);
  assert.equal(isBoardEmpty(board), false);
  assert.equal(isBoardEmpty(buildNeedsBoard([], ITEMS.slice(0, 1), { today: TODAY, params: PARAMS })), true);
  // Approvato per questo trimestre e già partito: la sua scheda resta, con il ritorno da confermare.
  const started = buildNeedsBoard([], [{ ...ITEMS[1], phase: "in_realizzazione" }, { ...ITEMS[0], phase: "in_realizzazione" }], { today: TODAY, params: PARAMS });
  assert.deepEqual(
    started.quarter.map((card) => card.code),
    ["XV-0001"],
    "in realizzazione con il trimestre di oggi sì, con un altro trimestre no",
  );
  assert.ok(started.quarter[0].returns.length > 0);
});

test("pannello: al massimo tre aperte, prima le più vicine; la scheda: per tipo e le collegabili", () => {
  const needs = [
    need({ title: "Senza data", useCaseIds: [A] }),
    need({ title: "Fra un mese", dueOn: "2026-11-25", useCaseIds: [A] }),
    need({ title: "Domani", dueOn: "2026-10-26", useCaseIds: [A] }),
    need({ title: "Fatta", status: "validata", useCaseIds: [A] }),
    need({ type: "passo", title: "Passo", dueOn: "2026-11-01", useCaseIds: [A] }),
    need({ title: "Di un altro", useCaseIds: [B] }),
  ];
  const panel = panelNeeds(needs, ITEMS[1], TODAY);
  assert.deepEqual(panel?.rows.map((r) => r.title), ["Domani", "Passo", "Fra un mese"]);
  assert.equal(panel?.more, 1);
  assert.equal(panelNeeds(needs, ITEMS[2], TODAY), null, "nessuna esigenza: nessun blocco");

  const lists = needListsOfUseCase(needs, A);
  assert.deepEqual(lists.requirements.map((n) => n.title).sort(), ["Domani", "Fatta", "Fra un mese", "Senza data"]);
  assert.deepEqual(lists.steps.map((n) => n.title), ["Passo"]);
  assert.deepEqual(lists.linkable.map((n) => n.title), ["Di un altro"]);
});

test("le righe chiuse di default: «Già a posto · n», «Fatto · 1», «Fatti · n»", () => {
  assert.equal(needDoneSummaryText("requisito", 3), "Già a posto · 3");
  assert.equal(needDoneSummaryText("passo", 1), "Fatto · 1");
  assert.equal(needDoneSummaryText("passo", 2), "Fatti · 2");
});

test("Cosa serve con un filtro: le esigenze degli use case che lo passano, con tutti i loro use case in «Per»", () => {
  const needs = [
    need({ kind: "accesso", title: "Accesso al gestionale", useCaseIds: [A.toUpperCase(), B] }),
    need({ kind: "dato", title: "Estratto delle fatture", useCaseIds: [B] }),
    need({ kind: "documento", title: "Procedura", useCaseIds: [C] }),
    need({ type: "passo", title: "Avvio con il team", dueOn: "2026-11-03", useCaseIds: [A] }),
  ];
  const titles = (board: ReturnType<typeof buildNeedsBoard>) => [
    ...board.areas.flatMap((area) => [...area.open, ...area.done].map((row) => row.title)),
    ...board.steps.flatMap((month) => month.rows.map((row) => row.title)),
  ];
  const board = buildNeedsBoard(needs, ITEMS, { today: TODAY, params: PARAMS, only: { useCaseIds: new Set([A]), q: null } });
  assert.deepEqual(titles(board), ["Accesso al gestionale", "Avvio con il team"], "collegate ad A, anche con l'id in maiuscolo");
  assert.deepEqual(
    board.areas[0].open[0].useCases.map((ref) => ref.code),
    ["XV-0001", "XV-0002"],
    "«Per» nomina anche gli use case fuori dal filtro",
  );
  // L'id del filtro in maiuscolo nell'esigenza, in minuscolo nell'insieme.
  const upper = buildNeedsBoard([need({ title: "Maiuscolo", useCaseIds: [C.toUpperCase()] })], ITEMS, { today: TODAY, params: PARAMS, only: { useCaseIds: new Set([C]), q: null } });
  assert.deepEqual(titles(upper), ["Maiuscolo"]);
});

test("Cosa serve con un filtro: le esigenze senza use case, la ricerca solo nel titolo, mai in «Chi»", () => {
  const loose = need({ kind: "persona", title: "Un referente", forLabel: "Tutto il programma" });
  const access = need({ kind: "accesso", title: "Accesso al GESTIONALE" });
  const owner = need({ title: "Un'altra cosa", ownerLabel: "Giulia", ownerSide: "cliente", detail: "Serve il gestionale di Giulia" });
  const titlesWith = (only: NeedsBoardFilter | null) =>
    buildNeedsBoard([loose, access, owner], ITEMS, { today: TODAY, params: PARAMS, only }).areas.flatMap((area) => area.open.map((row) => row.title));

  assert.ok(titlesWith(null).includes("Un referente"), "senza filtro c'è");
  assert.ok(!titlesWith({ useCaseIds: new Set([A]), q: null }).includes("Un referente"), "con un filtro no");
  assert.deepEqual(titlesWith({ useCaseIds: new Set(), q: "gestionale" }), ["Accesso al GESTIONALE"], "maiuscole non contano; il dettaglio non si cerca");
  assert.deepEqual(titlesWith({ useCaseIds: new Set(), q: "gestionàle" }), ["Accesso al GESTIONALE"], "accenti nemmeno");
  for (const q of ["Giulia", "cliente", "Cliente", "di Giulia"]) {
    assert.deepEqual(titlesWith({ useCaseIds: new Set(), q }), [], `«${q}» non trova nulla (art. 15.4)`);
  }
});

test("Cosa serve con un filtro: le schede del trimestre solo degli use case che lo passano", () => {
  const items: NeedBoardItem[] = [...ITEMS, { id: "dddddddd-0000-4000-8000-000000000004", code: "XV-0004", title: "Ordini", phase: "approvato", targetQuarter: "2026-Q4", valueModel: null }];
  assert.deepEqual(buildNeedsBoard([], items, { today: TODAY, params: PARAMS }).quarter.map((card) => card.code), ["XV-0001", "XV-0004"]);
  const only = { useCaseIds: new Set(["dddddddd-0000-4000-8000-000000000004"]), q: null };
  assert.deepEqual(buildNeedsBoard([], items, { today: TODAY, params: PARAMS, only }).quarter.map((card) => card.code), ["XV-0004"]);
});

test("i testi di «Cosa serve»: le schede del trimestre, «Per N use case», «Serve anche a…»", () => {
  assert.equal(quarterAskSummaryText(1), "Cosa vi chiediamo questo trimestre · 1 use case");
  assert.equal(quarterAskSummaryText(17), "Cosa vi chiediamo questo trimestre · 17 use case");
  assert.equal(needForText(3), "Per 3 use case");
  assert.equal(needAlsoForText(1), "Serve anche a un altro use case");
  assert.equal(needAlsoForText(2), "Serve anche ad altri 2 use case");
  assert.equal(needAlsoForText(22), "Serve anche ad altri 22 use case");
  const texts = [quarterAskSummaryText(1), quarterAskSummaryText(17), needForText(3), needAlsoForText(1), needAlsoForText(2), needAlsoForText(22)];
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
});

test("una riga nomina solo gli use case che chi guarda conosce", () => {
  const board = buildNeedsBoard([need({ title: "Con uno sconosciuto", useCaseIds: [A, "eeeeeeee-0000-4000-8000-000000000005"] })], ITEMS, { today: TODAY, params: PARAMS });
  assert.equal(board.areas[0].open[0].useCases.length, 1);
});

test("conteggi dei requisiti: ognuno una volta, solo quelli degli use case scelti, per gruppo di stato", () => {
  const set = new Set([A, B, C]);
  // Una sola esigenza per tre use case: conta una volta.
  assert.deepEqual(needAskCountsOf([need({ useCaseIds: [A, B, C] })], set), { ...emptyNeedAskCounts(), open: 1, toAsk: 1 });
  // Solo fuori: no; dentro e fuori: sì.
  const outside = "eeeeeeee-0000-4000-8000-000000000005";
  assert.deepEqual(needAskCountsOf([need({ useCaseIds: [outside] }), need({ useCaseIds: [] })], set), emptyNeedAskCounts());
  assert.equal(needAskCountsOf([need({ useCaseIds: [outside, B] })], set).toAsk, 1);
  // Solo requisiti non archiviati; ogni parte conta (la parte non è un criterio).
  const kinds = [
    need({ type: "passo", status: "proposta", useCaseIds: [A] }),
    need({ status: "bloccata", archivedAt: "2026-10-20T10:00:00.000Z", useCaseIds: [A] }),
    ...(["cliente", "lateral_space", "fornitore", "insieme", null] as const).map((ownerSide) => need({ ownerSide, useCaseIds: [A] })),
  ];
  assert.deepEqual(needAskCountsOf(kinds, set), { ...emptyNeedAskCounts(), open: 5, toAsk: 5 });
  // Gli stati nei gruppi di «Raccolta informazioni»; «aperti» tutti tranne quelli a posto.
  const statuses = NEED_REQUIREMENT_STATUSES.map((status) => need({ status, useCaseIds: [A] }));
  assert.deepEqual(needAskCountsOf(statuses, set), { open: 6, toAsk: 3, waiting: 1, toVerify: 1, blocked: 1, done: 2 });
  for (const status of NEED_REQUIREMENT_STATUSES) {
    const counts = needAskCountsOf([need({ status, useCaseIds: [A] })], set);
    assert.equal(counts.done === 1, isNeedDone("requisito", status), `${status}: «a posto» come isNeedDone`);
    assert.equal(counts.open === 1, !isNeedDone("requisito", status), status);
  }
  const group = (status: (typeof NEED_REQUIREMENT_STATUSES)[number]) => {
    const counts = needAskCountsOf([need({ status, useCaseIds: [A] })], set);
    return (Object.keys(counts) as Array<keyof typeof counts>).filter((key) => key !== "open" && counts[key] === 1);
  };
  const expected: Record<string, string> = {
    da_chiedere: "toAsk",
    mancante: "toAsk",
    parziale: "toAsk",
    chiesta: "waiting",
    in_verifica: "toVerify",
    bloccata: "blocked",
    validata: "done",
    non_applicabile: "done",
  };
  assert.deepEqual(Object.keys(expected).sort(), [...NEED_REQUIREMENT_STATUSES].sort());
  for (const status of NEED_REQUIREMENT_STATUSES) assert.deepEqual(group(status), [expected[status]], status);
  // Gli id senza maiuscole: lo use case e l'esigenza ripetuta.
  const shared = need({ status: "bloccata", useCaseIds: [A.toUpperCase()] });
  assert.deepEqual(needAskCountsOf([shared, { ...shared, id: shared.id.toUpperCase() }], set), { ...emptyNeedAskCounts(), open: 1, blocked: 1 });
});

test("Cosa serve: i requisiti contati per gruppo di stato, di tutta la vista e di ogni area; mai i passi né le archiviate", () => {
  // Gli otto stati, a coppie in due aree: Accessi i primi quattro, Dati e documenti gli altri.
  const statuses = NEED_REQUIREMENT_STATUSES.map((status, index) =>
    need({ status, kind: index < 4 ? "accesso" : "dato", useCaseIds: [index % 2 ? B : A], title: `Requisito ${status}` }),
  );
  const extra = [
    need({ type: "passo", status: "proposta", useCaseIds: [A] }),
    need({ type: "passo", status: "fatta", useCaseIds: [A] }),
    need({ status: "bloccata", kind: "accesso", archivedAt: "2026-10-20T10:00:00.000Z", useCaseIds: [A] }),
  ];
  const board = buildNeedsBoard([...statuses, ...extra], ITEMS, { today: TODAY, params: PARAMS });
  assert.deepEqual(board.counts, { open: 6, toAsk: 3, waiting: 1, toVerify: 1, blocked: 1, done: 2 });
  assert.deepEqual(
    board.areas.map((area) => [area.key, area.counts]),
    [
      ["accessi", { open: 4, toAsk: 3, waiting: 1, toVerify: 0, blocked: 0, done: 0 }],
      ["dati", { open: 2, toAsk: 0, waiting: 0, toVerify: 1, blocked: 1, done: 2 }],
    ],
  );
  // I conteggi seguono il filtro: solo le esigenze degli use case che lo passano (qui A, gli stati pari).
  const onlyA = buildNeedsBoard([...statuses, ...extra], ITEMS, { today: TODAY, params: PARAMS, only: { useCaseIds: new Set([A]), q: null } });
  assert.deepEqual(onlyA.counts, { open: 3, toAsk: 2, waiting: 0, toVerify: 1, blocked: 0, done: 1 });
  assert.deepEqual(
    onlyA.areas.map((area) => area.counts.open + area.counts.done),
    [2, 2],
  );
  // Uguali a quelli di `needAskCountsOf`, che dà i numeri di «Prossimo passo» della Panoramica.
  assert.deepEqual(onlyA.counts, needAskCountsOf([...statuses, ...extra], new Set([A])));
  assert.deepEqual(buildNeedsBoard([], ITEMS, { today: TODAY, params: PARAMS }).counts, emptyNeedAskCounts());
});

test("i testi dei conteggi: «86 aperti · 60 da chiedere · …», senza gli zeri; i passi «Più avanti» e «Senza data»", () => {
  const counts = (o: Partial<NeedAskCounts>): NeedAskCounts => ({ ...emptyNeedAskCounts(), ...o });
  const line = (o: Partial<NeedAskCounts>) => needsSummaryPieces(counts(o)).join(FIGURE_SEPARATOR);
  assert.equal(line({ open: 86, toAsk: 60, waiting: 12, toVerify: 4, blocked: 10, done: 31 }), "86 aperti · 60 da chiedere · 12 in attesa · 4 da verificare · 10 bloccati · 31 a posto");
  assert.equal(line({ open: 1, toAsk: 1 }), "1 aperto · 1 da chiedere");
  assert.equal(line({ done: 3 }), "Nessuno aperto · 3 a posto");
  assert.equal(line({}), "Nessuno aperto");
  assert.deepEqual(needAskPieces(counts({ open: 1, blocked: 1 })), ["1 bloccato"]);
  assert.deepEqual(needAskPieces(counts({ open: 2, waiting: 2 })), ["2 in attesa"], "i gruppi a zero non ci sono");
  assert.deepEqual(needAskPieces(counts({ open: 1200, toAsk: 1200 })), ["1.200 da chiedere"]);
  assert.equal(needStepsLaterText(1), "Più avanti · 1 passo");
  assert.equal(needStepsLaterText(6), "Più avanti · 6 passi");
  assert.equal(needStepsUndatedText(1), "Senza data · 1 passo");
  assert.equal(needStepsUndatedText(4), "Senza data · 4 passi");
  const texts = [
    ...needsSummaryPieces(counts({ open: 86, toAsk: 60, waiting: 12, toVerify: 4, blocked: 10, done: 31 })),
    ...needsSummaryPieces(counts({ open: 1, blocked: 1 })),
    ...needsSummaryPieces(counts({})),
    needStepsLaterText(1),
    needStepsLaterText(6),
    needStepsUndatedText(4),
  ];
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
});

test("«Prossimi passi»: aperti i mesi fino al prossimo, gli scaduti compresi; poi «Più avanti» e «Senza data»", () => {
  const month = (key: string): NeedStepMonth => ({ key, label: key === "senza_data" ? "Senza data" : monthHeading(key), rows: [] });
  const keys = (months: readonly NeedStepMonth[]) => months.map((m) => m.key);
  const all = ["2026-09", "2026-10", "2026-11", "2026-12", "senza_data"].map(month);
  const horizon = stepsHorizon(all, "2026-10-25");
  assert.deepEqual(keys(horizon.soon), ["2026-09", "2026-10", "2026-11"], "settembre è scaduto: resta aperto");
  assert.deepEqual(keys(horizon.later), ["2026-12"]);
  assert.equal(horizon.undated?.key, "senza_data");
  // Niente fino al mese prossimo: resta aperto il primo mese che c'è.
  const far = stepsHorizon(["2027-02", "2027-03"].map(month), "2026-10-25");
  assert.deepEqual([keys(far.soon), keys(far.later), far.undated], [["2027-02"], ["2027-03"], null]);
  // Solo passi senza data: si leggono aperti.
  const undated = stepsHorizon([month("senza_data")], "2026-10-25");
  assert.deepEqual([keys(undated.soon), keys(undated.later), undated.undated], [["senza_data"], [], null]);
  assert.deepEqual(stepsHorizon([], "2026-10-25"), { soon: [], later: [], undated: null });
  // A dicembre il mese prossimo è gennaio dell'anno dopo.
  const december = stepsHorizon(["2026-12", "2027-01", "2027-02"].map(month), "2026-12-10");
  assert.deepEqual([keys(december.soon), keys(december.later)], [["2026-12", "2027-01"], ["2027-02"]]);
  // I mesi di `buildNeedsBoard` vanno così come sono.
  const board = buildNeedsBoard(
    [
      need({ type: "passo", title: "Fra due mesi", dueOn: "2026-12-15" }),
      need({ type: "passo", title: "Il mese prossimo", dueOn: "2026-11-03" }),
      need({ type: "passo", title: "Da fissare" }),
    ],
    ITEMS,
    { today: TODAY, params: PARAMS },
  );
  const fromBoard = stepsHorizon(board.steps, TODAY);
  assert.deepEqual([keys(fromBoard.soon), keys(fromBoard.later), fromBoard.undated?.rows.map((r) => r.title)], [["2026-11"], ["2026-12"], ["Da fissare"]]);
});

test("gli agenti di un'esigenza: dal titolo dei suoi use case, uno per agente; nessuno senza prefisso", () => {
  assert.deepEqual(
    needAgents([
      { title: "LIBRA L1 · Lettura delle fatture estere" },
      { title: "ORSA O1 · Solleciti ai clienti" },
      { title: "LIBRA L3 · Riconciliazione dei pagamenti" },
      { title: "Smistamento delle richieste" },
    ]),
    ["LIBRA", "ORSA"],
  );
  assert.deepEqual(needAgents([{ title: "TAIGETE T3 · Note spese" }, { title: "ALCIONE A1 · Budget" }]), ["ALCIONE", "TAIGETE"], "in ordine alfabetico");
  assert.deepEqual(needAgents([{ title: "Strategia per volo" }]), []);
  assert.deepEqual(needAgents([]), []);
});

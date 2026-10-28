import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbiddenIn } from "./copy-guard.ts";
import {
  needAlsoForText,
  needDoneSummaryText,
  needForText,
  quarterAskSummaryText,
  NEED_AREAS,
  NEED_ERRORS,
  buildNeedsBoard,
  componentFormulaText,
  isBoardEmpty,
  isNeedDone,
  monthHeading,
  needAreaOf,
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
  type NeedBoardItem,
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

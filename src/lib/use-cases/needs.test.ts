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
  needsSummaryPieces,
  NEED_AREAS,
  NEED_ERRORS,
  NEED_REQUIREMENT_STATUSES,
  NEED_STEP_STATUSES,
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
  askGroupOf,
  compareNeeds,
  compareStepsByDate,
  NEED_ROWS_SHOWN,
  NEED_GROUP_KEYS,
  NEED_TIMELINE_TEXT,
  clientGroupLabel,
  moreStepsText,
  needGroupLabel,
  needGroupOf,
  splitTimeline,
  type NeedTimelineSection,
  needRequestGroupView,
  needRow,
  needStatusChoices,
  needStatusView,
  needsActionFirst,
  panelNeeds,
  needsCountBar,
  needsCountPieces,
  needsCountSummaryOf,
  returnsToConfirm,
  validateArchiveReason,
  validateNeedInput,
  validateNeedPatch,
  type NeedAskCounts,
  type NeedUseCaseRef,
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
const ITEMS: NeedUseCaseRef[] = [
  { id: B, code: "XV-0002", title: "Fatture" },
  { id: A, code: "XV-0001", title: "Smistamento" },
  { id: C, code: "XV-0003", title: "Preventivi" },
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

test("le righe dei requisiti dicono il gruppo dei cinque e il dettaglio; i passi il loro stato; il modulo e il MCP gli otto stati", () => {
  const expected: Record<string, [string, string, string | null]> = {
    da_chiedere: ["Da chiedere", "grigio", null],
    mancante: ["Da chiedere", "grigio", "manca il dato"],
    parziale: ["Da chiedere", "grigio", "risposta parziale"],
    chiesta: ["In attesa", "blu", null],
    in_verifica: ["Da verificare", "giallo", null],
    bloccata: ["Ferma", "lucchetto", null],
    validata: ["A posto", "verde", null],
    non_applicabile: ["A posto", "verde", "non si applica"],
  };
  assert.deepEqual([...NEED_REQUIREMENT_STATUSES].sort(), Object.keys(expected).sort());
  for (const status of NEED_REQUIREMENT_STATUSES) {
    const row = needRow(need({ status }), new Map(), TODAY);
    assert.deepEqual([row.status.label, row.status.tone, row.statusNote], expected[status], status);
    assert.deepEqual(row.status, { label: needRequestGroupView(status).label, tone: needRequestGroupView(status).tone }, status);
  }
  // Un passo: il suo stato, senza dettaglio, com'era.
  for (const status of NEED_STEP_STATUSES) {
    const row = needRow(need({ type: "passo", status }), new Map(), TODAY);
    assert.deepEqual(row.status, needStatusView("passo", status), status);
    assert.equal(row.statusNote, null, status);
  }
  // Gli otto stati restano nel modulo di modifica e nella lettura del MCP del team, con «Bloccata».
  const choices = needStatusChoices("requisito");
  assert.deepEqual(choices.map((choice) => choice.value), [...NEED_REQUIREMENT_STATUSES], "gli otto stati");
  assert.deepEqual(choices.map((choice) => choice.label), NEED_REQUIREMENT_STATUSES.map((status) => needStatusView("requisito", status).label));
  assert.ok(choices.some((choice) => choice.label === "Bloccata") && !choices.some((choice) => choice.label === "Ferma"));
  assert.equal(needStatusView("requisito", "bloccata").label, "Bloccata");
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

test("Cosa serve: le righe dei gruppi con «Chi», «Entro» e «Per»; a posto da parte; i passi sulla linea del tempo", () => {
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
    board.groups.map((group) => [group.key, group.open.map((r) => r.title)]),
    [
      ["cliente", ["Accesso al gestionale"]],
      ["nessuno", ["Chi approva le risposte", "Procedura di smistamento", "Un referente"]],
    ],
    "l'archiviata non c'è; i gruppi vuoti nemmeno; le aree non dividono più; poi l'ordine del team e il titolo",
  );
  assert.deepEqual(board.done.map((r) => r.title), ["DPA firmato", "Estratto delle fatture"], "senza parte tutti e due: l'ordine del team, poi il titolo");
  const access = board.groups[0].open[0];
  assert.deepEqual(access.useCases.map((ref) => ref.code), ["XV-0001", "XV-0002"], "per codice, anche con l'id in maiuscolo");
  assert.equal(access.owner, "Giulia · Cliente");
  assert.equal(access.due, "15 nov");
  assert.equal(board.groups[1].open[2].forLabel, "Tutto il programma");
  assert.equal(board.groups[1].open[1].statusNote, "risposta parziale");

  assert.deepEqual(
    board.timeline.sections.map((section) => [section.label, section.items.map((r) => r.title)]),
    [
      ["Novembre 2026", ["Avvio con il team"]],
      ["Dicembre 2026", ["Demo"]],
      ["Senza data", ["Da fissare"]],
    ],
  );
  assert.deepEqual(board.timeline.done.map((r) => [r.title, r.dueOn]), [["Kick-off", "2026-10-10"]]);
  assert.equal(isBoardEmpty(board), false);
  assert.equal(isBoardEmpty(buildNeedsBoard([], ITEMS.slice(0, 1), { today: TODAY, params: PARAMS })), true);
  // Solo passi, solo requisiti a posto, solo passi fatti: la vista non è vuota.
  for (const only of [needs[9], needs[1], needs[10]]) assert.equal(isBoardEmpty(buildNeedsBoard([only], ITEMS, { today: TODAY })), false, only.title);
  // Senza le ipotesi di calcolo: la stessa vista (le schede del trimestre non ci sono più).
  assert.deepEqual(buildNeedsBoard(needs, ITEMS, { today: TODAY }), board);
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
  // L'ordine della scheda: prima i requisiti (l'ordine del team, poi la scadenza), poi i passi.
  assert.deepEqual(panel?.rows.map((r) => r.title), ["Domani", "Fra un mese", "Senza data"]);
  assert.equal(panel?.more, 1);
  // Una risposta da verificare va in testa, come nella scheda.
  const withAnswer = [...needs, need({ title: "Risposta arrivata", status: "in_verifica", sortOrder: 9, useCaseIds: [A] })];
  assert.deepEqual(panelNeeds(withAnswer, ITEMS[1], TODAY)?.rows.map((r) => r.title), ["Risposta arrivata", "Domani", "Fra un mese"]);
  // Solo passi senza data: i passi, nell'ordine del team.
  const onlySteps = [need({ type: "passo", status: "proposta", title: "Dopo", sortOrder: 2, useCaseIds: [A] }), need({ type: "passo", status: "confermata", title: "Prima", sortOrder: 1, useCaseIds: [A] })];
  assert.deepEqual(panelNeeds(onlySteps, ITEMS[1], TODAY)?.rows.map((r) => r.title), ["Prima", "Dopo"]);
  // (Rilascio 4) I passi dalla scadenza più vicina, anche contro l'ordine del team; quelli senza data in fondo.
  const datedSteps = [
    need({ type: "passo", status: "proposta", title: "Senza data, primo per il team", sortOrder: 0, useCaseIds: [A] }),
    need({ type: "passo", status: "confermata", title: "A dicembre", sortOrder: 1, dueOn: "2026-12-01", useCaseIds: [A] }),
    need({ type: "passo", status: "proposta", title: "A novembre", sortOrder: 2, dueOn: "2026-11-03", useCaseIds: [A] }),
  ];
  assert.deepEqual(panelNeeds(datedSteps, ITEMS[1], TODAY)?.rows.map((r) => r.title), ["A novembre", "A dicembre", "Senza data, primo per il team"]);
  assert.equal(panelNeeds(needs, ITEMS[2], TODAY), null, "nessuna esigenza: nessun blocco");
  // (Rilascio 6, B.1.5) Il conteggio al posto delle voci: aperte, gruppi dei requisiti, passi, la barra.
  assert.deepEqual(panel?.summary, { open: 4, counts: { open: 3, toAsk: 3, waiting: 0, toVerify: 0, blocked: 0, done: 1 }, steps: 1 });
  assert.deepEqual(needsCountPieces(panel!.summary), ["3 da chiedere", "1 passo"]);
  assert.deepEqual(needsCountBar(panel!.summary).map((part) => [part.group, part.count, part.tone]), [["toAsk", 3, "grigio"], ["steps", 1, "grigio"], ["done", 1, "verde"]]);
  const mixed = needsCountSummaryOf([...withAnswer, need({ title: "Ferma", status: "bloccata", useCaseIds: [A] }), need({ title: "Chiesta", status: "chiesta", useCaseIds: [A] })], A)!;
  assert.deepEqual(needsCountPieces(mixed), ["3 da chiedere", "1 in attesa", "1 da verificare", "1 fermo", "1 passo"]);
  assert.deepEqual(needsCountBar(mixed).map((part) => part.group), ["toVerify", "toAsk", "waiting", "blocked", "steps", "done"], "prima da verificare, a posto in fondo");
  assert.equal(needsCountSummaryOf(needs, B)?.open, 1);
  assert.equal(needsCountSummaryOf(needs, "00000000-0000-4000-8000-00000000ffff"), null);

  const lists = needListsOfUseCase(needs, A);
  assert.deepEqual(lists.requirements.map((n) => n.title).sort(), ["Domani", "Fatta", "Fra un mese", "Senza data"]);
  assert.deepEqual(lists.steps.map((n) => n.title), ["Passo"]);
  assert.deepEqual(lists.linkable.map((n) => n.title), ["Di un altro"]);
});

test("compareStepsByDate: dalla scadenza più vicina, quelle senza data in fondo, poi l'ordine del team; cinque righe in vista", () => {
  const a = need({ id: "a", title: "Alfa", sortOrder: 3, dueOn: "2026-11-20" });
  const b = need({ id: "b", title: "Beta", sortOrder: 1, dueOn: "2026-11-05" });
  const c = need({ id: "c", title: "Gamma", sortOrder: 0, dueOn: null });
  const d = need({ id: "d", title: "Delta", sortOrder: 2, dueOn: "2026-11-05" });
  const e = need({ id: "e", title: "Epsilon", sortOrder: 0, dueOn: "2026-10-01" });
  const f = need({ id: "f", title: "Zeta", sortOrder: 1, dueOn: null });
  assert.deepEqual([a, b, c, d, e, f].sort(compareStepsByDate).map((n) => n.id), ["e", "b", "d", "a", "c", "f"], "la data prima dell'ordine del team; a parità, l'ordine del team");
  // Senza date è l'ordine del team (`compareNeeds`).
  assert.deepEqual([f, c].sort(compareStepsByDate), [f, c].sort(compareNeeds));
  // A parità di data e di ordine, il titolo: lo stesso di `compareNeeds`.
  const same = [need({ id: "y", title: "Zucca", dueOn: "2026-11-05" }), need({ id: "x", title: "Albero", dueOn: "2026-11-05" })];
  assert.deepEqual(same.sort(compareStepsByDate).map((n) => n.title), ["Albero", "Zucca"]);
  assert.equal(NEED_ROWS_SHOWN, 5);
});

test("Cosa serve per chi deve muoversi: un gruppo per organizzazione, ogni requisito una volta, prima da verificare; a posto da parte", () => {
  const needs = [
    need({ title: "Del cliente", ownerSide: "cliente", ownerLabel: "Aldo Prova", sortOrder: 2, useCaseIds: [A, B] }),
    need({ title: "Insieme", ownerSide: "insieme", sortOrder: 1, useCaseIds: [A] }),
    need({ title: "Risposta da guardare", ownerSide: "cliente", status: "in_verifica", sortOrder: 9, useCaseIds: [A] }),
    need({ title: "Senza parte", ownerSide: null, useCaseIds: [B] }),
    need({ title: "Di Lateral Space", ownerSide: "lateral_space", status: "bloccata", useCaseIds: [A] }),
    need({ title: "Del fornitore", ownerSide: "fornitore", status: "chiesta" }),
    need({ title: "A posto del fornitore", ownerSide: "fornitore", status: "validata", useCaseIds: [A] }),
    need({ title: "A posto del cliente", ownerSide: "cliente", status: "non_applicabile", useCaseIds: [A] }),
    need({ title: "Archiviata", ownerSide: "cliente", archivedAt: "2026-10-20T10:00:00.000Z", useCaseIds: [A] }),
    need({ type: "passo", status: "proposta", title: "Un passo", ownerSide: "cliente", useCaseIds: [A] }),
  ];
  const board = buildNeedsBoard(needs, ITEMS, { today: TODAY, params: PARAMS });
  assert.deepEqual(
    board.groups.map((group) => [group.key, group.open.map((row) => row.title)]),
    [
      ["cliente", ["Risposta da guardare", "Insieme", "Del cliente"]],
      ["fornitore", ["Del fornitore"]],
      ["lateral_space", ["Di Lateral Space"]],
      ["nessuno", ["Senza parte"]],
    ],
    "«Insieme» con il cliente, prima da verificare (needsActionFirst), senza parte in fondo; i passi e l'archiviata no",
  );
  assert.deepEqual(board.done.map((row) => row.title), ["A posto del cliente", "A posto del fornitore"], "a posto da parte, nell'ordine dei gruppi");
  const ids = [...board.groups.flatMap((group) => group.open), ...board.done].map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, "ognuno una volta, anche se serve a più use case");
  // La riga è quella della scheda e del pannello: il gruppo dei cinque, «Chi» con la parte.
  const client = board.groups[0].open[2];
  assert.equal(client.owner, "Aldo Prova · Cliente");
  assert.deepEqual(client.useCases.map((ref) => ref.code), ["XV-0001", "XV-0002"]);
  assert.equal(board.groups[0].open[1].owner, "Insieme", "«Insieme» lo dice nel suo «Chi»");
  assert.equal(board.groups[2].open[0].status.label, "Ferma");
  // I gruppi vuoti non ci sono; i conteggi restano quelli di tutti i requisiti.
  const onlyClient = buildNeedsBoard([needs[0], needs[7]], ITEMS, { today: TODAY, params: PARAMS });
  assert.deepEqual(onlyClient.groups.map((group) => group.key), ["cliente"]);
  assert.equal(onlyClient.counts.open + onlyClient.counts.done, 2);
  const onlyDone = buildNeedsBoard([needs[6]], ITEMS, { today: TODAY, params: PARAMS });
  assert.deepEqual([onlyDone.groups, onlyDone.done.map((row) => row.title)], [[], ["A posto del fornitore"]]);
  // Le parti nei gruppi.
  assert.deepEqual(
    (["cliente", "insieme", "fornitore", "lateral_space", null] as const).map((side) => needGroupOf(side)),
    ["cliente", "cliente", "fornitore", "lateral_space", "nessuno"],
  );
  assert.deepEqual([...NEED_GROUP_KEYS], ["cliente", "fornitore", "lateral_space", "nessuno"]);
});

test("i gruppi seguono i filtri della pagina e la ricerca nel titolo, mai «Chi» né la parte", () => {
  const needs = [
    need({ title: "Accesso al gestionale", ownerSide: "cliente", ownerLabel: "Giulia", useCaseIds: [A] }),
    need({ title: "Contratto del lettore", ownerSide: "fornitore", useCaseIds: [B] }),
    need({ type: "passo", title: "Avvio", dueOn: "2026-11-03", useCaseIds: [A] }),
    need({ type: "passo", title: "Demo del lettore", dueOn: "2026-11-10", useCaseIds: [B] }),
  ];
  const onlyA = buildNeedsBoard(needs, ITEMS, { today: TODAY, params: PARAMS, only: { useCaseIds: new Set([A]), q: null } });
  assert.deepEqual(onlyA.groups.map((group) => [group.key, group.open.map((row) => row.title)]), [["cliente", ["Accesso al gestionale"]]]);
  assert.deepEqual(onlyA.timeline.sections.flatMap((section) => section.items.map((item) => item.title)), ["Avvio"]);
  const searched = buildNeedsBoard(needs, ITEMS, { today: TODAY, params: PARAMS, only: { useCaseIds: new Set(), q: "lettore" } });
  assert.deepEqual(searched.groups.map((group) => group.key), ["fornitore"]);
  assert.deepEqual(searched.timeline.sections.flatMap((section) => section.items.map((item) => item.title)), ["Demo del lettore"]);
  for (const q of ["Giulia", "Cliente", "fornitore"]) {
    const board = buildNeedsBoard(needs, ITEMS, { today: TODAY, params: PARAMS, only: { useCaseIds: new Set(), q } });
    assert.deepEqual(board.groups, [], `«${q}» non trova nulla (art. 15.4)`);
  }
});

test("la linea del tempo: «Prima di oggi», un mese per volta da quello di oggi, «Senza data»; i fatti da parte", () => {
  const needs = [
    need({ type: "passo", status: "confermata", title: "Scaduto a settembre", dueOn: "2026-09-30" }),
    need({ type: "passo", status: "proposta", title: "Scaduto questo mese", dueOn: "2026-10-20", sortOrder: 0 }),
    need({ type: "passo", status: "proposta", title: "Oggi", dueOn: TODAY, sortOrder: 5 }),
    need({ type: "passo", status: "proposta", title: "Fine mese", dueOn: "2026-10-31" }),
    need({ type: "passo", status: "confermata", title: "Il mese prossimo", dueOn: "2026-11-03" }),
    need({ type: "passo", status: "proposta", title: "A gennaio", dueOn: "2027-01-15" }),
    need({ type: "passo", status: "proposta", title: "Da fissare, primo per il team", sortOrder: 0 }),
    need({ type: "passo", status: "proposta", title: "Da fissare", sortOrder: 1, dueLabel: "entro fine anno" }),
    need({ type: "passo", status: "fatta", title: "Fatto dopo", dueOn: "2026-10-10" }),
    need({ type: "passo", status: "fatta", title: "Fatto prima", dueOn: "2026-09-10" }),
    need({ type: "passo", status: "proposta", title: "Archiviato", dueOn: "2026-10-01", archivedAt: "2026-10-20T10:00:00.000Z" }),
    need({ title: "Un requisito", dueOn: "2026-10-01" }),
  ];
  const { timeline } = buildNeedsBoard(needs, ITEMS, { today: TODAY, params: PARAMS });
  assert.deepEqual(
    timeline.sections.map((section) => [section.key, section.label, section.items.map((item) => item.title)]),
    [
      ["prima", "Prima di oggi", ["Scaduto a settembre", "Scaduto questo mese"]],
      ["2026-10", "Ottobre 2026", ["Oggi", "Fine mese"]],
      ["2026-11", "Novembre 2026", ["Il mese prossimo"]],
      ["2027-01", "Gennaio 2027", ["A gennaio"]],
      ["senza_data", "Senza data", ["Da fissare, primo per il team", "Da fissare"]],
    ],
    "gli scaduti prima, anche di questo mese; oggi non è scaduto; i mesi vuoti non ci sono",
  );
  assert.equal(NEED_TIMELINE_TEXT.before, "Prima di oggi");
  const item = timeline.sections[0].items[0];
  assert.deepEqual([item.dueOn, item.due, item.status.label], ["2026-09-30", "30 set", "Confermato"]);
  assert.deepEqual([timeline.sections[4].items[1].dueOn, timeline.sections[4].items[1].due], [null, "entro fine anno"]);
  assert.deepEqual(timeline.done.map((row) => row.title), ["Fatto prima", "Fatto dopo"], "i fatti per data");
  // Solo passi senza data; nessun passo.
  assert.deepEqual(buildNeedsBoard([needs[6]], ITEMS, { today: TODAY, params: PARAMS }).timeline.sections.map((s) => s.key), ["senza_data"]);
  assert.deepEqual(buildNeedsBoard([needs[11]], ITEMS, { today: TODAY, params: PARAMS }).timeline, { sections: [], done: [] });
});

test("la linea del tempo si chiude dopo i primi cinque: la sezione spezzata ripete il titolo; «Mostra gli altri N»", () => {
  const section = (key: string, n: number): NeedTimelineSection => ({
    key,
    label: key,
    items: Array.from({ length: n }, (_, i) => ({ ...needRow(need({ type: "passo", title: `${key}-${i}` }), new Map(), TODAY), dueOn: null })),
  });
  const titles = (sections: readonly NeedTimelineSection[]) => sections.map((s) => [s.key, s.items.map((item) => item.title)]);
  const split = splitTimeline([section("prima", 3), section("2026-11", 4), section("senza_data", 2)]);
  assert.deepEqual(titles(split.visible), [["prima", ["prima-0", "prima-1", "prima-2"]], ["2026-11", ["2026-11-0", "2026-11-1"]]]);
  assert.deepEqual(titles(split.hidden), [["2026-11", ["2026-11-2", "2026-11-3"]], ["senza_data", ["senza_data-0", "senza_data-1"]]]);
  assert.equal(split.hiddenCount, 4);
  assert.deepEqual(splitTimeline([section("prima", 5)]).hidden, [], "cinque: niente da chiudere");
  assert.equal(splitTimeline([section("prima", 8)]).hiddenCount, 3);
  assert.deepEqual(splitTimeline([]), { visible: [], hidden: [], hiddenCount: 0 });
  assert.equal(moreStepsText(1), "Mostra l'altro");
  assert.equal(moreStepsText(36), "Mostra gli altri 36");
  assert.equal(moreStepsText(1200), "Mostra gli altri 1.200");
});

test("il nome del gruppo del cliente: quello del connettore, altrimenti il workspace; gli altri gruppi", () => {
  assert.equal(clientGroupLabel("  Alfa   e Beta ", "Alfa"), "Alfa e Beta");
  assert.equal(clientGroupLabel(null, "Alfa (prova)"), "Alfa (prova)");
  assert.equal(clientGroupLabel("   ", "Alfa"), "Alfa");
  assert.equal(clientGroupLabel(null, null), "la tua azienda");
  assert.deepEqual(
    NEED_GROUP_KEYS.map((key) => needGroupLabel(key, "Alfa e Beta")),
    ["Alfa e Beta", "Fornitori", "Lateral Space", "Da assegnare"],
  );
  const texts = [...NEED_GROUP_KEYS.map((key) => needGroupLabel(key, "Alfa")), NEED_TIMELINE_TEXT.before, moreStepsText(1), moreStepsText(3)];
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
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
    ...board.groups.flatMap((group) => group.open.map((row) => row.title)),
    ...board.done.map((row) => row.title),
    ...board.timeline.sections.flatMap((section) => section.items.map((row) => row.title)),
  ];
  const board = buildNeedsBoard(needs, ITEMS, { today: TODAY, params: PARAMS, only: { useCaseIds: new Set([A]), q: null } });
  assert.deepEqual(titles(board), ["Accesso al gestionale", "Avvio con il team"], "collegate ad A, anche con l'id in maiuscolo");
  assert.deepEqual(
    board.groups[0].open[0].useCases.map((ref) => ref.code),
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
    buildNeedsBoard([loose, access, owner], ITEMS, { today: TODAY, params: PARAMS, only }).groups.flatMap((group) => group.open.map((row) => row.title));

  assert.ok(titlesWith(null).includes("Un referente"), "senza filtro c'è");
  assert.ok(!titlesWith({ useCaseIds: new Set([A]), q: null }).includes("Un referente"), "con un filtro no");
  assert.deepEqual(titlesWith({ useCaseIds: new Set(), q: "gestionale" }), ["Accesso al GESTIONALE"], "maiuscole non contano; il dettaglio non si cerca");
  assert.deepEqual(titlesWith({ useCaseIds: new Set(), q: "gestionàle" }), ["Accesso al GESTIONALE"], "accenti nemmeno");
  for (const q of ["Giulia", "cliente", "Cliente", "di Giulia"]) {
    assert.deepEqual(titlesWith({ useCaseIds: new Set(), q }), [], `«${q}» non trova nulla (art. 15.4)`);
  }
});

test("i testi di «Cosa serve»: «Per N use case», «Serve anche a…»", () => {
  assert.equal(needForText(3), "Per 3 use case");
  assert.equal(needAlsoForText(1), "Serve anche a un altro use case");
  assert.equal(needAlsoForText(2), "Serve anche ad altri 2 use case");
  assert.equal(needAlsoForText(22), "Serve anche ad altri 22 use case");
  const texts = [needForText(3), needAlsoForText(1), needAlsoForText(2), needAlsoForText(22)];
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
});

test("una riga nomina solo gli use case che chi guarda conosce", () => {
  const board = buildNeedsBoard([need({ title: "Con uno sconosciuto", useCaseIds: [A, "eeeeeeee-0000-4000-8000-000000000005"] })], ITEMS, { today: TODAY, params: PARAMS });
  assert.equal(board.groups[0].open[0].useCases.length, 1);
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

test("Cosa serve: i requisiti contati per gruppo di stato, di tutta la vista; mai i passi né le archiviate", () => {
  // Gli otto stati, in due use case.
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
  // Le stesse righe nei gruppi e a posto: ogni requisito una volta.
  assert.equal(board.groups.reduce((sum, group) => sum + group.open.length, 0), board.counts.open);
  assert.equal(board.done.length, board.counts.done);
  // I conteggi seguono il filtro: solo le esigenze degli use case che lo passano (qui A, gli stati pari).
  const onlyA = buildNeedsBoard([...statuses, ...extra], ITEMS, { today: TODAY, params: PARAMS, only: { useCaseIds: new Set([A]), q: null } });
  assert.deepEqual(onlyA.counts, { open: 3, toAsk: 2, waiting: 0, toVerify: 1, blocked: 0, done: 1 });
  assert.equal(onlyA.groups.reduce((sum, group) => sum + group.open.length, 0) + onlyA.done.length, 4);
  // Uguali a quelli di `needAskCountsOf`, che dà i numeri di «Prossimo passo» della Panoramica.
  assert.deepEqual(onlyA.counts, needAskCountsOf([...statuses, ...extra], new Set([A])));
  assert.deepEqual(buildNeedsBoard([], ITEMS, { today: TODAY, params: PARAMS }).counts, emptyNeedAskCounts());
});

test("i testi dei conteggi: «86 aperti · 60 da chiedere · …», senza gli zeri", () => {
  const counts = (o: Partial<NeedAskCounts>): NeedAskCounts => ({ ...emptyNeedAskCounts(), ...o });
  const line = (o: Partial<NeedAskCounts>) => needsSummaryPieces(counts(o)).join(FIGURE_SEPARATOR);
  assert.equal(line({ open: 86, toAsk: 60, waiting: 12, toVerify: 4, blocked: 10, done: 31 }), "86 aperti · 60 da chiedere · 12 in attesa · 4 da verificare · 10 fermi · 31 a posto");
  assert.equal(line({ open: 1, toAsk: 1 }), "1 aperto · 1 da chiedere");
  assert.equal(line({ done: 3 }), "Nessuno aperto · 3 a posto");
  assert.equal(line({}), "Nessuno aperto");
  assert.deepEqual(needAskPieces(counts({ open: 1, blocked: 1 })), ["1 fermo"], "requisiti, al maschile come «aperti»");
  assert.deepEqual(needAskPieces(counts({ open: 2, waiting: 2 })), ["2 in attesa"], "i gruppi a zero non ci sono");
  assert.deepEqual(needAskPieces(counts({ open: 1200, toAsk: 1200 })), ["1.200 da chiedere"]);
  const texts = [
    ...needsSummaryPieces(counts({ open: 86, toAsk: 60, waiting: 12, toVerify: 4, blocked: 10, done: 31 })),
    ...needsSummaryPieces(counts({ open: 1, blocked: 1 })),
    ...needsSummaryPieces(counts({})),
  ];
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
});

test("gli agenti di un'esigenza: dal titolo dei suoi use case, uno per agente; nessuno senza prefisso", () => {
  assert.deepEqual(
    needAgents([
      { title: "LIBRA L1 · Lettura dei documenti esteri" },
      { title: "ORSA O1 · Solleciti ai clienti" },
      { title: "LIBRA L3 · Riconciliazione dei pagamenti" },
      { title: "Smistamento delle richieste" },
    ]),
    ["LIBRA", "ORSA"],
  );
  assert.deepEqual(needAgents([{ title: "TAIGETE T3 · Note spese" }, { title: "ALCIONE A1 · Budget" }]), ["ALCIONE", "TAIGETE"], "in ordine alfabetico");
  assert.deepEqual(needAgents([{ title: "Margine per commessa" }]), []);
  assert.deepEqual(needAgents([]), []);
});

test("needsActionFirst: prima i requisiti da verificare, poi l'ordine del team; askGroupOf dà i gruppi dei conteggi", () => {
  const a = need({ id: "a", title: "Alfa", sortOrder: 2, status: "da_chiedere" });
  const b = need({ id: "b", title: "Beta", sortOrder: 5, status: "in_verifica" });
  const c = need({ id: "c", title: "Gamma", sortOrder: 1, status: "chiesta" });
  const d = need({ id: "d", title: "Delta", sortOrder: 9, status: "in_verifica" });
  const step = need({ id: "e", title: "Passo", sortOrder: 0, type: "passo", status: "in_verifica" as NeedView["status"] });
  assert.deepEqual([a, b, c, d, step].sort(needsActionFirst).map((n) => n.id), ["b", "d", "e", "c", "a"]);
  assert.deepEqual([a, c].sort(needsActionFirst), [a, c].sort(compareNeeds), "senza risposte da guardare: l'ordine del team");
  assert.deepEqual(
    NEED_REQUIREMENT_STATUSES.map((status) => askGroupOf(status)),
    NEED_REQUIREMENT_STATUSES.map((status) => {
      const counts = needAskCountsOf([need({ status, useCaseIds: ["u"] })], new Set(["u"]));
      return (Object.keys(counts) as Array<keyof NeedAskCounts>).find((key) => key !== "open" && counts[key] === 1);
    }),
    "lo stesso gruppo dei conteggi",
  );
});

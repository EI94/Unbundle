import test from "node:test";
import assert from "node:assert/strict";
import {
  COST_BANDS,
  COST_BANDS_AMOUNT_ERROR,
  COST_BANDS_LABEL_ERROR,
  COST_BANDS_LIMITS_ERROR,
  COST_BANDS_TOP_REFERENCE_ERROR,
  resolveCostBands,
  validateCostBands,
} from "./cost-bands.ts";
import * as bandsEditor from "./settings-bands.ts";
import {
  applyProposedLabel,
  defaultCostBandsDraft,
  draftConfig,
  draftErrors,
  draftFromBands,
  draftInput,
  isDefaultDraft,
  labelProposal,
  parseDraftAmount,
  proposedLabel,
  sameDraft,
  setDraftLabel,
  setDraftLimit,
  setDraftTopReference,
  tidyDraft,
} from "./settings-bands.ts";

// L'editor delle fasce di Impostazioni › Valutazione (docs/use-case/DESIGN.md §7.2 «Fasce del
// workspace», §14.3; D15; PIANO-LAVORI H3d). Cifre ed etichette inventate.

const DEFAULT_LABELS = ["Fino a 25.000 €", "Da 25.000 a 65.000 €", "Da 65.000 a 130.000 €", "Da 130.000 a 250.000 €", "250.000 € e oltre"];

test("parte dalle fasce predefinite: confini con i punti delle migliaia, etichette che seguono i confini", () => {
  const draft = draftFromBands(COST_BANDS);
  assert.deepEqual(draft.limits, ["25.000", "65.000", "130.000", "250.000"]);
  assert.deepEqual(draft.labels, DEFAULT_LABELS);
  assert.equal(draft.topReference, "400.000");
  assert.deepEqual(draft.follows, [true, true, true, true, true]);
  assert.deepEqual(draftErrors(draft), {});
  assert.equal(isDefaultDraft(draft), true);
  assert.ok(sameDraft(draft, defaultCostBandsDraft()));
});

test("parte dalle fasce del workspace: le etichette scritte a mano non seguono i confini", () => {
  const bands = resolveCostBands({
    costBands: { limits: [15_000, 40_000, 100_000, 200_000], labels: ["Piccolo", "Da 15.000 a 40.000 €", "Medio", "Grande", "Enorme"], topReferenceEur: 300_000 },
  });
  const draft = draftFromBands(bands);
  assert.deepEqual(draft.limits, ["15.000", "40.000", "100.000", "200.000"]);
  assert.equal(draft.topReference, "300.000");
  assert.deepEqual(draft.follows, [false, true, false, false, false]);
  assert.equal(isDefaultDraft(draft), false);
  // Rimesse in config, danno le stesse fasce.
  const checked = validateCostBands(draftInput(draft));
  assert.ok(checked.ok);
  assert.deepEqual(resolveCostBands({ costBands: checked.value }), bands);
});

test("un confine cambia le etichette delle due fasce che tocca, se seguono la forma predefinita", () => {
  const start = defaultCostBandsDraft();
  const draft = setDraftLimit(start, 0, "30000");
  assert.deepEqual(draft.labels, ["Fino a 30.000 €", "Da 30.000 a 65.000 €", ...DEFAULT_LABELS.slice(2)]);
  const last = setDraftLimit(start, 3, "300.000");
  assert.deepEqual(last.labels, [...DEFAULT_LABELS.slice(0, 3), "Da 130.000 a 300.000 €", "300.000 € e oltre"]);
  // Un confine ancora vuoto non propone niente: l'etichetta resta.
  const typing = setDraftLimit(start, 1, "");
  assert.deepEqual(typing.labels, DEFAULT_LABELS);
  assert.equal(proposedLabel(typing, 1), null);
  assert.equal(proposedLabel(typing, 0), "Fino a 25.000 €");
});

test("confini che non crescono: nessuna proposta e le etichette che seguono restano finché tornano validi", () => {
  const start = defaultCostBandsDraft();
  // A3 sotto A2 (anche mentre si scrive «140000» cifra per cifra): «Da 65.000 a 20.000 €» non è una fascia.
  const low = setDraftLimit(start, 2, "20.000");
  assert.equal(proposedLabel(low, 2), null);
  assert.equal(proposedLabel(low, 3), "Da 20.000 a 250.000 €", "la fascia dopo cresce: la proposta c'è");
  assert.deepEqual(low.labels, [...DEFAULT_LABELS.slice(0, 3), "Da 20.000 a 250.000 €", DEFAULT_LABELS[4]]);
  assert.equal(low.follows[2], true, "segue ancora la forma predefinita");
  assert.equal(proposedLabel(setDraftLimit(start, 1, "130.000"), 2), null, "confini uguali");
  // Con un'etichetta riscritta niente «Usa …» assurdo.
  const custom = setDraftLabel(start, 2, "Progetti medi");
  assert.equal(labelProposal(setDraftLimit(custom, 2, "20.000"), start, 2), null);
  // Tornati validi, l'etichetta che seguiva si aggiorna.
  const typed = ["1", "14", "140", "1400", "14000", "140000"].reduce((draft, text) => setDraftLimit(draft, 2, text), start);
  assert.deepEqual(typed.labels.slice(2, 4), ["Da 65.000 a 140.000 €", "Da 140.000 a 250.000 €"]);
});

test("un'etichetta riscritta resta com'è e riceve la proposta da usare con un clic", () => {
  const saved = defaultCostBandsDraft();
  const custom = setDraftLabel(saved, 1, "Piccolo");
  assert.equal(custom.follows[1], false);
  assert.equal(labelProposal(custom, saved, 1), null, "nessun confine è cambiato: nessuna proposta");
  const moved = setDraftLimit(custom, 0, "30.000");
  assert.equal(moved.labels[1], "Piccolo", "la riscritta resta");
  assert.equal(moved.labels[0], "Fino a 30.000 €", "l'altra segue");
  assert.equal(labelProposal(moved, saved, 1), "Da 30.000 a 65.000 €");
  assert.equal(labelProposal(moved, saved, 0), null, "segue già i confini");
  assert.equal(labelProposal(moved, saved, 2), null, "nessun suo confine è cambiato");
  const applied = applyProposedLabel(moved, 1);
  assert.equal(applied.labels[1], "Da 30.000 a 65.000 €");
  assert.equal(applied.follows[1], true);
  assert.equal(labelProposal(applied, saved, 1), null);
  // Scrivere a mano proprio la proposta torna a seguire.
  assert.equal(setDraftLabel(custom, 1, " Da 25.000 a 65.000 € ").follows[1], true);
});

test("validazione: le stesse regole e gli stessi testi dell'action (validateCostBands)", () => {
  const start = defaultCostBandsDraft();
  assert.deepEqual(draftErrors(setDraftLimit(start, 1, "20.000")), { "limits.1": COST_BANDS_LIMITS_ERROR });
  assert.deepEqual(draftErrors(setDraftLimit(start, 0, "25.000,50")), { "limits.0": COST_BANDS_AMOUNT_ERROR });
  assert.deepEqual(draftErrors(setDraftTopReference(start, "250.000")), { topReferenceEur: COST_BANDS_TOP_REFERENCE_ERROR });
  assert.deepEqual(draftErrors(setDraftLabel(start, 2, "")), { "labels.2": COST_BANDS_LABEL_ERROR });
  assert.deepEqual(draftErrors(setDraftLabel(start, 4, "x".repeat(41))), { "labels.4": COST_BANDS_LABEL_ERROR });
  assert.deepEqual(draftErrors(setDraftLabel(start, 4, "x".repeat(40))), {});
  assert.equal(draftConfig(setDraftLimit(start, 1, "20.000")), null);
});

test("uscendo dal campo gli importi si riscrivono con i punti; un testo non valido resta com'è", () => {
  const draft = setDraftTopReference(setDraftLimit(defaultCostBandsDraft(), 0, "30000"), "450000");
  const tidy = tidyDraft(draft);
  assert.equal(tidy.limits[0], "30.000");
  assert.equal(tidy.topReference, "450.000");
  assert.equal(tidyDraft(setDraftLimit(draft, 1, "65k")).limits[1], "65k");
  assert.equal(parseDraftAmount("1.000.000"), 1_000_000);
  assert.equal(parseDraftAmount("0"), null);
  assert.equal(parseDraftAmount("1,5"), null);
});

test("niente da salvare se la bozza dice le stesse fasce, scritte in un altro modo", () => {
  const saved = defaultCostBandsDraft();
  assert.ok(sameDraft(setDraftLimit(saved, 0, "25000"), saved));
  assert.ok(sameDraft(setDraftLabel(saved, 0, "Fino a 25.000 € "), saved), "gli spazi ai lati non contano");
  assert.ok(!sameDraft(setDraftLimit(saved, 0, "26000"), saved));
  assert.ok(!sameDraft(setDraftLimit(saved, 1, "1"), saved), "una bozza non valida è sempre una modifica");
});

test("«Ripristina le fasce predefinite» torna alle predefinite e alle etichette che seguono i confini", () => {
  const custom = setDraftLabel(setDraftLimit(defaultCostBandsDraft(), 0, "15.000"), 2, "Medio");
  assert.equal(isDefaultDraft(custom), false);
  const reset = defaultCostBandsDraft();
  assert.equal(isDefaultDraft(reset), true);
  assert.deepEqual(reset.follows, [true, true, true, true, true]);
});

test("la bozza valida è la config da salvare: 4 confini, 5 etichette, valore della quinta", () => {
  const draft = setDraftTopReference(setDraftLimit(defaultCostBandsDraft(), 0, "15.000"), "500.000");
  assert.deepEqual(draftConfig(draft), {
    limits: [15_000, 65_000, 130_000, 250_000],
    labels: ["Fino a 15.000 €", "Da 15.000 a 65.000 €", ...DEFAULT_LABELS.slice(2)],
    topReferenceEur: 500_000,
  });
  assert.deepEqual(Object.keys(draftInput(draft)), ["limits", "labels", "topReferenceEur"]);
});

test("indici fuori dalle fasce non cambiano la bozza; nessun nome `use` più una maiuscola (D16)", () => {
  const draft = defaultCostBandsDraft();
  assert.equal(setDraftLimit(draft, 4, "1"), draft);
  assert.equal(setDraftLabel(draft, 5, "x"), draft);
  assert.equal(proposedLabel(draft, -1), null);
  assert.equal(labelProposal(draft, draft, 7), null);
  for (const name of Object.keys(bandsEditor)) assert.doesNotMatch(name, /^use[A-Z]/, name);
});

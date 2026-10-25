import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbiddenIn } from "../../../lib/use-cases/copy-guard.ts";
import { DEFAULT_VALUE_PARAMS, VALUE_MODEL_ERRORS, valueModelSchema, type ValueModel, type ValueParams } from "../../../lib/use-cases/value-model.ts";
import {
  VALUE_MODEL_DRAFT_ERRORS,
  VALUE_MODEL_EDITOR_TEXT,
  componentLine,
  draftErrorsFromService,
  draftFromModel,
  draftLevers,
  draftPrimary,
  liveDraftErrors,
  modelFromDraft,
  newComponentDraft,
  newComponentKey,
  sameValueModel,
  totalsLines,
  type ValueModelDraft,
} from "./value-model-draft.ts";

// L'editor «Benefici e costi» (spec di Pierpaolo, 25/10/2026): bozza, modello, righe calcolate.

const PARAMS: ValueParams = { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11" };

const FIX_A: ValueModel = valueModelSchema.parse({
  v: 1,
  primary: "tempo",
  whyPrimary: "È il grosso del lavoro.",
  components: [
    { key: "capacita", lever: "nuove_capacita", label: "Risposte anche fuori orario", kind: "qualitativo", confidence: "ipotesi" },
    { key: "tempo", lever: "tempo", label: "Smistamento delle richieste", kind: "ore", volumeYear: 6600, unit: "richieste", minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi", basis: "Registro di ottobre" },
    { key: "qualita", lever: "qualita", label: "Meno errori di smistamento", kind: "qualitativo", confidence: "da_misurare" },
  ],
  ease: 4,
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
  group: "Assistenza",
  confirmBy: "Responsabile assistenza",
  plan: { quarter: "2026-Q4", startMonth: "2026-11", goLiveMonth: "2027-01" },
});

function empty(): ValueModelDraft {
  return draftFromModel(null);
}

test("bozza e ritorno: dal modello salvato e di nuovo al modello, uguale", () => {
  const draft = draftFromModel(FIX_A);
  assert.equal(draft.components[1].volumeYear, "6.600");
  assert.equal(draft.components[1].minutesPerUnit, "1,5");
  assert.equal(draft.devDays, "4");
  const back = modelFromDraft(draft);
  assert.ok(back.ok);
  assert.ok(back.ok && sameValueModel(back.model, FIX_A), JSON.stringify(back));
});

test("senza voci non c'è modello: salvare lo toglie", () => {
  assert.deepEqual(modelFromDraft(empty()), { ok: true, model: null });
  assert.deepEqual(modelFromDraft({ ...draftFromModel(FIX_A), components: [] }), { ok: true, model: null });
});

test("una voce nuova: tipo non ancora usato, chiave unica; ritorno principale sempre il tipo di una voce", () => {
  const draft = draftFromModel(FIX_A);
  const next = newComponentDraft(draft.components);
  assert.equal(next.lever, "output");
  assert.equal(next.key, "voce-1");
  assert.equal(newComponentKey([{ key: "voce-1" }, { key: "voce-2" }]), "voce-3");
  assert.deepEqual(draftLevers(draft), ["tempo", "qualita", "nuove_capacita"]);
  assert.equal(draftPrimary(draft), "tempo");
  assert.equal(draftPrimary({ primary: "ricavi", components: draft.components }), "nuove_capacita", "il primo tipo delle voci");
  const added = { ...empty(), components: [{ ...newComponentDraft([]), label: "Meno solleciti", volumeYear: "600", minutesPerUnit: "6", automatablePct: "80" }] };
  const model = modelFromDraft(added);
  assert.ok(model.ok && model.model?.primary === "tempo" && model.model.components[0].kind === "ore");
});

test("errori per campo in italiano, con i percorsi del modello", () => {
  const draft = draftFromModel(FIX_A);
  draft.components[1] = { ...draft.components[1], label: " ", volumeYear: "tante", automatablePct: "120" };
  draft.devDays = "quattro";
  draft.goLiveMonth = "2026-10";
  assert.deepEqual(modelFromDraft(draft), {
    ok: false,
    errors: {
      "components.1.label": VALUE_MODEL_DRAFT_ERRORS.label,
      "components.1.volumeYear": VALUE_MODEL_DRAFT_ERRORS.volumeYear,
      "components.1.automatablePct": VALUE_MODEL_DRAFT_ERRORS.automatablePct,
      "costs.devDays": VALUE_MODEL_DRAFT_ERRORS.number,
      "plan.goLiveMonth": VALUE_MODEL_ERRORS.goLiveBeforeStart,
    },
  });
  const oneMonth = { ...draftFromModel(FIX_A), goLiveMonth: "" };
  assert.deepEqual(modelFromDraft(oneMonth), { ok: false, errors: { plan: VALUE_MODEL_DRAFT_ERRORS.months } });
  const euro = { ...empty(), components: [{ ...newComponentDraft([]), kind: "euro" as const, label: "Licenze" }] };
  assert.deepEqual(modelFromDraft(euro), { ok: false, errors: { "components.0.eurYear": VALUE_MODEL_DRAFT_ERRORS.eurYear } });
  // Un testo troppo lungo lo ferma lo schema.
  const long = { ...draftFromModel(FIX_A), group: "x".repeat(61) };
  assert.deepEqual(modelFromDraft(long), { ok: false, errors: { group: VALUE_MODEL_DRAFT_ERRORS.invalid } });
});

test("costi: basta un numero, gli altri vuoti valgono zero; senza numeri nessun costo", () => {
  const onlyRun = { ...draftFromModel(FIX_A), devDays: "", internalHours: "", runCostEurYear: "1.200" };
  const model = modelFromDraft(onlyRun);
  assert.ok(model.ok);
  assert.deepEqual(model.ok && model.model?.costs, { devDays: 0, internalHours: 0, runCostEurYear: 1200 });
  const none = modelFromDraft({ ...draftFromModel(FIX_A), devDays: "", internalHours: "", runCostEurYear: "", runCostNote: "licenza" });
  assert.ok(none.ok && none.model?.costs === undefined);
});

test("piano: il trimestre salvato resta con lo stesso avvio; un avvio nuovo prende il suo trimestre", () => {
  const later = valueModelSchema.parse({ ...FIX_A, plan: { quarter: "piu_avanti", startMonth: "2027-04", goLiveMonth: "2027-06" } });
  const same = modelFromDraft(draftFromModel(later));
  assert.ok(same.ok && same.model?.plan?.quarter === "piu_avanti");
  const moved = modelFromDraft({ ...draftFromModel(later), startMonth: "2027-07", goLiveMonth: "2027-09" });
  assert.ok(moved.ok && moved.model?.plan?.quarter === "2027-Q3");
});

test("righe calcolate: «116 h · 4.043 €» per voce, totali, da misurare e costi", () => {
  const draft = draftFromModel(FIX_A);
  assert.equal(componentLine(draft.components[1], PARAMS), "116 h · 4.043 €");
  assert.equal(componentLine(draft.components[0], PARAMS), "qualitativo");
  const pending = { ...draft.components[1], confidence: "da_misurare" as const };
  assert.equal(componentLine(pending, PARAMS), "116 h · 4.043 € · da misurare, fuori dal totale");
  assert.equal(componentLine(pending, { ...PARAMS, includeUnmeasured: true }), "116 h · 4.043 €");
  assert.equal(componentLine({ ...draft.components[1], kind: "euro", eurYear: "535" }, PARAMS), "535 €");
  assert.deepEqual(totalsLines(draft, PARAMS), {
    counted: "Contati: 116 h · 4.043 € all'anno",
    pending: null,
    costs: "avvio 560 € · ricorrenti 600 €/anno",
  });
  const withPending = { ...draft, components: [...draft.components, { ...pending, key: "p" }] };
  assert.equal(totalsLines(withPending, PARAMS).pending, "Da misurare, fuori dal totale: fino a 4.043 €");
  // Mentre si scrive, un numero che manca o non si legge dà «—», non «0 h · 0 €».
  assert.equal(componentLine({ ...draft.components[1], minutesPerUnit: "" }, PARAMS), "—");
  assert.equal(componentLine({ ...draft.components[1], volumeYear: "abc" }, PARAMS), "—");
  assert.equal(componentLine({ ...draft.components[1], automatablePct: "140" }, PARAMS), "—");
  assert.equal(componentLine({ ...draft.components[1], kind: "euro", eurYear: "" }, PARAMS), "—");
});

test("errori mentre si scrive: numeri che non si leggono e quote oltre 100; i vuoti aspettano «Salva»", () => {
  const draft = draftFromModel(FIX_A);
  assert.deepEqual(liveDraftErrors(draft), {}, "un modello valido non ha errori");
  const typing: ValueModelDraft = {
    ...draft,
    components: [
      draft.components[0],
      { ...draft.components[1], volumeYear: "abc", minutesPerUnit: "", automatablePct: "140" },
      { ...draft.components[1], key: "euro", kind: "euro", eurYear: "12.000,5,1" },
    ],
    devDays: "due",
    internalHours: "",
  };
  assert.deepEqual(liveDraftErrors(typing), {
    "components.1.volumeYear": VALUE_MODEL_DRAFT_ERRORS.volumeYear,
    "components.1.automatablePct": VALUE_MODEL_DRAFT_ERRORS.automatablePct,
    "components.2.eurYear": VALUE_MODEL_DRAFT_ERRORS.eurYear,
    "costs.devDays": VALUE_MODEL_DRAFT_ERRORS.number,
  });
  // I totali non contano la voce con la quota sbagliata.
  assert.equal(totalsLines({ ...draft, components: [{ ...draft.components[1], automatablePct: "140" }] }, PARAMS).counted, "Contati: 0 € all'anno");
});

test("i due «Perché» hanno nomi diversi", () => {
  assert.equal(VALUE_MODEL_EDITOR_TEXT.whyPrimary, "Perché è il principale");
  assert.equal(VALUE_MODEL_EDITOR_TEXT.easeWhy, "Perché questa facilità");
});

test("errori del servizio sotto «model.» tornano sui campi della bozza", () => {
  assert.deepEqual(draftErrorsFromService({ "model.components.0.label": "x", "model.primary": "y", cost: "z", model: "w" }), {
    "components.0.label": "x",
    primary: "y",
    model: "w",
  });
});

test("copy-guard verde sui testi dell'editor", () => {
  const texts = [...Object.values(VALUE_MODEL_EDITOR_TEXT), ...Object.values(VALUE_MODEL_DRAFT_ERRORS)];
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
});

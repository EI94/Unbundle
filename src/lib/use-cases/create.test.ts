import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseBand,
  costFormValue,
  initialCostInputState,
  setAmountText,
  switchToBand,
} from "../../components/use-cases/cost-input-state.ts";
import { DEFAULT_REVIEW_TEAM_NAME } from "../review-team.ts";
import { findHubForbiddenIn } from "./copy-guard.ts";
import { COST_BANDS } from "./cost-bands.ts";
import {
  ACTIVITY_MAPPING_TEXT,
  FORM_FIELD_NAMES,
  FORM_TEXT,
  KIND_OPTIONS,
  ORIGIN_OPTIONS,
  QUICK_CREATE_MAX,
  QUICK_CREATE_TEXT,
  activityMappingItems,
  activityMappingPath,
  activityMappingState,
  defaultOriginFor,
  formFields,
  formSubtitle,
  fullFormPath,
  URGENCY_LABEL,
  parseUseCaseForm,
  proposedToast,
  quickCreateItem,
  quickFieldErrors,
  readQuickCreate,
  receiptPath,
  savedToast,
} from "./create.ts";
import { COST_AMOUNT_ERROR, COST_BOTH_ERROR, TEXT_LIMITS, VALUE_AMOUNT_ERROR, tooLongMessage } from "./inputs.ts";
import { WHAT_FIELD_LABEL } from "./labels.ts";
import { abilitiesForUseCase, type UseCaseViewer } from "./permissions.ts";

// Nuovo use case e Activity mapping (docs/use-case/DESIGN.md §5.1-§5.4, §8, §8.5, §14.3;
// PIANO-LAVORI H3c): le regole pure di src/lib/use-cases/create.ts. Testi e dati sintetici.

const WS = "11111111-2222-4333-8444-555555555555";
const UC = "66666666-7777-4888-8999-000000000000";

function viewer(role: string | null, isLateralSpace: boolean): UseCaseViewer {
  return { userId: "u-1", email: "persona@cliente.test", emailVerified: true, role, isLateralSpace };
}

// ─── Origine predefinita per ruolo (§5.2, §5.3, §8) ──────────────────

test("origine predefinita per ruolo: modulo completo AI Transformation solo per Lateral Space con ruolo da revisore", () => {
  const cases: Array<[string, boolean, "adoption" | "transformation", "pannello_rapido" | "modulo_completo"]> = [
    ["transformation_lead", true, "transformation", "pannello_rapido"],
    ["exec_sponsor", true, "transformation", "pannello_rapido"],
    ["function_lead", true, "transformation", "pannello_rapido"],
    ["analyst", true, "transformation", "pannello_rapido"],
    ["transformation_lead", false, "adoption", "modulo_completo"],
    ["exec_sponsor", false, "adoption", "modulo_completo"],
    ["function_lead", false, "adoption", "modulo_completo"],
    ["analyst", false, "adoption", "modulo_completo"],
    ["contributor", false, "adoption", "modulo_completo"],
    // Lateral Space senza ruolo da revisore: modulo completo, dal basso.
    ["contributor", true, "adoption", "modulo_completo"],
  ];
  for (const [role, ls, origin, entry] of cases) {
    const abilities = abilitiesForUseCase(viewer(role, ls));
    assert.equal(abilities.newUseCase, entry, `${role} ${ls ? "LS" : "cliente"}: ingresso`);
    assert.equal(defaultOriginFor("modulo_completo", abilities), origin, `${role} ${ls ? "LS" : "cliente"}: modulo completo`);
    // Il pannello rapido parte sempre da «AI Transformation».
    assert.equal(defaultOriginFor("pannello_rapido", abilities), "transformation");
  }
  // Chi non entra non ha un ingresso.
  assert.equal(abilitiesForUseCase(viewer("learner", true)).newUseCase, null);
  assert.equal(abilitiesForUseCase(viewer(null, false)).newUseCase, null);
});

test("scelte dei chip e dei blocchi: due origini e due tipi, con le etichette di §3.2 e §3.3", () => {
  assert.deepEqual(ORIGIN_OPTIONS, [
    { value: "adoption", label: "AI Adoption · dal basso", chip: "AI Adoption" },
    { value: "transformation", label: "AI Transformation · dall'alto", chip: "AI Transformation" },
  ]);
  assert.deepEqual(KIND_OPTIONS, [
    { value: "da_costruire", label: "Da costruire" },
    { value: "da_diffondere", label: "Da diffondere" },
  ]);
});

// ─── Pannello rapido (§5.2) ──────────────────────────────────────────

test("pannello rapido: tre campi, AI Transformation e Da costruire predefiniti, problema in description, nessun proponente", () => {
  const read = readQuickCreate({ title: "  Smistamento richieste  ", problem: "Le richieste arrivano in ordine sparso", aiLab: "" });
  assert.ok(read.ok);
  assert.deepEqual(read.value, {
    title: "Smistamento richieste",
    problem: "Le richieste arrivano in ordine sparso",
    aiLab: null,
    origin: "transformation",
    kind: "da_costruire",
  });
  const item = quickCreateItem(read.value);
  assert.deepEqual(item, {
    source: "manual",
    kind: "da_costruire",
    origin: "transformation",
    title: "Smistamento richieste",
    description: "Le richieste arrivano in ordine sparso",
    aiLab: null,
  });
  assert.deepEqual(Object.keys(item).sort(), ["aiLab", "description", "kind", "origin", "source", "title"]);

  const chosen = readQuickCreate({ title: "Bozze di risposta", problem: "Tre risposte uguali al giorno", aiLab: "AI Lab Finanza · 12 ott", origin: "adoption", kind: "da_diffondere" });
  assert.ok(chosen.ok);
  assert.deepEqual(quickCreateItem(chosen.value), {
    source: "manual",
    kind: "da_diffondere",
    origin: "adoption",
    title: "Bozze di risposta",
    description: "Tre risposte uguali al giorno",
    aiLab: "AI Lab Finanza · 12 ott",
  });
});

test("pannello rapido: limiti di §5.2 e nomi dei campi del pannello negli errori", () => {
  assert.deepEqual(QUICK_CREATE_MAX, { title: 200, problem: 300, aiLab: 120 });
  const short = readQuickCreate({ title: "ab", problem: "x", aiLab: "a".repeat(121) });
  assert.ok(!short.ok);
  assert.deepEqual(Object.keys(short.fieldErrors).sort(), ["aiLab", "problem", "title"]);
  const long = readQuickCreate({ title: "a".repeat(201), problem: "a".repeat(301) });
  assert.ok(!long.ok);
  assert.equal(long.fieldErrors.title, tooLongMessage(200));
  assert.equal(long.fieldErrors.problem, tooLongMessage(300));
  // Gli errori del servizio chiamano `description` il problema.
  assert.deepEqual(quickFieldErrors({ description: "Troppo lungo.", title: "Corto.", aiLab: "No." }), {
    problem: "Troppo lungo.",
    title: "Corto.",
    aiLab: "No.",
  });
  assert.deepEqual(quickFieldErrors(undefined), {});
  // Campi in più: rifiutati.
  assert.ok(!readQuickCreate({ title: "Titolo valido", problem: "Problema valido", source: "web_proposed" }).ok);
});

test("pannello rapido: testi esatti di §5.2 e toast «XX-0031 salvato.»", () => {
  assert.equal(QUICK_CREATE_TEXT.heading, "Nuovo use case");
  assert.equal(QUICK_CREATE_TEXT.titleLabel, "Titolo");
  assert.equal(QUICK_CREATE_TEXT.problemLabel, "Problema in una riga");
  assert.equal(QUICK_CREATE_TEXT.aiLabLabel, "AI Lab");
  assert.equal(QUICK_CREATE_TEXT.hint, "I dettagli si completano dopo.");
  assert.equal(QUICK_CREATE_TEXT.save, "Salva");
  assert.equal(QUICK_CREATE_TEXT.saveAndAdd, "Salva e aggiungi un altro");
  assert.equal(QUICK_CREATE_TEXT.fullForm, "Usa il modulo completo");
  assert.equal(QUICK_CREATE_TEXT.error, "Non riusciamo a salvare. Riprova.");
  assert.equal(savedToast("XX-0031"), "XX-0031 salvato.");
  assert.equal(savedToast(null), "Use case salvato.");
  assert.equal(fullFormPath(WS), `/dashboard/${WS}/use-cases/nuovo`);
});

// ─── Modulo completo (§5.3, §6.2) ────────────────────────────────────

test("modulo completo: i campi di oggi con le etichette di §6.2 per tipo; Limiti e Urgenza solo da costruire, ESG solo se attivo", () => {
  const build = formFields("da_costruire", { esgEnabled: false });
  assert.deepEqual(
    build.map((f) => [f.name, f.label, f.required, f.multiline, f.max]),
    [
      ["title", "Titolo", true, false, 200],
      ["description", "Problema", true, true, 4000],
      ["flowDescription", "Come funziona", true, true, 4000],
      ["businessCase", "Impatto atteso", true, true, 2000],
      ["humanInTheLoop", "Chi controlla", true, true, 2000],
      ["guardrails", "Limiti", false, true, 2000],
      ["dataRequirements", "Dati", true, true, 2000],
      // «Urgenza» come oggi (`submit-form.tsx`), in fondo: facoltativa, una riga, colonna `timeline`.
      ["timeline", "Urgenza", false, false, 255],
    ],
  );
  assert.equal(URGENCY_LABEL, "Urgenza");
  assert.equal(formFields("da_costruire", { esgEnabled: true }).at(-1)?.name, "timeline", "Urgenza dopo l'impatto ambientale, come oggi");
  const spread = formFields("da_diffondere", { esgEnabled: true });
  assert.deepEqual(
    spread.map((f) => [f.name, f.label, f.required]),
    [
      ["title", "Titolo", true],
      ["description", "Prima", true],
      ["flowDescription", "Adesso", true],
      ["businessCase", "Risultato", true],
      ["humanInTheLoop", "Chi la usa", true],
      ["dataRequirements", "Cosa serve per copiarla", true],
      ["sustainabilityImpact", "Impatto ambientale e sociale", true],
    ],
  );
  // Le etichette vengono da WHAT_FIELD_LABEL, non scritte una seconda volta; «Urgenza» sta in
  // «Dettagli» (§6.2), non in «Cosa è».
  for (const kind of ["da_costruire", "da_diffondere"] as const) {
    for (const field of formFields(kind, { esgEnabled: true })) {
      if (field.name === "timeline") assert.equal(field.label, URGENCY_LABEL);
      else assert.equal(field.label, WHAT_FIELD_LABEL[field.name][kind]);
    }
  }
});

test("modulo completo: testi esatti di §5.3, nome del team senza articolo né «team»", () => {
  assert.equal(FORM_TEXT.heading, "Nuovo use case");
  assert.equal(FORM_TEXT.kindQuestion, "Che cosa proponi?");
  assert.deepEqual(FORM_TEXT.kindOptions, {
    da_costruire: "Un'idea da costruire con l'AI",
    da_diffondere: "Una cosa che fai già con l'AI e che altri possono copiare",
  });
  assert.equal(FORM_TEXT.originBlock, "Origine");
  assert.equal(FORM_TEXT.valuationBlock, "Valutazione iniziale (facoltativa)");
  assert.equal(FORM_TEXT.valueLabel, "Valore all'anno");
  assert.equal(FORM_TEXT.submit, "Invia lo use case");
  assert.equal(FORM_TEXT.optional, "facoltativo");
  assert.equal(FORM_TEXT.requiredNote, "I campi sono obbligatori, tranne quelli segnati «facoltativo».");
  // §14.3: i testi del modulo sono quelli di §5.3-§5.5, niente di più. Nessun aiuto sotto
  // «Valore all'anno» e nessun avviso sulle schede nascoste: quello sta sotto la nota pubblica
  // (§6.4, §8.6), non nel modulo.
  assert.deepEqual(Object.keys(FORM_TEXT), [
    "heading",
    "back",
    "kindQuestion",
    "kindOptions",
    "originBlock",
    "valuationBlock",
    "valueLabel",
    "valuePlaceholder",
    "submit",
    "submitting",
    "required",
    // H4p: il modulo dice quali campi sono facoltativi.
    "optional",
    "requiredNote",
    "tooShort",
    "titleTooShort",
    "chooseKind",
    "chooseOrigin",
    "fixFields",
    "error",
  ]);
  const formStrings = Object.values(FORM_TEXT).flatMap((value) => (typeof value === "string" ? [value] : Object.values(value)));
  assert.deepEqual(formStrings.filter((text) => /nascost|beneficio/i.test(text)), []);
  const subtitle = formSubtitle(DEFAULT_REVIEW_TEAM_NAME);
  assert.equal(subtitle, `Racconta l'idea in modo semplice. La valuta ${DEFAULT_REVIEW_TEAM_NAME}: qui vedi come va.`);
  assert.doesNotMatch(subtitle, new RegExp(`\\b(il|lo|team) ${DEFAULT_REVIEW_TEAM_NAME}`, "i"));
  assert.equal(formSubtitle("CoE AI"), "Racconta l'idea in modo semplice. La valuta CoE AI: qui vedi come va.");
  assert.equal(receiptPath(WS, UC), `/dashboard/${WS}/use-cases?vista=panoramica&thanks=1&created=${UC}`);
});

/** Un modulo come lo legge FormData: `get` dà null per un campo che non c'è. */
function formOf(values: Record<string, string>) {
  return (name: string): unknown => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null);
}

const FILLED = {
  kind: "da_costruire",
  title: "  Smistamento richieste  ",
  description: "Le richieste arrivano in ordine sparso",
  flowDescription: "Claude legge e smista",
  businessCase: "Meno attese",
  humanInTheLoop: "Un operatore controlla",
  guardrails: "Niente dati sanitari",
  dataRequirements: "Le richieste dell'ultimo anno",
};

test("modulo completo: un contributore propone; testi puliti, Limiti e ESG solo dove servono, niente campi dei revisori", () => {
  const read = parseUseCaseForm(formOf({ ...FILLED, sustainabilityImpact: "Meno carta", origin: "transformation", valueEurYear: "60000", cost: '{"eurOnce":40000}' }), {
    esgEnabled: false,
    isReviewer: false,
  });
  assert.ok(read.ok);
  assert.deepEqual(read.item, {
    source: "web_proposed",
    kind: "da_costruire",
    title: "Smistamento richieste",
    description: "Le richieste arrivano in ordine sparso",
    flowDescription: "Claude legge e smista",
    humanInTheLoop: "Un operatore controlla",
    guardrails: "Niente dati sanitari",
    businessCase: "Meno attese",
    dataRequirements: "Le richieste dell'ultimo anno",
    sustainabilityImpact: null,
    timeline: null,
  });
  // «Urgenza» facoltativa, solo per «Da costruire»: spazi tolti, vuota = nessun valore.
  const urgent = parseUseCaseForm(formOf({ ...FILLED, timeline: "  entro 3 mesi  " }), { esgEnabled: false, isReviewer: false });
  assert.ok(urgent.ok);
  assert.equal(urgent.item.timeline, "entro 3 mesi");
  const blank = parseUseCaseForm(formOf({ ...FILLED, timeline: "   " }), { esgEnabled: false, isReviewer: false });
  assert.ok(blank.ok);
  assert.equal(blank.item.timeline, null);
  // Da diffondere: «Limiti» e «Urgenza» non ci sono; con ESG attivo l'impatto è obbligatorio e si tiene.
  const spread = parseUseCaseForm(formOf({ ...FILLED, kind: "da_diffondere", sustainabilityImpact: "Meno carta", timeline: "entro 3 mesi" }), {
    esgEnabled: true,
    isReviewer: false,
  });
  assert.ok(spread.ok);
  assert.equal(spread.item.guardrails, null);
  assert.equal(spread.item.timeline, null);
  assert.equal(spread.item.sustainabilityImpact, "Meno carta");
  assert.equal(spread.item.kind, "da_diffondere");
  // «Limiti» vuoto va bene.
  const noLimits = parseUseCaseForm(formOf({ ...FILLED, guardrails: "   " }), { esgEnabled: false, isReviewer: false });
  assert.ok(noLimits.ok);
  assert.equal(noLimits.item.guardrails, null);
});

test("modulo completo: obbligatori come oggi, tipo da scegliere, testi corti e lunghi", () => {
  const noKind = parseUseCaseForm(formOf({ title: "Titolo" }), { esgEnabled: false, isReviewer: false });
  assert.ok(!noKind.ok);
  assert.deepEqual(noKind.fieldErrors, { kind: FORM_TEXT.chooseKind });
  assert.equal(noKind.message, FORM_TEXT.fixFields);

  const empty = parseUseCaseForm(formOf({ kind: "da_costruire" }), { esgEnabled: true, isReviewer: true });
  assert.ok(!empty.ok);
  assert.deepEqual(Object.keys(empty.fieldErrors).sort(), [
    "businessCase",
    "dataRequirements",
    "description",
    "flowDescription",
    "humanInTheLoop",
    "sustainabilityImpact",
    "title",
  ]);
  assert.ok(Object.values(empty.fieldErrors).every((message) => message === FORM_TEXT.required));

  const short = parseUseCaseForm(formOf({ ...FILLED, title: "ab", description: "x" }), { esgEnabled: false, isReviewer: false });
  assert.ok(!short.ok);
  assert.deepEqual(short.fieldErrors, { title: FORM_TEXT.titleTooShort, description: FORM_TEXT.tooShort });

  const long = parseUseCaseForm(formOf({ ...FILLED, title: "a".repeat(201), guardrails: "a".repeat(2001), timeline: "a".repeat(256) }), {
    esgEnabled: false,
    isReviewer: false,
  });
  assert.ok(!long.ok);
  assert.deepEqual(long.fieldErrors, {
    title: tooLongMessage(TEXT_LIMITS.title),
    guardrails: tooLongMessage(TEXT_LIMITS.guardrails),
    timeline: tooLongMessage(255),
  });
  // «Urgenza» corta va bene: non ha il minimo dei testi obbligatori.
  const shortUrgency = parseUseCaseForm(formOf({ ...FILLED, timeline: "Q1" }), { esgEnabled: false, isReviewer: false });
  assert.ok(shortUrgency.ok);
  assert.equal(shortUrgency.item.timeline, "Q1");
});

test("modulo completo, revisori: origine, valore all'anno e costo dal campo di §5.4 (importo o fascia, mai tutti e due)", () => {
  const opts = { esgEnabled: false, isReviewer: true };
  // Il campo costo scrive un solo valore nascosto: importo…
  const amount = costFormValue(setAmountText(initialCostInputState(), "40.000"));
  const withAmount = parseUseCaseForm(formOf({ ...FILLED, origin: "transformation", valueEurYear: "60.000", cost: amount }), opts);
  assert.ok(withAmount.ok);
  assert.equal(withAmount.item.origin, "transformation");
  assert.equal(withAmount.item.valueEurYear, 60000);
  assert.deepEqual(withAmount.item.cost, { eurOnce: 40000 });
  // …oppure una fascia (l'indice), anche con le fasce del workspace.
  const band = costFormValue(chooseBand(switchToBand(initialCostInputState(), COST_BANDS), "2"));
  const withBand = parseUseCaseForm(formOf({ ...FILLED, origin: "adoption", cost: band }), opts);
  assert.ok(withBand.ok);
  assert.deepEqual(withBand.item.cost, { band: 2 });
  assert.equal(withBand.item.origin, "adoption");
  assert.equal(withBand.item.valueEurYear, undefined, "valore vuoto: nessun valore");
  // Niente costo e niente valore: nessuna chiave.
  const nothing = parseUseCaseForm(formOf({ ...FILLED, origin: "adoption", cost: "", valueEurYear: "" }), opts);
  assert.ok(nothing.ok);
  assert.ok(!("cost" in nothing.item) && !("valueEurYear" in nothing.item));

  const wrong = parseUseCaseForm(formOf({ ...FILLED, origin: "dall'alto", valueEurYear: "60,5", cost: '{"eurOnce":"40,5"}' }), opts);
  assert.ok(!wrong.ok);
  assert.deepEqual(wrong.fieldErrors, { origin: FORM_TEXT.chooseOrigin, valueEurYear: VALUE_AMOUNT_ERROR, cost: COST_AMOUNT_ERROR });
  const both = parseUseCaseForm(formOf({ ...FILLED, cost: '{"eurOnce":40000,"band":2}' }), opts);
  assert.ok(!both.ok);
  assert.equal(both.fieldErrors.cost, COST_BOTH_ERROR);
  assert.deepEqual(Object.values(FORM_FIELD_NAMES).sort(), ["cost", "kind", "origin", "valueEurYear"]);
});

// ─── Activity mapping (§8.5) ─────────────────────────────────────────

test("Activity mapping: prima si classificano le attività; poi il dialogo", () => {
  assert.equal(activityMappingState({ total: 0, classified: 0 }), "nessuna_attivita");
  assert.equal(activityMappingState({ total: 5, classified: 0 }), "da_classificare");
  assert.equal(activityMappingState({ total: 5, classified: 4 }), "da_classificare");
  assert.equal(activityMappingState({ total: 5, classified: 5 }), "pronto");
  assert.equal(activityMappingPath(WS), `/dashboard/${WS}/mapping`);
});

test("Activity mapping: testi esatti di §8.5 e §14.3, toast con il numero", () => {
  assert.equal(ACTIVITY_MAPPING_TEXT.menuItem, "Proponi da Activity mapping");
  assert.equal(ACTIVITY_MAPPING_TEXT.classifyFirst, "Prima classifica le attività in Activity mapping.");
  assert.equal(ACTIVITY_MAPPING_TEXT.dialogTitle, "Proporre use case dalle attività mappate?");
  assert.equal(
    ACTIVITY_MAPPING_TEXT.dialogBody,
    "Claude legge le attività classificate e propone nuovi use case. Arrivano in «Da decidere», nascosti ai colleghi. Nessuno viene approvato da solo.",
  );
  assert.equal(ACTIVITY_MAPPING_TEXT.confirm, "Proponi");
  assert.equal(ACTIVITY_MAPPING_TEXT.cancel, "Annulla");
  assert.equal(proposedToast(6), "Proposti 6 use case: li trovi in «Da decidere».");
  assert.equal(proposedToast(1), "Proposto 1 use case: lo trovi in «Da decidere».");
  assert.equal(proposedToast(0), ACTIVITY_MAPPING_TEXT.nothingProposed);
});

const GENERATED = {
  title: "Riconciliazione fatture",
  description: "Le fatture si confrontano a mano",
  businessCase: "Meno errori",
  impactEconomic: 4,
  impactTime: 5,
  impactQuality: 3,
  impactCoordination: 2,
  impactSocial: 1,
  feasibilityData: 4,
  feasibilityWorkflow: 4,
  feasibilityRisk: 3,
  feasibilityTech: 3,
  feasibilityTeam: 2,
  esgEnvironmental: 2,
  esgSocial: 3,
  esgGovernance: 4,
  requirements: ["Accesso al gestionale"],
  dataDependencies: ["Fatture 2025"],
  relatedActivityIds: ["a-1", "a-2"],
  timeline: "3-6 mesi",
  relatedKrTitles: ["Ridurre i tempi"],
  leverType: "cost_reduction",
};

test("Activity mapping: bozze «Da costruire» dall'alto, punteggi e dettagli del generatore, mai approvate", () => {
  const [item] = activityMappingItems([GENERATED], { includeEsg: false });
  assert.deepEqual(item, {
    source: "activity_mapping",
    kind: "da_costruire",
    origin: "transformation",
    status: "draft",
    title: "Riconciliazione fatture",
    description: "Le fatture si confrontano a mano",
    businessCase: "Meno errori",
    generatorScores: {
      impactEconomic: 4,
      impactTime: 5,
      impactQuality: 3,
      impactCoordination: 2,
      impactSocial: 1,
      feasibilityData: 4,
      feasibilityWorkflow: 4,
      feasibilityRisk: 3,
      feasibilityTech: 3,
      feasibilityTeam: 2,
    },
    generatorDetails: {
      requirements: ["Accesso al gestionale"],
      dataDependencies: ["Fatture 2025"],
      relatedActivityIds: ["a-1", "a-2"],
      timeline: "3-6 mesi",
      sequenceOrder: 1,
    },
  });
  // ESG solo con ESG attivo.
  const [esg] = activityMappingItems([GENERATED], { includeEsg: true });
  assert.deepEqual(
    [esg.generatorScores?.esgEnvironmental, esg.generatorScores?.esgSocial, esg.generatorScores?.esgGovernance],
    [2, 3, 4],
  );
  assert.ok(!("esgSocial" in (item.generatorScores ?? {})));
});

test("Activity mapping: testi accorciati ai limiti, proposte senza titolo scartate, punteggi fuori scala vuoti", () => {
  const items = activityMappingItems(
    [
      null,
      "testo",
      { ...GENERATED, title: "  " },
      { ...GENERATED, title: "ab" },
      {
        ...GENERATED,
        title: "T".repeat(260),
        description: "D".repeat(5000),
        businessCase: "B".repeat(2500),
        impactTime: 9,
        impactQuality: "4",
        requirements: ["", "R".repeat(1200), 7, ...Array.from({ length: 60 }, (_, i) => `req ${i}`)],
        relatedActivityIds: Array.from({ length: 250 }, (_, i) => `a-${i}`),
        timeline: "x".repeat(300),
      },
      { ...GENERATED, title: "Seconda proposta" },
    ],
    { includeEsg: false },
  );
  assert.equal(items.length, 2);
  const [first, second] = items;
  assert.equal(first.title.length, TEXT_LIMITS.title);
  assert.equal(first.description?.length, TEXT_LIMITS.description);
  assert.equal(first.businessCase?.length, TEXT_LIMITS.businessCase);
  assert.equal(first.generatorScores?.impactTime, null);
  assert.equal(first.generatorScores?.impactQuality, null);
  assert.equal(first.generatorDetails?.requirements?.length, 50);
  assert.equal(first.generatorDetails?.requirements?.[0].length, 1000);
  assert.equal(first.generatorDetails?.relatedActivityIds?.length, 200);
  assert.equal(first.generatorDetails?.timeline?.length, 255);
  assert.equal(first.generatorDetails?.sequenceOrder, 1);
  assert.equal(second.generatorDetails?.sequenceOrder, 2, "l'ordine conta solo le proposte tenute");
  assert.deepEqual(activityMappingItems([], { includeEsg: true }), []);
});

// ─── Testi dell'area (§14.5) ─────────────────────────────────────────

test("copy-guard: nessuna parola vietata di §14.5 nei testi di Nuovo use case e Activity mapping", () => {
  const texts = [
    ...Object.values(QUICK_CREATE_TEXT),
    ...Object.values(FORM_TEXT).flatMap((value) => (typeof value === "string" ? [value] : Object.values(value))),
    ...Object.values(ACTIVITY_MAPPING_TEXT),
    ...(["da_costruire", "da_diffondere"] as const).flatMap((kind) =>
      formFields(kind, { esgEnabled: true }).flatMap((field) => [field.label, field.placeholder]),
    ),
    ...ORIGIN_OPTIONS.flatMap((option) => [option.label, option.chip]),
    ...KIND_OPTIONS.map((option) => option.label),
    formSubtitle(DEFAULT_REVIEW_TEAM_NAME),
    savedToast("XX-0031"),
    proposedToast(6),
    proposedToast(1),
  ];
  assert.ok(texts.length > 50, `${texts.length} testi`);
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
  // Il glossario (§14.1): «use case», mai «contributo».
  assert.deepEqual(texts.filter((text) => /contribut/i.test(text)), []);
});

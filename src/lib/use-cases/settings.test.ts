import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_REVIEW_TEAM_NAME } from "../review-team.ts";
import { findHubForbiddenIn } from "./copy-guard.ts";
import {
  COST_BANDS,
  COST_BANDS_LABEL_ERROR,
  COST_BANDS_LIMITS_ERROR,
  COST_BANDS_TOP_REFERENCE_ERROR,
  DEFAULT_COST_BANDS_CONFIG,
  resolveCostBands,
} from "./cost-bands.ts";
import * as settings from "./settings.ts";
import {
  CODE_PREFIX_ERROR,
  COST_LOW_BAND_ERROR,
  HIGH_IMPACT_ERROR,
  TEAM_NAME_ERROR,
  TEAM_NAME_MAX,
  VALUATION_SETTINGS_TEXT,
  codePrefixInputText,
  codePrefixNotes,
  costBandsToStore,
  costLowBandOptions,
  euroInputText,
  highImpactBelowMidError,
  midImpactAboveHighError,
  parseCodePrefix,
  parseCostLowBand,
  parseScoreThreshold,
  parseTeamName,
  parseThresholds,
  sameCostBands,
  scoreInputText,
  teamNameHelp,
  thresholdsInputTexts,
  thresholdsTextsChanged,
} from "./settings.ts";

// Impostazioni › Valutazione (docs/use-case/DESIGN.md §7.2, §10.6, §14.2, §14.3; PIANO-LAVORI
// H3d). Il nome predefinito del team si confronta sempre con la costante, mai con il suo valore.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const source = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");

// ─── Nome del team (D2, §14.2) ───────────────────────────────────────

test("l'aiuto del nome interpola la costante: «Se lo lasci vuoto: {DEFAULT_REVIEW_TEAM_NAME}.»", () => {
  assert.equal(teamNameHelp(), `Compare nei messaggi di Slack, nelle email e nel modulo. Se lo lasci vuoto: ${DEFAULT_REVIEW_TEAM_NAME}.`);
  assert.ok(teamNameHelp().endsWith(`: ${DEFAULT_REVIEW_TEAM_NAME}.`));
});

/** I sorgenti di Impostazioni › Valutazione (test esclusi) e il modulo del nome di oggi. */
function settingsSources(): string[] {
  const inDir = (dir: string, keep: (name: string) => boolean) =>
    existsSync(`${ROOT}${dir}`)
      ? readdirSync(`${ROOT}${dir}`)
          .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && keep(name))
          .map((name) => `${dir}/${name}`)
      : [];
  return [
    ...inDir("src/lib/use-cases", (name) => name.startsWith("settings")),
    ...inDir("src/components/use-cases/settings", () => true),
    ...inDir("src/lib/actions", (name) => name === "use-case-settings.ts"),
    "src/components/portfolio/team-settings-form.tsx",
  ];
}

test("il valore del nome predefinito non è scritto a mano nei file di Impostazioni › Valutazione né nel segnaposto", () => {
  const files = settingsSources();
  assert.ok(files.includes("src/lib/use-cases/settings.ts"));
  for (const file of files) assert.ok(!source(file).includes(DEFAULT_REVIEW_TEAM_NAME), `${file} non ripete il nome predefinito`);
  assert.ok(source("src/lib/use-cases/settings.ts").includes("${DEFAULT_REVIEW_TEAM_NAME}"), "l'aiuto usa la costante");
  assert.ok(!VALUATION_SETTINGS_TEXT.teamName.placeholder.includes(DEFAULT_REVIEW_TEAM_NAME));
});

test("i testi di §14.3 sono esatti", () => {
  const t = VALUATION_SETTINGS_TEXT;
  assert.equal(t.section, "Valutazione");
  assert.equal(t.teamName.label, "Nome del team che valuta");
  assert.equal(t.teamName.placeholder, "es. CoE AI, Digital Factory…");
  assert.equal(t.codes.title, "Codici degli use case");
  assert.equal(t.codes.label, "Prefisso");
  assert.equal(t.codes.help, "I codici già assegnati non cambiano. I nuovi useranno il nuovo prefisso.");
  assert.equal(t.codes.connector, "Chi usa Claude vedrà codici con due prefissi diversi.");
  assert.equal(t.thresholds.highImpact, "Valore alto da");
  assert.equal(t.thresholds.costLowBand, "Costo basso fino alla fascia");
  assert.equal(t.thresholds.help, "Decidono le zone: Subito, Da pianificare, Se avanza tempo, Non ora.");
  assert.equal(t.costBands.title, "Fasce del costo");
  assert.equal(t.costBands.help, "Valgono per tutto il workspace: matrice, totali, export e Claude.");
  assert.equal(t.costBands.limit, "Fino a");
  assert.equal(t.costBands.label, "Etichetta");
  assert.equal(t.costBands.topReference, "Valore nei totali");
  assert.equal(
    t.costBands.warning,
    "I costi già salvati non cambiano. Gli importi restano e trovano la loro nuova fascia. Le fasce già scelte restano la stessa fascia (per esempio la seconda) e si leggono con la nuova etichetta.",
  );
  assert.equal(t.costBands.reset, "Ripristina le fasce predefinite");
  assert.equal(t.model.title, "Modello di valutazione");
  assert.equal(t.model.midImpactTitle, "Valore medio");
  assert.equal(t.model.midImpactHelp, "Da qui il Valore è Medio, sotto è Basso. Dove parte l'Alto lo decidi in «Soglie».");
  assert.ok(t.model.midImpactHelp.includes(`«${t.thresholds.title}»`), "rimanda al blocco delle soglie della sezione");
  assert.doesNotMatch(t.model.midImpactHelp, /zon/i, "le zone le spiegano solo le «Soglie» della sezione");
  // Gli errori delle fasce sono quelli di `cost-bands.ts`, gli stessi dell'action.
  assert.equal(COST_BANDS_LIMITS_ERROR, "I confini devono crescere da una fascia all'altra.");
  assert.equal(COST_BANDS_TOP_REFERENCE_ERROR, "Il valore nei totali della quinta fascia deve superare il quarto confine.");
  assert.equal(COST_BANDS_LABEL_ERROR, "Scrivi un'etichetta di massimo 40 caratteri.");
});

test("nome del team: spazi tolti, vuoto è null, al massimo 80 caratteri", () => {
  assert.deepEqual(parseTeamName("  CoE AI  "), { ok: true, value: "CoE AI" });
  assert.deepEqual(parseTeamName("Digital\n\tFactory"), { ok: true, value: "Digital Factory" });
  for (const blank of ["", "   ", "\n", null, undefined]) assert.deepEqual(parseTeamName(blank), { ok: true, value: null }, JSON.stringify(blank));
  assert.deepEqual(parseTeamName("x".repeat(TEAM_NAME_MAX)), { ok: true, value: "x".repeat(TEAM_NAME_MAX) });
  assert.deepEqual(parseTeamName("x".repeat(TEAM_NAME_MAX + 1)), { ok: false, error: TEAM_NAME_ERROR });
  assert.deepEqual(parseTeamName(42), { ok: false, error: TEAM_NAME_ERROR });
  assert.equal(TEAM_NAME_ERROR, "Scrivi un nome di massimo 80 caratteri.");
  // I caratteri di controllo diventano uno spazio: nel database non entrano.
  assert.deepEqual(parseTeamName("CoE\u0000AI"), { ok: true, value: "CoE AI" });
});

// ─── Prefisso (D6, §10.6) ────────────────────────────────────────────

test("prefisso: da 2 a 4 lettere maiuscole, le minuscole si alzano", () => {
  for (const [raw, value] of [
    ["XX", "XX"],
    ["abc", "ABC"],
    [" acme ", "ACME"],
    ["Ab", "AB"],
  ] as const) {
    assert.deepEqual(parseCodePrefix(raw), { ok: true, value }, raw);
  }
  for (const raw of ["A", "ABCDE", "A1", "ÀB", "A-B", "", 12, null]) {
    assert.deepEqual(parseCodePrefix(raw), { ok: false, error: CODE_PREFIX_ERROR }, String(raw));
  }
  assert.equal(codePrefixInputText(" x y "), "XY");
});

test("prefisso: l'avviso dei codici sempre, quello dei due prefissi solo con il connettore acceso", () => {
  assert.deepEqual(codePrefixNotes(false), [VALUATION_SETTINGS_TEXT.codes.help]);
  assert.deepEqual(codePrefixNotes(true), [VALUATION_SETTINGS_TEXT.codes.help, VALUATION_SETTINGS_TEXT.codes.connector]);
});

// ─── Soglie ──────────────────────────────────────────────────────────

test("soglie: «Valore alto da» da 0 a 5, anche con la virgola; «Costo basso fino alla fascia» 1-4 (D18)", () => {
  assert.equal(parseScoreThreshold("3,5"), 3.5);
  assert.equal(parseScoreThreshold("3.75"), 3.75);
  assert.equal(parseScoreThreshold("5"), 5);
  assert.equal(parseScoreThreshold(4.2), 4.2);
  for (const raw of ["5,1", "-1", "6", "3,555", "tre", "", null]) assert.equal(parseScoreThreshold(raw), null, String(raw));

  assert.deepEqual(parseThresholds({ highImpact: "3,5", costLowBand: "1" }, { midImpact: 2.5 }), {
    ok: true,
    value: { highImpact: 3.5, costLowBand: 1 },
  });
  assert.deepEqual(parseThresholds({ highImpact: 4, costLowBand: 3 }, { midImpact: 2.5 }), { ok: true, value: { highImpact: 4, costLowBand: 3 } });

  // La quinta fascia è aperta: «costo basso» fino lì vorrebbe dire tutto.
  for (const raw of ["5", 5, "0", 0, "1,5", 2.5, "25.000", "", null, undefined]) assert.equal(parseCostLowBand(raw), null, String(raw));
  for (const raw of ["1", "2", " 3 ", 4]) assert.ok(parseCostLowBand(raw) !== null, String(raw));
  const bad = parseThresholds({ highImpact: "6", costLowBand: "5" }, { midImpact: 2.5 });
  assert.deepEqual(bad, { ok: false, fieldErrors: { highImpact: HIGH_IMPACT_ERROR, costLowBand: COST_LOW_BAND_ERROR } });
  const empty = parseThresholds({ highImpact: "3", costLowBand: "" }, { midImpact: 2.5 });
  assert.deepEqual(empty, { ok: false, fieldErrors: { costLowBand: COST_LOW_BAND_ERROR } }, "il costo basso serve");
  // La soglia in euro di prima non vale più come ingresso.
  assert.equal(parseThresholds({ highImpact: "3", costLowMaxEur: "25.000" }, { midImpact: 2.5 }).ok, false);
  assert.deepEqual(parseThresholds(null, { midImpact: 2.5 }).ok, false);
});

test("soglie: le scelte del costo basso sono le fasce 1-4 del workspace, con simbolo ed etichetta", () => {
  assert.deepEqual(costLowBandOptions(COST_BANDS), [
    { value: "1", label: "€ · Fino a 25.000 €" },
    { value: "2", label: "€€ · Da 25.000 a 65.000 €" },
    { value: "3", label: "€€€ · Da 65.000 a 130.000 €" },
    { value: "4", label: "€€€€ · Da 130.000 a 250.000 €" },
  ]);
  const custom = resolveCostBands({ costBands: { limits: [15_000, 40_000, 100_000, 200_000], labels: ["Piccolo", "Medio", "Grande", "Molto grande", "Enorme"], topReferenceEur: 300_000 } });
  assert.deepEqual(costLowBandOptions(custom).map((o) => o.label), ["€ · Piccolo", "€€ · Medio", "€€€ · Grande", "€€€€ · Molto grande"]);
});

test("soglie: «Valore alto da» non scende sotto la soglia del valore medio", () => {
  assert.deepEqual(parseThresholds({ highImpact: "2", costLowBand: "1" }, { midImpact: 2.5 }), {
    ok: false,
    fieldErrors: { highImpact: highImpactBelowMidError(2.5) },
  });
  assert.equal(highImpactBelowMidError(2.5), "Scrivi almeno 2,5: da lì parte il valore medio.");
  assert.equal(parseThresholds({ highImpact: "2,5", costLowBand: "1" }, { midImpact: 2.5 }).ok, true, "uguale al medio va bene");
});

test("modello in Impostazioni: «Valore medio da» non supera «Valore alto da», e l'errore dice dove si cambia", () => {
  assert.equal(midImpactAboveHighError(3.5), "Scrivi al massimo 3,5: da lì parte il valore alto, che cambi in «Soglie».");
  assert.equal(midImpactAboveHighError(4), "Scrivi al massimo 4: da lì parte il valore alto, che cambi in «Soglie».");
  assert.ok(midImpactAboveHighError(3.5).includes(`«${VALUATION_SETTINGS_TEXT.thresholds.title}»`), "il titolo del blocco delle soglie");
  assert.doesNotMatch(midImpactAboveHighError(3.5), /Impact|High|Mid/);
});

test("soglie: i testi dei campi come si scrivono", () => {
  assert.equal(scoreInputText(3.5), "3,5");
  assert.equal(scoreInputText(4), "4");
  assert.equal(scoreInputText(2.25), "2,25");
  assert.equal(euroInputText(25_000), "25.000");
  assert.equal(euroInputText(400_000), "400.000");
  assert.equal(euroInputText(950), "950");
  assert.equal(euroInputText(Number.NaN), "");
  assert.deepEqual(thresholdsInputTexts({ highImpact: 3.5, costLowBand: 1 }), { highImpact: "3,5", costLowBand: "1" });
});

test("soglie: «Modificato» alla precisione dei campi; una soglia salvata con più decimali non parte modificata e «Annulla» la pulisce", () => {
  // Il pannello di oggi può salvare 3,333 (o 4,995): il campo mostra due decimali.
  for (const saved of [
    { highImpact: 3.333, costLowBand: 1 },
    { highImpact: 4.995, costLowBand: 2 },
    { highImpact: 3.5, costLowBand: 4 },
  ] as const) {
    const shown = thresholdsInputTexts(saved);
    assert.equal(thresholdsTextsChanged(shown, saved), false, `appena aperto: ${JSON.stringify(saved)}`);
    // «Annulla» rimette i testi delle soglie salvate: di nuovo non modificate.
    assert.equal(thresholdsTextsChanged(thresholdsInputTexts(saved), saved), false, `dopo Annulla: ${JSON.stringify(saved)}`);
  }
  const saved = { highImpact: 3.5, costLowBand: 1 } as const;
  // Lo stesso valore scritto in un altro modo non è una modifica.
  assert.equal(thresholdsTextsChanged({ highImpact: "3,50", costLowBand: "1" }, saved), false);
  assert.equal(thresholdsTextsChanged({ highImpact: " 3.5 ", costLowBand: " 1 " }, saved), false);
  // Un valore diverso, un campo vuoto o un testo che non si legge sì.
  assert.equal(thresholdsTextsChanged({ highImpact: "3,51", costLowBand: "1" }, saved), true);
  assert.equal(thresholdsTextsChanged({ highImpact: "3,5", costLowBand: "2" }, saved), true);
  assert.equal(thresholdsTextsChanged({ highImpact: "", costLowBand: "1" }, saved), true);
  assert.equal(thresholdsTextsChanged({ highImpact: "3,5", costLowBand: "" }, saved), true);
  assert.equal(thresholdsTextsChanged({ highImpact: "tre", costLowBand: "1" }, saved), true);
  // Il campo usa questo confronto, non i valori salvati grezzi.
  const field = source("src/components/use-cases/settings/thresholds-field.tsx");
  assert.match(field, /const dirty = thresholdsTextsChanged\(texts, saved\);/);
  assert.doesNotMatch(field, /!== saved\.highImpact|!== saved\.costLowBand/);
});

// ─── Fasce (D15) ─────────────────────────────────────────────────────

test("fasce: quelle uguali alle predefinite non si salvano (la chiave si toglie)", () => {
  const defaults = { limits: [...DEFAULT_COST_BANDS_CONFIG.limits], labels: [...DEFAULT_COST_BANDS_CONFIG.labels], topReferenceEur: 400_000 };
  assert.equal(costBandsToStore(defaults), null);
  const custom = { ...defaults, limits: [15_000, 40_000, 130_000, 250_000] };
  assert.deepEqual(costBandsToStore(custom), custom);
  assert.equal(sameCostBands(defaults, custom), false);
  assert.equal(sameCostBands(defaults, { ...defaults, labels: [...defaults.labels.slice(0, 4), "Oltre"] }), false);
  assert.equal(sameCostBands(defaults, { ...defaults, topReferenceEur: 500_000 }), false);
  assert.equal(sameCostBands(defaults, { ...defaults }), true);
});

test("id ben formati: solo un UUID arriva al database", () => {
  assert.equal(settings.isUuidText("3f2a9c1e-0000-4000-8000-0000000000f1"), true);
  assert.equal(settings.isUuidText("3F2A9C1E-0000-4000-8000-0000000000F1"), true);
  for (const bad of ["", "non-un-id", "3f2a9c1e-0000-4000-8000-0000000000f1 ", "3f2a9c1e00004000800000000000000f1", null, 42]) {
    assert.equal(settings.isUuidText(bad), false, String(bad));
  }
});

// ─── Testi dell'area (§14.5) e nomi (D16) ────────────────────────────

function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(stringsOf);
}

test("copy-guard verde sui testi di Impostazioni › Valutazione", () => {
  const texts = [
    ...stringsOf(Object.values(settings).filter((v) => typeof v !== "function")),
    teamNameHelp(),
    highImpactBelowMidError(2.5),
    midImpactAboveHighError(3.5),
    settings.proposedLabelAction("Da 25.000 a 65.000 €"),
    settings.bandFieldName("Fino a", "€€"),
  ];
  assert.ok(texts.length > 30, `${texts.length} testi`);
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
});

test("nessuna funzione esportata si chiama `use` più una maiuscola (D16)", () => {
  for (const name of Object.keys(settings)) assert.doesNotMatch(name, /^use[A-Z]/, name);
});

// ─── I due moduli di oggi (§14.3, §14.5) ─────────────────────────────

test("modulo del modello: zone in italiano e pagina Use case al posto del vecchio nome", () => {
  const form = source("src/components/portfolio/scoring-model-form.tsx");
  assert.ok(form.includes("visibili nella pagina Use case"), "testo di §14.5");
  assert.doesNotMatch(form, /Raccolta\s*(&|e)\s*Ranking/i);
  assert.ok(/Determinano le zone: Subito, Da pianificare, Se avanza tempo,\s+Non ora\./.test(form), "zone in italiano");
  for (const english of ["Quick Win", "Strategic Bet", "Capability", "Not Yet", "High Impact", "Mid Impact", "High Feasibility", "quadrant"]) {
    assert.ok(!form.includes(english), `niente «${english}»`);
  }
});

test("modulo del modello in Impostazioni: un solo «Valore alto da» (nelle Soglie), niente «Fattibilità alta da», un solo nome per il punteggio", () => {
  const form = source("src/components/portfolio/scoring-model-form.tsx");
  assert.match(
    form,
    /\{!inSettings && \(\s*<>\s*<LabeledNumber\s+label="Valore alto da"[\s\S]*?<LabeledNumber\s+label="Fattibilità alta da"[\s\S]*?<\/>\s*\)\}/,
    "«Valore alto da» e «Fattibilità alta da» solo nel pannello",
  );
  assert.equal(form.match(/label="Fattibilità alta da"/g)?.length, 1);
  assert.match(form, /inSettings \? MODEL_TEXT\.midImpactTitle : "Soglie della matrice \(0-5\)"/, "il blocco si chiama per quello che fa");
  assert.match(form, /inSettings\s*\?\s*MODEL_TEXT\.midImpactHelp\s*:\s*"Determinano le zone:/, "l'aiuto della sezione al posto della frase sulle zone");
  assert.match(form, /inSettings \? MODEL_TEXT\.advancedHint : "pesi globali e soglie matrice"/);
  // In Impostazioni parte solo «Valore medio da»: le altre due soglie le aggiunge l'action, quelle salvate.
  assert.match(form, /thresholds: \{ midImpact: thresholds\.midImpact \}/);
  assert.doesNotMatch(form, /highImpact: savedHighImpact/);
  assert.match(form, /inSettings \? saveValuationModelAction : updateScoringModelAction/);
  assert.match(form, /name="payload" value=\{sentPayload\}/);
  // «Valore medio da» sopra «Valore alto da»: l'errore in italiano, e il salvataggio non parte.
  assert.match(form, /midImpactAboveHighError\(savedHighImpact\)/);
  assert.match(form, /if \(midAboveHigh\) \{\s*event\.preventDefault\(\);/);
  assert.match(form, /error=\{midImpactError\}/);
  // La dimensione d'impatto si chiama «Valore» (§14.1) in testata, anteprima e pesi globali.
  assert.match(form, /settingsPlacement \? MODEL_TEXT\.valueDimension : dimLabels\.impact/);
  assert.equal(form.match(/\{impactLabel\}/g)?.length, 3, "titolo della dimensione, peso globale, anteprima");
  assert.equal(VALUATION_SETTINGS_TEXT.model.valueDimension, "Valore");
  for (const text of [VALUATION_SETTINGS_TEXT.model.hint, VALUATION_SETTINGS_TEXT.model.advancedHint, VALUATION_SETTINGS_TEXT.model.midImpactTitle, VALUATION_SETTINGS_TEXT.model.midImpactHelp]) {
    assert.doesNotMatch(text, /matrice|Impatto|Fattibilità/, text);
  }
  const section = source("src/components/use-cases/settings/valuation-settings.tsx");
  assert.match(section, /<ScoringModelForm[^>]*\binSettings\s*\/>/);
  // Il modulo del modello non si rimonta quando cambiano le soglie: niente perdita delle sue modifiche.
  assert.doesNotMatch(section, /<ScoringModelForm\s+key=/);
  // L'action rilegge le soglie salvate e poi salva con l'action del modello.
  const actions = source("src/lib/actions/use-case-settings.ts");
  assert.match(actions, /prepareSettingsModelPayload\(session\.user\.id, workspaceId, formData\.get\("payload"\)\)/);
  assert.match(actions, /await updateScoringModelAction\(workspaceId, previous, form\)/);
});

/**
 * I testi visibili di un sorgente: stringhe tra virgolette o apici inversi e testo JSX, senza i
 * commenti. Basta a trovare una parola nei testi; non è un parser.
 */
function visibleTexts(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const literals = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? "");
  const jsx = [...code.matchAll(/>([^<>{}]*\p{L}[^<>{}]*)</gu)].map((m) => m[1]);
  return [...literals, ...jsx];
}

/** Le parole che il glossario (§14.1) non vuole nell'area e che il pannello di oggi usa ancora. */
const PANEL_WORDS = /contribut|ranking|scorecard/i;

test("modulo del modello in Impostazioni: «use case», non «contributo»; niente «ranking» né «Scorecard»", () => {
  const model = VALUATION_SETTINGS_TEXT.model;
  for (const text of stringsOf(model)) {
    assert.doesNotMatch(text, PANEL_WORDS, text);
    assert.doesNotMatch(text, /\bImpatto\b/, text);
  }
  assert.equal(model.valueHelp, "I criteri che definiscono il valore generato dallo use case.");
  assert.equal(model.feasibilityHelp, "Quanto è semplice o complesso portare lo use case in produzione.");
  assert.equal(model.previewTitle, "KPI della valutazione");
  assert.match(model.previewNote, /tutti gli use case\.$/);
  assert.equal(model.direction, "Direzione");
  assert.match(model.confirm, /^Salvare il modello di valutazione\? Vale per tutto il workspace:/);
  assert.equal(model.saved, "Modello salvato.");
  assert.match(model.savedHint, /ricalibrare gli use case con AI\.$/);

  const form = source("src/components/portfolio/scoring-model-form.tsx");
  // Un insieme di testi per posto: quelli di Impostazioni vengono tutti da `VALUATION_SETTINGS_TEXT.model`.
  assert.match(form, /const copy = settingsPlacement \? SETTINGS_COPY : PANEL_COPY;/);
  const settingsCopy = form.slice(form.indexOf("const SETTINGS_COPY"), form.indexOf("};", form.indexOf("const SETTINGS_COPY")));
  assert.ok(settingsCopy.length > 0, "il blocco SETTINGS_COPY");
  assert.deepEqual(visibleTexts(settingsCopy), [], "nessun testo scritto nel blocco: solo MODEL_TEXT");
  for (const key of ["valueHelp", "feasibilityHelp", "previewTitle", "previewNote", "direction", "confirm", "savedHint"]) {
    assert.ok(settingsCopy.includes(`${key}: MODEL_TEXT.${key},`), key);
  }
  assert.match(settingsCopy, /previewEyebrow: null,/, "niente «Scorecard attiva» sopra l'anteprima");
  // Le parole del pannello stanno solo nel suo blocco: fuori, nessun testo visibile le usa.
  const panelStart = form.indexOf("const PANEL_COPY");
  const panelEnd = form.indexOf("};", panelStart) + 2;
  assert.ok(panelStart > 0, "il blocco PANEL_COPY");
  const outside = form.slice(0, panelStart) + form.slice(panelEnd);
  assert.deepEqual(visibleTexts(outside).filter((text) => PANEL_WORDS.test(text)), []);
  // Ogni punto del modulo prende il testo dal suo posto.
  assert.match(form, /help=\{copy\.valueHelp\}/);
  assert.match(form, /help=\{copy\.feasibilityHelp\}/);
  assert.equal(form.match(/directionLabel=\{copy\.direction\}/g)?.length, 3, "le tre dimensioni");
  assert.match(form, /window\.confirm\(copy\.confirm\)/);
  assert.match(form, /copy=\{copy\}/);
  assert.match(form, /\{copy\.previewEyebrow && \(/);
  // Il salvataggio riuscito si riconosce dall'esito, non dal messaggio (le due action hanno testi diversi).
  assert.match(form, /if \(state === INITIAL \|\| !state\.ok\) return;/);
  assert.doesNotMatch(form, /state\.message\s*[!=]==/);
  assert.match(form, /message: copy\.savedHint/);
  // L'action di qui: «Modello salvato.» e «Valore» nell'errore della dimensione senza KPI.
  const actions = source("src/lib/actions/use-case-settings.ts");
  assert.match(actions, /return settingsModelState\(result\);/);
  assert.match(actions, /message: VALUATION_SETTINGS_TEXT\.model\.saved/);
  assert.match(actions, /fieldErrors\["dimensions\.impact"\] = VALUATION_SETTINGS_TEXT\.model\.valueKpiRequired/);
  // L'errore che si sostituisce è proprio quello di `updateScoringModelAction`.
  const impactRequired = actions.match(/const IMPACT_KPI_REQUIRED = ("[^"]+");/)?.[1];
  assert.ok(impactRequired, "IMPACT_KPI_REQUIRED");
  assert.ok(source("src/lib/actions/portfolio.ts").includes(`.min(1, ${impactRequired})`), "lo stesso testo di portfolio.ts");
});

test("modulo del modello: ESG si accende in «Criteri ESG» di Impostazioni › Valutazione, senza gergo", () => {
  const form = source("src/components/portfolio/scoring-model-form.tsx");
  const esg = form.slice(form.indexOf("const ESG_SECTION"), form.indexOf("function genId"));
  assert.ok(esg.includes('"«Criteri ESG»"'), "la sezione dell'interruttore");
  assert.ok(esg.includes("Impostazioni › Valutazione, ${ESG_SECTION}"), "nel pannello: dove sta la sezione");
  assert.ok(esg.includes("${ESG_SECTION}, in questa pagina"), "in Impostazioni: la stessa pagina");
  for (const use of ["ESG_TEXT.off(settingsPlacement)", "ESG_TEXT.previewOff", "ESG_TEXT.previewEmpty"]) assert.ok(form.includes(use), use);
  // Il vecchio rimando a Integrazioni, e il gergo, in nessun testo del modulo.
  for (const word of [/Integrazioni/, /\bOFF\b/, /\bON\b/, /editare/i, /disattivato a livello/]) {
    assert.doesNotMatch(form, word, String(word));
  }
});

test("Impostazioni › Valutazione segue l'area (§12.1): la sezione, le action e le scritture controllano l'interruttore", () => {
  const section = source("src/components/use-cases/settings/valuation-settings.tsx");
  assert.match(section, /if \(!isUseCaseHubWorkspace\(workspaceId\)\) return null;/);
  const actions = source("src/lib/actions/use-case-settings.ts");
  assert.equal(actions.match(/if \(!isUseCaseHubWorkspace\(workspaceId\)\) return AREA_OFF;/g)?.length, 5, "le cinque action delle impostazioni (con «Ipotesi di calcolo»)");
  assert.match(actions, /if \(!isUseCaseHubWorkspace\(workspaceId\)\) return refusedState\(AREA_OFF\);/, "e quella del modello");
  assert.match(source("src/lib/use-cases/settings-data.ts"), /if \(!isUseCaseHubWorkspace\(workspaceId\)\) return areaOff\(\);/);
});

test("modulo del nome di oggi: segnaposto «es. CoE AI, Digital Factory…»", () => {
  const form = source("src/components/portfolio/team-settings-form.tsx");
  assert.ok(form.includes('placeholder="es. CoE AI, Digital Factory…"'));
  assert.ok(!form.includes("es. AI Transformation"));
});

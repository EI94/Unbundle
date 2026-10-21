/**
 * Impostazioni › Valutazione (docs/use-case/DESIGN.md §7.2 «Fasce del workspace», §10.6,
 * §14.2, §14.3; PIANO-LAVORI H3d; decisioni D2, D6, D15): testi esatti e regole dei campi.
 *
 * - **Nome del team che valuta** (D2): `workspaces.ai_transformation_team_name`. Vuoto vale il
 *   nome predefinito: l'aiuto lo interpola dalla costante `DEFAULT_REVIEW_TEAM_NAME`
 *   (`src/lib/review-team.ts`), mai scritto a mano qui.
 * - **Prefisso dei codici** (D6, §10.6): 2-4 lettere maiuscole, il CHECK della 0019. I codici
 *   già assegnati non cambiano; con il connettore acceso c'è un avviso in più.
 * - **Soglie**: «Valore alto da» (`thresholds.highImpact`, da 0 a 5, mai sotto la soglia del
 *   valore medio) e «Costo basso fino alla fascia» (`thresholds.costLowBand`, una delle fasce
 *   1-4 del workspace, predefinita la 1: D18).
 * - **Fasce del costo** (D15): le valida `validateCostBands` di `cost-bands.ts`, la stessa
 *   nel modulo e nell'action. Le fasce uguali alle predefinite non si salvano: il workspace
 *   torna a seguire `COST_BANDS` (`costBandsToStore`).
 *
 * Chi salva (chi gestisce il workspace) e dove (`config` grezzo del modello, senza
 * `normalizeScoringConfig`, mai `scoringVersion`) lo decide `settings-data.ts`.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { DEFAULT_REVIEW_TEAM_NAME } from "../review-team.ts";
import { COST_LOW_BANDS, DEFAULT_COST_BANDS_CONFIG, isCostLowBand, type CostBandInfo, type CostBandsConfig, type CostLowBand } from "./cost-bands.ts";
import { ZONES, ZONE_LABEL } from "./labels.ts";
import { isValidCodePrefix } from "./prefix.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vero per un id di workspace o di persona ben formato: un valore arrivato da una POST non va al database senza. */
export function isUuidText(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// ─── Testi (§14.3) ───────────────────────────────────────────────────

/**
 * Aiuto del nome del team (§14.3): interpola la costante, così il valore predefinito sta
 * solo in `src/lib/review-team.ts` (§14.2).
 */
export function teamNameHelp(): string {
  return `Compare nei messaggi di Slack, nelle email e nel modulo. Se lo lasci vuoto: ${DEFAULT_REVIEW_TEAM_NAME}.`;
}

/** Le zone nell'ordine della matrice: «Subito, Da pianificare, Se avanza tempo, Non ora». */
const ZONE_NAMES = ZONES.map((zone) => ZONE_LABEL[zone]).join(", ");

/** I testi della sezione. Quelli di §14.3 sono esatti; gli altri sono pulsanti e conferme. */
export const VALUATION_SETTINGS_TEXT = Object.freeze({
  section: "Valutazione",
  sectionDescription: "Chi valuta, i codici, le soglie e le fasce del costo di questo workspace.",
  loadError: "Non riesco a leggere le impostazioni di valutazione. Ricarica la pagina tra poco.",
  saving: "Salvo…",
  cancel: "Annulla",
  denied: "Solo chi gestisce il workspace cambia le impostazioni di valutazione.",
  failed: "Non è stato possibile salvare. Riprova tra poco.",
  invalid: "Controlla i campi evidenziati.",
  teamName: Object.freeze({
    label: "Nome del team che valuta",
    placeholder: "es. CoE AI, Digital Factory…",
    save: "Salva il nome",
    saved: "Nome salvato.",
  }),
  codes: Object.freeze({
    title: "Codici degli use case",
    label: "Prefisso",
    help: "I codici già assegnati non cambiano. I nuovi useranno il nuovo prefisso.",
    connector: "Chi usa Claude vedrà codici con due prefissi diversi.",
    proposed: "Proposto dal nome del workspace: i codici partono quando lo salvi.",
    save: "Salva il prefisso",
    saved: "Prefisso salvato.",
  }),
  thresholds: Object.freeze({
    title: "Soglie",
    help: `Decidono le zone: ${ZONE_NAMES}.`,
    highImpact: "Valore alto da",
    highImpactSuffix: "su 5",
    costLowBand: "Costo basso fino alla fascia",
    save: "Salva le soglie",
    saved: "Soglie salvate.",
  }),
  costBands: Object.freeze({
    title: "Fasce del costo",
    help: "Valgono per tutto il workspace: matrice, totali, export e Claude.",
    limit: "Fino a",
    label: "Etichetta",
    topReference: "Valore nei totali",
    warning:
      "I costi già salvati non cambiano. Gli importi restano e trovano la loro nuova fascia. Le fasce già scelte restano la stessa fascia (per esempio la seconda) e si leggono con la nuova etichetta.",
    reset: "Ripristina le fasce predefinite",
    save: "Salva le fasce",
    saved: "Fasce salvate.",
  }),
  model: Object.freeze({
    title: "Modello di valutazione",
    hint: "KPI, pesi e valore medio",
    /** Il riassunto delle «Impostazioni avanzate» del modulo, qui. */
    advancedHint: "pesi globali e valore medio",
    /**
     * Il nome del punteggio della dimensione d'impatto, qui: «Valore» (§14.1), lo stesso di
     * «Valore alto da» e «Valore medio da».
     */
    valueDimension: "Valore",
    /**
     * L'unica soglia del modulo del modello, qui. Le zone le decidono le «Soglie» della sezione
     * (Valore e Costo, §7.4): «Valore alto da» sta solo lì. «Fattibilità alta da» decide solo
     * `category`, che non si mostra più (§7.4): qui non è un campo, resta quella salvata.
     */
    midImpactTitle: "Valore medio",
    midImpactHelp: "Da qui il Valore è Medio, sotto è Basso. Dove parte l'Alto lo decidi in «Soglie».",
    /*
     * Gli altri testi del modulo, qui, con le parole dell'area (§14.1): «use case», non
     * «contributo»; niente «ranking» né «Scorecard». Il pannello di oggi tiene i suoi.
     */
    valueHelp: "I criteri che definiscono il valore generato dallo use case.",
    feasibilityHelp: "Quanto è semplice o complesso portare lo use case in produzione.",
    previewTitle: "KPI della valutazione",
    previewNote: "Questi sono i parametri visibili nella pagina Use case: se li modifichi e salvi, puoi ricalibrare automaticamente tutti gli use case.",
    direction: "Direzione",
    confirm: "Salvare il modello di valutazione? Vale per tutto il workspace: il punteggio e la zona degli use case possono cambiare.",
    saved: "Modello salvato.",
    savedHint: "Se hai cambiato KPI o rubriche, ora puoi ricalibrare gli use case con AI.",
    /** L'errore di una dimensione del Valore senza KPI, con il nome di qui. */
    valueKpiRequired: "Serve almeno un KPI per il Valore.",
  }),
});

/** «Usa «Da 25.000 a 65.000 €»»: la proposta dell'etichetta quando cambia un confine (§7.2). */
export function proposedLabelAction(label: string): string {
  return `Usa «${label}»`;
}

/** Il nome accessibile di un campo di una fascia: «Fino a, fascia €€». */
export function bandFieldName(field: string, symbol: string): string {
  return `${field}, fascia ${symbol}`;
}

// ─── Nome del team (D2) ──────────────────────────────────────────────

/** Il nome del team: al massimo 80 caratteri (la colonna ne tiene 255; è un nome, non una frase). */
export const TEAM_NAME_MAX = 80;
export const TEAM_NAME_ERROR = `Scrivi un nome di massimo ${TEAM_NAME_MAX} caratteri.`;

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Il nome come si salva: spazi, a capo e caratteri di controllo diventano uno spazio solo, e
 * senza spazi ai lati. Vuoto è `null` (vale il nome predefinito, `reviewTeamName`).
 */
export function parseTeamName(raw: unknown): FieldResult<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: TEAM_NAME_ERROR };
  const text = raw.replace(/[\s\p{Cc}]+/gu, " ").trim();
  if (!text) return { ok: true, value: null };
  return [...text].length > TEAM_NAME_MAX ? { ok: false, error: TEAM_NAME_ERROR } : { ok: true, value: text };
}

// ─── Prefisso dei codici (D6, §10.6) ─────────────────────────────────

export const CODE_PREFIX_MAX = 4;
export const CODE_PREFIX_ERROR = "Scrivi da 2 a 4 lettere, senza accenti né numeri.";

/** Il testo del campo mentre si scrive: maiuscolo, senza spazi. */
export function codePrefixInputText(text: string): string {
  return text.replace(/\s+/g, "").toUpperCase();
}

/** Il prefisso come si salva: 2-4 lettere maiuscole (CHECK `^[A-Z]{2,4}$` della 0019); le minuscole si alzano. */
export function parseCodePrefix(raw: unknown): FieldResult<string> {
  if (typeof raw !== "string") return { ok: false, error: CODE_PREFIX_ERROR };
  const text = codePrefixInputText(raw);
  return isValidCodePrefix(text) ? { ok: true, value: text } : { ok: false, error: CODE_PREFIX_ERROR };
}

/** Gli avvisi del prefisso (§10.6): sempre il primo; con il connettore acceso anche il secondo. */
export function codePrefixNotes(connectorEnabled: boolean): string[] {
  const { help, connector } = VALUATION_SETTINGS_TEXT.codes;
  return connectorEnabled ? [help, connector] : [help];
}

// ─── Soglie (§7.1, §7.2, D15) ────────────────────────────────────────

export const HIGH_IMPACT_ERROR = "Scrivi un numero da 0 a 5 (es. 3,5).";

const SCORE_TEXT = /^[0-9](?:[.,][0-9]{1,2})?$/;
const SCORE_FORMAT = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

/** «3,5»: una soglia del Valore come si scrive nel campo. */
export function scoreInputText(score: number): string {
  return Number.isFinite(score) ? SCORE_FORMAT.format(score) : "";
}

/** «25.000»: un importo come si scrive nel campo, con i punti delle migliaia. */
export function euroInputText(eur: number): string {
  if (!Number.isFinite(eur)) return "";
  return String(Math.round(eur)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Il Valore alto non parte sotto il medio: altrimenti «Medio» non esisterebbe più. */
export function highImpactBelowMidError(midImpact: number): string {
  return `Scrivi almeno ${scoreInputText(midImpact)}: da lì parte il valore medio.`;
}

/**
 * «Valore medio da» non sopra «Valore alto da», che qui non è un campo del modulo del modello:
 * si cambia nelle «Soglie» della sezione.
 */
export function midImpactAboveHighError(highImpact: number): string {
  return `Scrivi al massimo ${scoreInputText(highImpact)}: da lì parte il valore alto, che cambi in «${VALUATION_SETTINGS_TEXT.thresholds.title}».`;
}

/** Una soglia del Valore: numero da 0 a 5, con al massimo due decimali, anche con la virgola («3,5»). */
export function parseScoreThreshold(raw: unknown): number | null {
  let value: number;
  if (typeof raw === "number") value = raw;
  else if (typeof raw === "string") {
    const text = raw.trim();
    if (!SCORE_TEXT.test(text)) return null;
    value = Number(text.replace(",", "."));
  } else return null;
  if (!Number.isFinite(value) || value < 0 || value > 5) return null;
  return Math.round(value * 100) / 100;
}

export interface ThresholdsValue {
  highImpact: number;
  /** «Costo basso fino alla fascia N» (D18), da 1 a 4. */
  costLowBand: CostLowBand;
}

export const COST_LOW_BAND_ERROR = "Scegli una delle prime quattro fasce.";

/** «Costo basso fino alla fascia»: 1-4, anche come testo («2»). */
export function parseCostLowBand(raw: unknown): CostLowBand | null {
  const value = typeof raw === "string" && /^[1-4]$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  return isCostLowBand(value) ? value : null;
}

/** Le scelte di «Costo basso fino alla fascia»: le fasce 1-4 del workspace, «€ · Fino a 25.000 €». */
export function costLowBandOptions(bands: readonly CostBandInfo[]): Array<{ value: string; label: string }> {
  return COST_LOW_BANDS.map((band) => {
    const info = bands[band - 1];
    return { value: String(band), label: info ? `${info.symbol} · ${info.label}` : String(band) };
  });
}

export type ThresholdsResult = { ok: true; value: ThresholdsValue } | { ok: false; fieldErrors: Record<string, string> };

/**
 * Le soglie della sezione: «Valore alto da» e «Costo basso fino alla fascia». Errori per campo
 * (`highImpact`, `costLowBand`). `midImpact` è la soglia del valore medio del modello, che
 * resta nel modulo del modello.
 */
export function parseThresholds(input: unknown, context: { midImpact: number }): ThresholdsResult {
  const data = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};
  const highImpact = parseScoreThreshold(data.highImpact);
  if (highImpact === null) fieldErrors.highImpact = HIGH_IMPACT_ERROR;
  else if (Number.isFinite(context.midImpact) && highImpact < context.midImpact) fieldErrors.highImpact = highImpactBelowMidError(context.midImpact);
  const costLowBand = parseCostLowBand(data.costLowBand);
  if (costLowBand === null) fieldErrors.costLowBand = COST_LOW_BAND_ERROR;
  if (highImpact === null || costLowBand === null || Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, value: { highImpact, costLowBand } };
}

/** I testi dei due campi delle «Soglie»: «3,5» e la fascia, «1». */
export type ThresholdsTexts = { highImpact: string; costLowBand: string };

/** Le soglie salvate come si scrivono nei campi (due decimali per il Valore, la fascia come numero). */
export function thresholdsInputTexts(value: ThresholdsValue): ThresholdsTexts {
  return { highImpact: scoreInputText(value.highImpact), costLowBand: String(value.costLowBand) };
}

/** Un campo è cambiato: valori diversi se i due testi si leggono, altrimenti testi diversi. */
function fieldChanged(text: string, savedText: string, read: (text: string) => number | null): boolean {
  const value = read(text);
  const saved = read(savedText);
  return value === null || saved === null ? text.trim() !== savedText.trim() : value !== saved;
}

/**
 * Vero se i campi dicono soglie diverse da quelle salvate, alla precisione dei campi: il testo
 * si confronta con quello delle soglie salvate, letti tutti e due allo stesso modo. Una soglia
 * salvata con più decimali (3,333 dal pannello di oggi) si mostra «3,33» e non risulta
 * modificata finché non la cambi; «Annulla» la riporta a «3,33», di nuovo non modificata.
 */
export function thresholdsTextsChanged(texts: ThresholdsTexts, saved: ThresholdsValue): boolean {
  const savedTexts = thresholdsInputTexts(saved);
  return (
    fieldChanged(texts.highImpact, savedTexts.highImpact, parseScoreThreshold) ||
    fieldChanged(texts.costLowBand, savedTexts.costLowBand, parseCostLowBand)
  );
}

// ─── Fasce del costo (D15) ───────────────────────────────────────────

/** Vero se due configurazioni delle fasce sono uguali (confini, etichette, valore della quinta). */
export function sameCostBands(a: CostBandsConfig, b: CostBandsConfig): boolean {
  return (
    a.topReferenceEur === b.topReferenceEur &&
    a.limits.length === b.limits.length &&
    a.limits.every((limit, i) => limit === b.limits[i]) &&
    a.labels.length === b.labels.length &&
    a.labels.every((label, i) => label === b.labels[i])
  );
}

/**
 * Cosa va in `config.costBands`: la configurazione validata, oppure `null` se è uguale alle
 * fasce predefinite (la chiave si toglie e il workspace torna a `COST_BANDS`, anche se un
 * giorno cambiano).
 */
export function costBandsToStore(config: CostBandsConfig): CostBandsConfig | null {
  return sameCostBands(config, DEFAULT_COST_BANDS_CONFIG) ? null : config;
}

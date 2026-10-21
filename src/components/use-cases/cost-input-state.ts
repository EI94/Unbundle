/**
 * La logica del campo «Costo di realizzazione» (docs/use-case/DESIGN.md §5.4, D5, D15;
 * PIANO-LAVORI H2d), fuori dal componente `cost-input.tsx` perché la provi `node --test`.
 *
 * - **Due modi**, mai insieme: l'importo una tantum (il primo) oppure una delle 5 fasce del
 *   workspace. Il valore che il campo manda è `{ eurOnce }`, `{ band }` oppure nessun costo:
 *   mai importo e fascia insieme (CHECK della 0020).
 * - **Fasce del workspace** (D15): le 5 etichette vengono da `bands` (tipo `CostBandInfo` di
 *   `cost-bands.ts`, predefinite `COST_BANDS`). Si salva sempre l'indice della fascia (1-5),
 *   mai l'etichetta né i confini: se il workspace cambia le fasce, la scelta resta la stessa
 *   fascia e si legge con la nuova etichetta (§7.2).
 * - **Importo**: intero da 0 a 100.000.000, con i punti delle migliaia («40.000»); lo legge
 *   `parseEuroAmount` di `inputs.ts`, lo stesso del servizio. Errore: «Scrivi un importo in
 *   euro, senza decimali (es. 40000).».
 * - **Da importo a fascia e ritorno**: passando alla fascia con un importo valido, la fascia
 *   di quell'importo è già scelta (nelle fasce del workspace); tornando all'importo, il testo
 *   scritto resta. Un importo scritto sostituisce la fascia; il campo importo vuoto no: la
 *   fascia scelta (o salvata) resta, perché «nessun costo» è solo campo vuoto **e** nessuna
 *   fascia (§5.4). Il costo si toglie solo con «Togli il costo», che allora si vede.
 * - **Nel modulo**: il componente scrive il valore in un solo campo nascosto
 *   (`costFormValue`), che l'action legge con `readCostFormValue`: vuoto è «nessun costo»,
 *   altrimenti `{"eurOnce":40000}` oppure `{"band":2}`. Un importo non valido arriva com'è
 *   scritto e l'action lo rifiuta con lo stesso messaggio del campo.
 *
 * Modulo puro: solo import relativi `.ts`, nessun `@/`.
 */
import { COST_BANDS, bandForAmount, costBandInfo, isCostBand, type CostBandInfo } from "../../lib/use-cases/cost-bands.ts";
import { COST_AMOUNT_ERROR, COST_EUR_ONCE_MAX, parseCostInput, parseEuroAmount } from "../../lib/use-cases/inputs.ts";
import type { CostBand, CostInput } from "../../lib/use-cases/types.ts";

/** I testi esatti del campo (§5.4). */
export const COST_INPUT_TEXT = Object.freeze({
  label: "Costo di realizzazione (una tantum)",
  amountHelp: "Quanto costa costruirlo, una volta sola. Non contare i costi annui.",
  amountPlaceholder: "es. 40000",
  amountSuffix: "€",
  toBand: "Non sai l'importo? Scegli una fascia",
  bandHelp: "Scegli la fascia più vicina.",
  toAmount: "Ho un importo preciso",
  clear: "Togli il costo",
  amountError: COST_AMOUNT_ERROR,
});

/** Il nome predefinito del campo nascosto nel modulo. */
export const COST_FIELD_NAME = "cost";

export type CostInputMode = "importo" | "fascia";

export interface CostInputState {
  mode: CostInputMode;
  /** Il testo del campo importo, com'è scritto. Resta anche in modo fascia. */
  amountText: string;
  /** La fascia scelta (1-5), anche in modo importo; `null` se nessuna. */
  band: CostBand | null;
}

/**
 * Le chiavi di `CostFigure` (`valuation.ts`), la cifra che le pagine hanno già per mostrare il
 * costo: non è il costo del team (può venire dal dossier o dallo sforzo, e la sua `band` è
 * derivata anche da un importo), quindi non può essere il punto di partenza del campo.
 */
type NotACostFigure = { amount?: never; fromBand?: never; referenceEur?: never; position?: never; bandLabel?: never };

/**
 * Il costo salvato della scheda: le sue colonne (`cost_eur_once`, `cost_band`) oppure un
 * `CostInput`. Solo le colonne del team (§5.4, §7.2): una `CostFigure` non passa, né per il
 * tipo né a runtime.
 */
export type SavedCost =
  | ({ costEurOnce?: number | null; costBand?: number | null } & NotACostFigure)
  | ({ eurOnce: number; band?: never } & NotACostFigure)
  | ({ band: number; eurOnce?: never } & NotACostFigure);

export type CostValueResult = { ok: true; value: CostInput } | { ok: false; message: string };

/**
 * Il testo del campo importo: vuoto vuol dire nessun importo (`null`); «40.000» e «40000»
 * valgono 40.000; decimali, segni, testo o importi oltre 100.000.000 danno l'errore di §5.4.
 */
export function parseEuroInput(text: string): { ok: true; value: number | null } | { ok: false; message: string } {
  const parsed = parseEuroAmount(text, COST_EUR_ONCE_MAX);
  return parsed.ok ? parsed : { ok: false, message: COST_AMOUNT_ERROR };
}

/** Una `CostFigure` passata lo stesso (es. da JavaScript o con un cast): la si ignora. */
function isCostFigureLike(saved: object): boolean {
  return "fromBand" in saved || "referenceEur" in saved;
}

function savedAmount(saved: SavedCost): number | null {
  if (isCostFigureLike(saved)) return null;
  const raw = "eurOnce" in saved ? saved.eurOnce : "costEurOnce" in saved ? saved.costEurOnce : null;
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

function savedBand(saved: SavedCost): CostBand | null {
  if (isCostFigureLike(saved)) return null;
  const raw = "band" in saved ? saved.band : "costBand" in saved ? saved.costBand : null;
  return isCostBand(raw) ? raw : null;
}

/**
 * Lo stato di partenza: con un importo salvato si parte dall'importo, con una fascia salvata
 * dalla fascia, senza costo dall'importo vuoto. Con tutti e due (non succede: lo vieta il
 * CHECK) vince l'importo, come nella scala di §7.2.
 */
export function initialCostInputState(saved?: SavedCost | null): CostInputState {
  const amount = saved ? savedAmount(saved) : null;
  const band = saved ? savedBand(saved) : null;
  if (amount !== null) return { mode: "importo", amountText: String(amount), band: null };
  if (band !== null) return { mode: "fascia", amountText: "", band };
  return { mode: "importo", amountText: "", band: null };
}

/** Il testo dell'importo cambia. */
export function setAmountText(state: CostInputState, amountText: string): CostInputState {
  return { ...state, mode: "importo", amountText };
}

/** Una fascia scelta nel gruppo. Un valore che non è una fascia (1-5) non cambia nulla. */
export function chooseBand(state: CostInputState, band: unknown): CostInputState {
  const value = typeof band === "string" && /^[1-5]$/.test(band.trim()) ? Number(band.trim()) : band;
  return isCostBand(value) ? { ...state, mode: "fascia", band: value } : state;
}

/**
 * «Non sai l'importo? Scegli una fascia». Con un importo valido la sua fascia nelle fasce
 * del workspace è già scelta; altrimenti resta la fascia scelta prima, se c'è.
 */
export function switchToBand(state: CostInputState, bands: readonly CostBandInfo[] = COST_BANDS): CostInputState {
  const amount = parseEuroInput(state.amountText);
  const band = amount.ok && amount.value !== null ? bandForAmount(amount.value, bands) : state.band;
  return { ...state, mode: "fascia", band };
}

/** «Ho un importo preciso»: si torna all'importo, con il testo scritto prima. */
export function switchToAmount(state: CostInputState): CostInputState {
  return { ...state, mode: "importo" };
}

/** «Togli il costo»: importo vuoto e nessuna fascia, nello stesso modo. */
export function clearCost(state: CostInputState): CostInputState {
  return { mode: state.mode, amountText: "", band: null };
}

/**
 * C'è un costo da togliere? Il link «Togli il costo» compare solo allora: in modo fascia con
 * una fascia scelta; in modo importo con un importo scritto oppure con la fascia che resta
 * sotto il campo vuoto (quella che `costInputValue` salverebbe).
 */
export function hasCostValue(state: CostInputState): boolean {
  if (state.mode === "fascia") return state.band !== null;
  return state.amountText.trim() !== "" || state.band !== null;
}

/**
 * Il valore del campo, mai importo e fascia insieme. In modo fascia `{ band }` (l'indice). In
 * modo importo `{ eurOnce }` se c'è un importo, che sostituisce la fascia; con il campo vuoto
 * resta la fascia scelta prima (`{ band }`), e solo campo vuoto e nessuna fascia danno `null`,
 * nessun costo del team (§5.4). Togliere il costo è «Togli il costo» (`clearCost`).
 */
export function costInputValue(state: CostInputState): CostValueResult {
  if (state.mode === "fascia") return { ok: true, value: state.band === null ? null : { band: state.band } };
  const amount = parseEuroInput(state.amountText);
  if (!amount.ok) return amount;
  if (amount.value !== null) return { ok: true, value: { eurOnce: amount.value } };
  return { ok: true, value: state.band === null ? null : { band: state.band } };
}

/**
 * Il campo nascosto del modulo: vuoto (nessun costo), `{"eurOnce":40000}` oppure
 * `{"band":2}`. Un importo non valido va com'è scritto, così l'action risponde con lo stesso
 * errore del campo. Mai importo e fascia insieme.
 */
export function costFormValue(state: CostInputState): string {
  const result = costInputValue(state);
  if (!result.ok) return JSON.stringify({ eurOnce: state.amountText.trim() });
  const value = result.value;
  if (value === null) return "";
  return JSON.stringify(value.eurOnce !== undefined ? { eurOnce: value.eurOnce } : { band: value.band });
}

/**
 * Legge nell'action il campo scritto da `costFormValue` (anche da un modulo con
 * `FormData.get`): vuoto o assente è «nessun costo»; poi la stessa validazione del servizio
 * (`parseCostInput`), che rifiuta importo e fascia insieme.
 */
export function readCostFormValue(raw: unknown): CostValueResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: COST_AMOUNT_ERROR };
  if (raw.trim() === "") return { ok: true, value: null };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, message: COST_AMOUNT_ERROR };
  }
  return parseCostInput(data);
}

export interface CostBandOption {
  band: CostBand;
  /** Il valore della scelta nel gruppo: «1» … «5». */
  value: string;
  /** «€» … «€€€€€». */
  symbol: string;
  /** L'etichetta del workspace, es. «Da 25.000 a 65.000 €». */
  label: string;
}

/** Le 5 scelte del gruppo, con le etichette delle fasce del workspace (predefinite `COST_BANDS`). */
export function bandOptions(bands: readonly CostBandInfo[] = COST_BANDS): CostBandOption[] {
  const list = bands.length === 5 ? bands : COST_BANDS;
  return ([1, 2, 3, 4, 5] as const).map((band) => {
    const info = costBandInfo(band, list);
    return { band, value: String(band), symbol: info.symbol, label: info.label };
  });
}

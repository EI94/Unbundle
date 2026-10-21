/**
 * Le 5 fasce del costo di realizzazione e la posizione in matrice
 * (docs/use-case/DESIGN.md §7.2, D5, D15).
 *
 * - **Fasce predefinite** (`COST_BANDS`, decise da Pierpaolo il 14/10/2026): fino a 25.000 € ·
 *   da 25.000 a 65.000 € · da 65.000 a 130.000 € · da 130.000 a 250.000 € · «250.000 € e
 *   oltre», con 400.000 € come valore della quinta nei totali.
 * - **Fasce del workspace** (D15): `workspace_scoring_models.config.costBands`, nella forma
 *   `CostBandsConfig` (4 confini, 5 etichette, valore della quinta nei totali).
 *   `resolveCostBands(model)`, con `model` la config del modello (mai la riga del database),
 *   le restituisce se la config è valida (`validateCostBands`, la stessa dell'editor e
 *   dell'action), altrimenti `COST_BANDS`. I calcoli ricevono le fasce come ultimo argomento
 *   facoltativo `bands`, predefinito `COST_BANDS`.
 * - Fascia di un importo: la prima con `importo ≤ A`; sopra il quarto confine è la 5.
 * - Posizione in matrice: l'importo si mappa sulla scala delle fasce, da 0,5 a 5,5, con le
 *   tacche a 1, 2, 3, 4, 5; `A5` è il valore della quinta nei totali. Una fascia sola (team o
 *   sforzo) sta al centro: posizione = i.
 * - Valore di riferimento nei totali: il confine «A» per le fasce 1-4, il valore della quinta
 *   per la 5.
 * - Costo «da sforzo»: lo sforzo dà l'importo stimato di oggi (`effortCostEur`, la tabella di
 *   `estimateImplementationCost` in `src/lib/portfolio/planning.ts`; il test confronta le due)
 *   e l'importo dà la fascia del workspace. Nei totali vale l'importo stimato (`valuation.ts`).
 * - Un cambio di fasce non riscrive i dati salvati: `cost_band` resta l'indice (1-5) e si
 *   rilegge con la nuova etichetta; `cost_eur_once` trova la sua nuova fascia.
 * - «Costo basso» (D18): «fino alla fascia N» del workspace (`costLowBandFrom`), predefinita
 *   la 1; le config di prima con `costLowMaxEur` si leggono con la fascia che lo contiene.
 *
 * Modulo puro: solo import di tipi relativi `.ts`.
 */
import type { CostBand } from "./types.ts";

export interface CostBandInfo {
  band: CostBand;
  /** «€» … «€€€€€». */
  symbol: string;
  /** Etichetta della scelta nel campo costo (§5.4). */
  label: string;
  /** Da (euro, compreso). */
  fromEur: number;
  /** A (euro, compreso); `null` per la quinta, che non ha un tetto. */
  toEur: number | null;
  /** Valore che la fascia vale nei totali della Roadmap («Costo impegnato»). */
  referenceEur: number;
}

/**
 * Le fasce di un workspace come stanno in `config.costBands` (D15, §7.2). Si legge solo con
 * `validateCostBands` o `resolveCostBands`: il `jsonb` non è mai fidato.
 */
export interface CostBandsConfig {
  /** A1-A4: il tetto delle fasce 1-4, in euro interi da 1 a 100.000.000, crescenti. La quinta è aperta. */
  limits: readonly number[];
  /** Le 5 etichette, una per fascia, da 1 a 40 caratteri. */
  labels: readonly string[];
  /** Valore della quinta fascia nei totali e tetto della scala in matrice (`A5`): oltre il quarto confine. */
  topReferenceEur: number;
}

const SYMBOLS = ["€", "€€", "€€€", "€€€€", "€€€€€"] as const;
const BANDS = [1, 2, 3, 4, 5] as const satisfies readonly CostBand[];

function freezeBands(bands: CostBandInfo[]): readonly CostBandInfo[] {
  return Object.freeze(bands.map((info) => Object.freeze(info)));
}

/** Le fasce predefinite come config: «Ripristina le fasce predefinite» dell'editor (§14.3). */
export const DEFAULT_COST_BANDS_CONFIG: CostBandsConfig = Object.freeze({
  limits: Object.freeze([25_000, 65_000, 130_000, 250_000]),
  labels: Object.freeze(["Fino a 25.000 €", "Da 25.000 a 65.000 €", "Da 65.000 a 130.000 €", "Da 130.000 a 250.000 €", "250.000 € e oltre"]),
  topReferenceEur: 400_000,
});

/** Le 5 fasce predefinite (tabella «Le 5 fasce predefinite» di §7.2). */
export const COST_BANDS: readonly CostBandInfo[] = freezeBands([
  { band: 1, symbol: "€", label: "Fino a 25.000 €", fromEur: 0, toEur: 25_000, referenceEur: 25_000 },
  { band: 2, symbol: "€€", label: "Da 25.000 a 65.000 €", fromEur: 25_001, toEur: 65_000, referenceEur: 65_000 },
  { band: 3, symbol: "€€€", label: "Da 65.000 a 130.000 €", fromEur: 65_001, toEur: 130_000, referenceEur: 130_000 },
  { band: 4, symbol: "€€€€", label: "Da 130.000 a 250.000 €", fromEur: 130_001, toEur: 250_000, referenceEur: 250_000 },
  { band: 5, symbol: "€€€€€", label: "250.000 € e oltre", fromEur: 250_001, toEur: null, referenceEur: 400_000 },
]);

/**
 * A5 delle fasce predefinite: il tetto della quinta fascia sulla scala della matrice. Oltre,
 * la posizione resta 5,5. Con le fasce di un workspace vale il loro valore della quinta.
 */
export const COST_SCALE_TOP_EUR = 400_000;

export function isCostBand(value: unknown): value is CostBand {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function costBandInfo(band: CostBand, bands: readonly CostBandInfo[] = COST_BANDS): CostBandInfo {
  return bands[band - 1];
}

function assertAmount(eur: number) {
  if (typeof eur !== "number" || !Number.isFinite(eur)) throw new RangeError("Importo non valido");
}

/** La fascia di un importo: la prima con `importo ≤ A`; sopra il quarto confine la 5. */
export function bandForAmount(eur: number, bands: readonly CostBandInfo[] = COST_BANDS): CostBand {
  assertAmount(eur);
  for (const info of bands) {
    if (info.toEur !== null && eur <= info.toEur) return info.band;
  }
  return 5;
}

/**
 * Posizione orizzontale in matrice, da 0,5 a 5,5.
 * - Importo: `(i − 0,5) + (min(importo, Ai) − Di) / (Ai − Di)`, con `A5` = valore della quinta
 *   nei totali (400.000 € con le fasce predefinite).
 * - Solo fascia: `i`, al centro della fascia.
 */
export function costPosition(cost: { amount: number } | { band: CostBand }, bands: readonly CostBandInfo[] = COST_BANDS): number {
  if ("band" in cost) {
    if (!isCostBand(cost.band)) throw new RangeError("Fascia non valida");
    return cost.band;
  }
  assertAmount(cost.amount);
  const band = bandForAmount(cost.amount, bands);
  const info = costBandInfo(band, bands);
  const from = info.fromEur;
  const to = info.toEur ?? info.referenceEur;
  const span = to - from;
  // Tra A e A + 1 (importi con decimali, es. dal ROI del dossier) la frazione resta in [0, 1].
  // Una fascia larga un euro solo (confini A e A + 1) non ha ampiezza: inizio o fine.
  const fraction = span > 0 ? Math.min(1, Math.max(0, (Math.min(cost.amount, to) - from) / span)) : cost.amount >= to ? 1 : 0;
  return band - 0.5 + fraction;
}

// ─── «Costo basso» (D18) ─────────────────────────────────────────────

/**
 * «Costo basso fino alla fascia N» (D18, 19/10/2026): non più una soglia in euro, ma una delle
 * fasce 1-4 del workspace (la quinta è aperta: tutto sarebbe «costo basso»). Predefinita la 1,
 * cioè fino a 25.000 € con le fasce predefinite. La linea della matrice sta sul confine della
 * fascia N (posizione N + 0,5) e si sposta con le fasce del workspace.
 */
export type CostLowBand = 1 | 2 | 3 | 4;
export const COST_LOW_BANDS = [1, 2, 3, 4] as const satisfies readonly CostLowBand[];
export const DEFAULT_COST_LOW_BAND: CostLowBand = 1;

export function isCostLowBand(value: unknown): value is CostLowBand {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/**
 * La fascia del costo basso dalle soglie del `config` (`thresholds`): `costLowBand` se è una
 * fascia da 1 a 4; altrimenti una config di prima con `costLowMaxEur` si legge con la fascia
 * che contiene quell'importo nelle fasce del workspace (oltre il quarto confine: la 4);
 * altrimenti la predefinita.
 */
export function costLowBandFrom(thresholds: unknown, bands: readonly CostBandInfo[] = COST_BANDS): CostLowBand {
  const th = thresholds && typeof thresholds === "object" && !Array.isArray(thresholds) ? (thresholds as Record<string, unknown>) : {};
  if (isCostLowBand(th.costLowBand)) return th.costLowBand;
  const eur = th.costLowMaxEur;
  if (typeof eur === "number" && Number.isFinite(eur) && eur >= 0) {
    const band = bandForAmount(eur, bands);
    return band === 5 ? 4 : band;
  }
  return DEFAULT_COST_LOW_BAND;
}

/** La linea «Costo basso» sulla scala della matrice: il confine della fascia N. */
export function costLowLinePosition(band: CostLowBand): number {
  return band + 0.5;
}

/**
 * Il costo stimato dallo sforzo: stessa tabella di `estimateImplementationCost`
 * (`src/lib/portfolio/planning.ts`), che qui non si importa perché non è un modulo puro.
 * Il punteggio è quello grezzo del KPI (1 = sforzo minimo). Nei totali vale questo importo.
 */
export function effortCostEur(effortScore: number): number {
  if (effortScore >= 4.5) return 250_000;
  if (effortScore >= 3.5) return 130_000;
  if (effortScore >= 2.5) return 65_000;
  if (effortScore >= 1.5) return 25_000;
  return 10_000;
}

/** La fascia «da sforzo» (§7.2, fonte 4): la fascia del workspace del costo stimato dallo sforzo. */
export function bandForEffort(effortScore: number, bands: readonly CostBandInfo[] = COST_BANDS): CostBand {
  return bandForAmount(effortCostEur(effortScore), bands);
}

// ─── Fasce del workspace (D15) ───────────────────────────────────────

/** Confini e valore della quinta: interi da 1 a 100.000.000 (§7.2). */
export const COST_BANDS_MAX_EUR = 100_000_000;
/** Etichetta di una fascia: da 1 a 40 caratteri (§7.2). */
export const COST_BAND_LABEL_MAX = 40;

/** Errori dell'editor delle fasce, testi esatti di §14.3. */
export const COST_BANDS_LIMITS_ERROR = "I confini devono crescere da una fascia all'altra.";
export const COST_BANDS_TOP_REFERENCE_ERROR = "Il valore nei totali della quinta fascia deve superare il quarto confine.";
export const COST_BANDS_LABEL_ERROR = "Scrivi un'etichetta di massimo 40 caratteri.";
/** Un confine o il valore della quinta che non è un importo intero (o supera 100.000.000): il testo del campo costo (§5.4). */
export const COST_BANDS_AMOUNT_ERROR = "Scrivi un importo in euro, senza decimali (es. 40000).";
/** Forma sbagliata (es. un quinto confine: la quinta fascia è aperta). L'editor non la produce mai. */
export const COST_BANDS_SHAPE_ERROR = "Servono 4 confini e 5 etichette: la quinta fascia è aperta, senza tetto.";

/** Errori per campo: `limits.0`-`limits.3`, `labels.0`-`labels.4`, `topReferenceEur`; per la forma `limits`, `labels`, `payload`. */
export type CostBandsFieldErrors = Record<string, string>;

const PLAIN_DIGITS = /^[0-9]+$/;
const THOUSANDS_DOTS = /^[0-9]{1,3}(\.[0-9]{3})+$/;

/** Un importo intero da 0 a 100.000.000: numero, o testo con i punti delle migliaia («25.000»), come il campo costo. */
function euroInteger(raw: unknown): number | null {
  let value: number;
  if (typeof raw === "number") value = raw;
  else if (typeof raw === "string") {
    const text = raw.trim();
    if (!PLAIN_DIGITS.test(text) && !THOUSANDS_DOTS.test(text)) return null;
    value = Number(text.replaceAll(".", ""));
  } else return null;
  return Number.isSafeInteger(value) && value >= 0 && value <= COST_BANDS_MAX_EUR ? value : null;
}

/**
 * Valida le fasce di un workspace (§7.2, testi di §14.3): la stessa funzione nell'editor di
 * Impostazioni › Valutazione e nella sua action.
 * - 4 confini interi da 1 a 100.000.000, ognuno più alto del precedente (il primo più alto di
 *   0, l'inizio della prima fascia); la quinta fascia è aperta: un quinto confine è un errore.
 * - Il valore della quinta nei totali supera il quarto confine e non va oltre 100.000.000.
 * - 5 etichette da 1 a 40 caratteri, senza gli spazi in testa e in coda.
 * Confini e valore arrivano come numeri o come testo del campo («25.000»). Le chiavi in più si
 * ignorano. Con `ok` la config pulita, pronta per `config.costBands`.
 */
export function validateCostBands(input: unknown): { ok: true; value: CostBandsConfig } | { ok: false; fieldErrors: CostBandsFieldErrors } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, fieldErrors: { payload: COST_BANDS_SHAPE_ERROR } };
  const data = input as Record<string, unknown>;
  const fieldErrors: CostBandsFieldErrors = {};

  // Per indice, mai con `forEach`: in un array sparso un buco è un confine o un'etichetta che
  // manca (errore del campo), non uno in meno nel risultato.
  const limits: number[] = [];
  if (!Array.isArray(data.limits) || data.limits.length !== 4) {
    fieldErrors.limits = COST_BANDS_SHAPE_ERROR;
  } else {
    let previous = 0;
    for (let i = 0; i < 4; i++) {
      const value = euroInteger(data.limits[i]);
      if (value === null) fieldErrors[`limits.${i}`] = COST_BANDS_AMOUNT_ERROR;
      else if (value <= previous) fieldErrors[`limits.${i}`] = COST_BANDS_LIMITS_ERROR;
      if (value !== null) {
        limits.push(value);
        previous = Math.max(previous, value);
      }
    }
  }

  const labels: string[] = [];
  if (!Array.isArray(data.labels) || data.labels.length !== 5) {
    fieldErrors.labels = COST_BANDS_SHAPE_ERROR;
  } else {
    for (let i = 0; i < 5; i++) {
      const raw: unknown = data.labels[i];
      const text = typeof raw === "string" ? raw.trim() : "";
      const length = [...text].length;
      if (length < 1 || length > COST_BAND_LABEL_MAX) fieldErrors[`labels.${i}`] = COST_BANDS_LABEL_ERROR;
      labels.push(text);
    }
  }

  const topReferenceEur = euroInteger(data.topReferenceEur);
  if (topReferenceEur === null) fieldErrors.topReferenceEur = COST_BANDS_AMOUNT_ERROR;
  else if (limits.length === 4 && fieldErrors["limits.3"] === undefined && topReferenceEur <= limits[3]) {
    fieldErrors.topReferenceEur = COST_BANDS_TOP_REFERENCE_ERROR;
  }

  // Mai `ok` senza 4 confini e 5 etichette, qualunque cosa sia passata sopra.
  if (!Object.keys(fieldErrors).length && (limits.length !== 4 || labels.length !== 5)) fieldErrors.payload = COST_BANDS_SHAPE_ERROR;
  if (Object.keys(fieldErrors).length || topReferenceEur === null) return { ok: false, fieldErrors };
  return { ok: true, value: { limits, labels, topReferenceEur } };
}

/** Le fasce di una config già valida (`validateCostBands`): il «Da» di ogni fascia è il confine prima più 1 euro. */
function costBandsFromConfig(config: CostBandsConfig): readonly CostBandInfo[] {
  return freezeBands(
    BANDS.map((band, i) => {
      const toEur = band < 5 ? config.limits[i] : null;
      return {
        band,
        symbol: SYMBOLS[i],
        label: config.labels[i],
        fromEur: i === 0 ? 0 : config.limits[i - 1] + 1,
        toEur,
        referenceEur: toEur ?? config.topReferenceEur,
      };
    }),
  );
}

/**
 * Dove stanno le fasce: la config del modello di valutazione, cioè `ValuationModel`,
 * `ScoringModelConfig`, il `config` o il `resolvedConfig` di una riga di
 * `workspace_scoring_models`. Mai la riga intera (`ScoringModelRow`): le fasce stanno nella
 * sua config, e TypeScript la rifiuta perché non ha nessuna di queste chiavi.
 */
export type CostBandsSource = { costBands?: unknown; dimensions?: unknown; thresholds?: unknown };

/**
 * Le fasce già risolte (l'array di 5 `CostBandInfo` di `resolveCostBands`) rilette come config:
 * rimesse in `costBands`, danno le stesse fasce. Ogni altro valore passa com'è a
 * `validateCostBands`, che lo rifiuta se non è una `CostBandsConfig`.
 */
function configOfResolvedBands(raw: unknown): unknown {
  if (!Array.isArray(raw) || raw.length !== 5) return raw;
  const infos: Partial<CostBandInfo>[] = [];
  // Ogni elemento è la fascia del suo indice, e la quinta è aperta.
  for (const band of BANDS) {
    const item: unknown = raw[band - 1];
    if (!item || typeof item !== "object" || (item as Partial<CostBandInfo>).band !== band) return raw;
    infos.push(item as Partial<CostBandInfo>);
  }
  if (infos[4].toEur !== null) return raw;
  return { limits: infos.slice(0, 4).map((info) => info.toEur), labels: infos.map((info) => info.label), topReferenceEur: infos[4].referenceEur };
}

/**
 * Le fasce del workspace (D15): `model.costBands`, nella forma `CostBandsConfig` del `jsonb`,
 * se è valida (`validateCostBands`), altrimenti `COST_BANDS`. Legge solo `model.costBands`:
 * `model` è la config del modello (`CostBandsSource`), non la riga del database. Rilegge anche
 * le fasce che restituisce, con la stessa validazione: rimetterle in `costBands` non cambia
 * nulla. Le usano matrice, fonte «fascia», costo basso, totali, export, campo costo e MCP del
 * team. Senza `costBands` valgono le predefinite.
 */
export function resolveCostBands(model: CostBandsSource | null | undefined): readonly CostBandInfo[] {
  const raw = model?.costBands;
  if (raw === undefined || raw === null) return COST_BANDS;
  const checked = validateCostBands(configOfResolvedBands(raw));
  return checked.ok ? costBandsFromConfig(checked.value) : COST_BANDS;
}

/** «25.000»: le migliaia col punto, anche sotto 10.000 (it-IT da solo non le raggruppa). */
function euroText(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Le 5 etichette nella forma predefinita per 4 confini: «Fino a 25.000 €», «Da 25.000 a
 * 65.000 €», …, «250.000 € e oltre». L'editor le propone quando cambia un confine (§7.2).
 */
export function defaultCostBandLabels(limits: readonly number[]): string[] {
  const [a1, a2, a3, a4] = limits.slice(0, 4).map(euroText);
  return [`Fino a ${a1} €`, `Da ${a1} a ${a2} €`, `Da ${a2} a ${a3} €`, `Da ${a3} a ${a4} €`, `${a4} € e oltre`];
}

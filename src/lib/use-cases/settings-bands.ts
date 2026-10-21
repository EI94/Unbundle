/**
 * L'editor delle fasce del costo di Impostazioni › Valutazione (docs/use-case/DESIGN.md §7.2
 * «Fasce del workspace», §14.3; PIANO-LAVORI H3d; D15), fuori dal componente
 * `cost-bands-field.tsx` perché lo provi `node --test`.
 *
 * - **Cosa si modifica**: i 4 confini (il tetto «Fino a» delle fasce 1-4), le 5 etichette e
 *   il valore della quinta nei totali. Le fasce sono sempre 5; i simboli non cambiano.
 * - **Parte** dalle fasce del workspace (`resolveCostBands`) o dalle predefinite.
 * - **Propone l'etichetta quando cambia un confine**, nella forma predefinita («Da 25.000 a
 *   65.000 €», `defaultCostBandLabels`): un confine cambia le etichette delle due fasce che
 *   tocca. Un'etichetta che segue la forma predefinita si aggiorna da sola; una riscritta a
 *   mano resta com'è e riceve la proposta da usare con un clic (`proposedLabel`).
 * - **Valida** con `validateCostBands`, la stessa funzione dell'action: errori per campo
 *   (`limits.0`-`limits.3`, `labels.0`-`labels.4`, `topReferenceEur`).
 * - **Ripristina le fasce predefinite** (`defaultCostBandsDraft`) cambia solo la bozza: si
 *   salva con «Salva le fasce».
 *
 * Modulo puro: solo import relativi `.ts`. I nomi non iniziano con `use` più una maiuscola (D16).
 */
import {
  DEFAULT_COST_BANDS_CONFIG,
  defaultCostBandLabels,
  validateCostBands,
  type CostBandInfo,
  type CostBandsConfig,
  type CostBandsFieldErrors,
} from "./cost-bands.ts";
import { euroInputText, sameCostBands } from "./settings.ts";

export const COST_BAND_LIMITS = 4;
export const COST_BAND_COUNT = 5;

export interface CostBandsDraft {
  /** Il testo dei 4 confini, com'è scritto («25.000» o «25000»). */
  limits: readonly string[];
  /** Le 5 etichette, com'è scritto. */
  labels: readonly string[];
  /** Il valore della quinta nei totali, com'è scritto. */
  topReference: string;
  /** Per fascia: l'etichetta segue la forma predefinita dei confini, finché non la riscrivi. */
  follows: readonly boolean[];
}

const PLAIN_DIGITS = /^[0-9]+$/;
const THOUSANDS_DOTS = /^[0-9]{1,3}(\.[0-9]{3})+$/;

/** Un confine scritto nel campo: «25.000» o «25000»; null se non è un intero positivo. */
export function parseDraftAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!PLAIN_DIGITS.test(trimmed) && !THOUSANDS_DOTS.test(trimmed)) return null;
  const value = Number(trimmed.replaceAll(".", ""));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * La proposta dell'etichetta della fascia `index` (0-4) con i confini della bozza, oppure
 * null se un confine che le serve non è ancora un importo, o se i due confini della fascia
 * non crescono: «Da 70.000 a 20.000 €» non è una fascia (mentre si scrive, o con l'errore
 * dei confini a schermo).
 */
export function proposedLabel(draft: Pick<CostBandsDraft, "limits">, index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= COST_BAND_COUNT) return null;
  const needed = [index - 1, index].filter((i) => i >= 0 && i < COST_BAND_LIMITS);
  const values = draft.limits.map((text) => parseDraftAmount(text ?? ""));
  if (needed.some((i) => values[i] === null || values[i] === undefined)) return null;
  if (needed.length === 2 && (values[needed[0]] ?? 0) >= (values[needed[1]] ?? 0)) return null;
  return defaultCostBandLabels(values.map((value) => value ?? 0))[index];
}

function followsOf(limits: readonly string[], labels: readonly string[]): boolean[] {
  return labels.map((label, index) => label.trim() === proposedLabel({ limits }, index));
}

/** La bozza di una configurazione già valida. */
export function draftFromConfig(config: CostBandsConfig): CostBandsDraft {
  const limits = config.limits.slice(0, COST_BAND_LIMITS).map(euroInputText);
  const labels = config.labels.slice(0, COST_BAND_COUNT).map(String);
  return { limits, labels, topReference: euroInputText(config.topReferenceEur), follows: followsOf(limits, labels) };
}

/** La bozza delle fasce del workspace, come le dà `resolveCostBands` (5 fasce, la quinta aperta). */
export function draftFromBands(bands: readonly CostBandInfo[]): CostBandsDraft {
  return draftFromConfig({
    limits: bands.slice(0, COST_BAND_LIMITS).map((band) => band.toEur ?? 0),
    labels: bands.slice(0, COST_BAND_COUNT).map((band) => band.label),
    topReferenceEur: bands[COST_BAND_COUNT - 1]?.referenceEur ?? DEFAULT_COST_BANDS_CONFIG.topReferenceEur,
  });
}

/** «Ripristina le fasce predefinite»: la bozza delle fasce predefinite (`COST_BANDS`). */
export function defaultCostBandsDraft(): CostBandsDraft {
  return draftFromConfig(DEFAULT_COST_BANDS_CONFIG);
}

/**
 * Cambia un confine (0-3). Le etichette delle due fasce che il confine tocca (`index` e
 * `index + 1`) prendono la forma predefinita se la seguivano; le altre restano.
 */
export function setDraftLimit(draft: CostBandsDraft, index: number, text: string): CostBandsDraft {
  if (!Number.isInteger(index) || index < 0 || index >= COST_BAND_LIMITS) return draft;
  const limits = draft.limits.map((value, i) => (i === index ? text : value));
  const labels = draft.labels.map((label, i) => {
    if ((i !== index && i !== index + 1) || !draft.follows[i]) return label;
    return proposedLabel({ limits }, i) ?? label;
  });
  return { ...draft, limits, labels };
}

/** Cambia un'etichetta (0-4): segue la forma predefinita solo se è proprio la proposta. */
export function setDraftLabel(draft: CostBandsDraft, index: number, text: string): CostBandsDraft {
  if (!Number.isInteger(index) || index < 0 || index >= COST_BAND_COUNT) return draft;
  const labels = draft.labels.map((label, i) => (i === index ? text : label));
  const follows = draft.follows.map((value, i) => (i === index ? text.trim() === proposedLabel(draft, index) : value));
  return { ...draft, labels, follows };
}

/**
 * La proposta da mostrare accanto all'etichetta `index`, oppure null: solo se un confine che
 * la tocca è cambiato rispetto a `saved`, l'etichetta non la segue già e la proposta è diversa
 * da quello che c'è scritto (§7.2: l'editor propone, la si può riscrivere).
 */
export function labelProposal(draft: CostBandsDraft, saved: Pick<CostBandsDraft, "limits">, index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= COST_BAND_COUNT || draft.follows[index]) return null;
  const touching = [index - 1, index].filter((i) => i >= 0 && i < COST_BAND_LIMITS);
  const changed = touching.some((i) => parseDraftAmount(draft.limits[i] ?? "") !== parseDraftAmount(saved.limits[i] ?? ""));
  const proposal = proposedLabel(draft, index);
  return changed && proposal !== null && proposal !== draft.labels[index]?.trim() ? proposal : null;
}

/** Usa la proposta per l'etichetta `index`: da lì la segue. */
export function applyProposedLabel(draft: CostBandsDraft, index: number): CostBandsDraft {
  const proposal = proposedLabel(draft, index);
  return proposal === null ? draft : setDraftLabel(draft, index, proposal);
}

/** Cambia il valore della quinta nei totali. */
export function setDraftTopReference(draft: CostBandsDraft, text: string): CostBandsDraft {
  return { ...draft, topReference: text };
}

/** All'uscita dal campo: gli importi validi si riscrivono con i punti delle migliaia («25000» → «25.000»). */
export function tidyDraft(draft: CostBandsDraft): CostBandsDraft {
  const tidy = (text: string) => {
    const value = parseDraftAmount(text);
    return value === null ? text : euroInputText(value);
  };
  return { ...draft, limits: draft.limits.map(tidy), topReference: tidy(draft.topReference) };
}

/** Il valore che il modulo manda all'action: lo stesso che legge `validateCostBands`. */
export function draftInput(draft: CostBandsDraft): { limits: string[]; labels: string[]; topReferenceEur: string } {
  return { limits: [...draft.limits], labels: [...draft.labels], topReferenceEur: draft.topReference };
}

/** Gli errori della bozza, per campo: vuoto se è valida. */
export function draftErrors(draft: CostBandsDraft): CostBandsFieldErrors {
  const checked = validateCostBands(draftInput(draft));
  return checked.ok ? {} : checked.fieldErrors;
}

/** La configurazione della bozza, se è valida. */
export function draftConfig(draft: CostBandsDraft): CostBandsConfig | null {
  const checked = validateCostBands(draftInput(draft));
  return checked.ok ? checked.value : null;
}

/**
 * Vero se la bozza dice le stesse fasce di `saved` (per esempio «25000» e «25.000», o
 * un'etichetta con uno spazio in più): allora non c'è niente da salvare.
 */
export function sameDraft(draft: CostBandsDraft, saved: CostBandsDraft): boolean {
  const a = draftConfig(draft);
  const b = draftConfig(saved);
  if (a && b) return sameCostBands(a, b);
  return (
    draft.topReference === saved.topReference &&
    draft.limits.every((value, i) => value === saved.limits[i]) &&
    draft.labels.every((value, i) => value === saved.labels[i])
  );
}

/** Vero se la bozza è uguale alle fasce predefinite: allora «Ripristina» non serve. */
export function isDefaultDraft(draft: CostBandsDraft): boolean {
  return sameDraft(draft, defaultCostBandsDraft());
}

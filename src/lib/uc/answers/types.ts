/**
 * Tipi della normalizzazione delle risposte (PIANO §3.9), propri di WP2.
 *
 * `ResponseConfig` è la `response.config` della voce nel template canonico
 * (PIANO §4.1). Tutte le chiavi sono facoltative: il normalizzatore del
 * template (WP3) riempie quelle che conosce e le altre restano ignorate.
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import type { ResponseType } from "../vocab.ts";
import type { Issue } from "./issues.ts";

export interface ChoiceOption {
  value: string;
  label?: string;
}

/** Tipi ammessi per una colonna di tabella. */
export const TABLE_CELL_TYPES = ["testo", "numero", "percentuale", "valuta", "data", "ora", "durata", "si_no", "codice"] as const;
export type TableCellType = (typeof TABLE_CELL_TYPES)[number];

export interface TableColumnConfig {
  key: string;
  label?: string;
  type?: TableCellType;
  /** Unità della colonna, testo libero come `config.unit` («minuti», «€/ora»). */
  unit?: string;
}

/** Tipo degli estremi di un intervallo. */
export type IntervalKind = "numero" | "durata" | "ora" | "data" | "giorno_mese";

export interface ResponseConfig {
  /** Unità in testo libero dal template: «kg», «€ per notte», «% dei preventivi», «ore o giorni». */
  unit?: string | null;
  integer?: boolean;
  /** Minimo e massimo nell'unità della voce (durata: nell'unità della voce, altrimenti minuti). */
  min?: number;
  max?: number;
  options?: readonly (string | ChoiceOption)[];
  /** «Altro» con testo: vale anche se tra le opzioni c'è «Altro». */
  allow_other?: boolean;
  min_choices?: number;
  max_choices?: number;
  min_length?: number;
  max_length?: number;
  /** Espressione regolare del codice (ICAO `^[A-Z]{4}$`, IATA `^[A-Z]{3}$`). */
  pattern?: string;
  allowed?: readonly string[];
  /** Entità a cui il codice si riferisce (il vecchio tipo `riferimento`). */
  ref_entity?: string;
  /** Il codice resta com'è scritto (di default diventa maiuscolo). */
  preserve_case?: boolean;
  /** Fuso IANA per `data_ora` (default Europe/Rome). */
  tz?: string;
  /** `data_ora`: solo un orario ricorrente, senza data. */
  time_only?: boolean;
  /** `'today'` oppure `YYYY-MM-DD`. */
  min_date?: string;
  max_date?: string;
  /** Valuta attesa (ISO). Senza, vale quella scritta o EUR. */
  currency?: string;
  /** Unità di riferimento dell'importo («volo», «notte», «anno»). */
  per?: string;
  /** IVA attesa per l'importo, se la voce la fissa. */
  vat?: "inclusa" | "esclusa";
  /** Base della percentuale («del venduto»). */
  base?: string;
  kind?: IntervalKind;
  columns?: readonly TableColumnConfig[];
  key_column?: string;
  min_rows?: number;
  max_rows?: number;
  ask_exceptions?: boolean;
  /** Testo della regola o della formula proposta, se non arriva dal contesto. */
  proposed_text?: string;
  /** `conferma_valore`: il tipo su cui si appoggia la conferma e la sua configurazione. */
  base_type?: ResponseType;
  base_config?: ResponseConfig;
  /** `collegamento_sistema`: sistemi ammessi (mappa dei tool del cliente). */
  systems?: readonly string[];
  max_files?: number;
  [key: string]: unknown;
}

/** Valore già dichiarato (per esempio in call) che il referente conferma o corregge. */
export interface DeclaredValue {
  value: Json | null;
  normalized: Json | null;
}

export interface NormalizeContext {
  /** Oggi a Roma, `YYYY-MM-DD` (vedi `romeToday`). */
  today: string;
  tz: "Europe/Rome";
  /** `false` per le bozze: salva comunque e riporta gli errori. `true` per l'invio. */
  strict: boolean;
  /** Id dei file utilizzabili (puliti o revisionati) dello stesso caso e della stessa voce. */
  usableFileIds?: readonly string[];
  /** Coppie file/dataset utilizzabili dello stesso caso e della stessa voce. */
  usableDatasets?: readonly { fileId: string; datasetId: string }[];
  /** `conferma_valore`: il valore dichiarato da confermare. */
  declared?: DeclaredValue | null;
  /** `conferma_regola`/`conferma_formula`: testo proposto (titolo della domanda o regola collegata). */
  proposedText?: string | null;
}

/** Risultato interno di un normalizzatore di tipo, prima della decisione strict/bozza. */
export interface Outcome {
  value: Json | null;
  normalized: Json | null;
  errors: Issue[];
  warnings: Issue[];
  partial?: boolean;
  /** `valid_from` letto dal payload (valuta), da salvare nella colonna della risposta. */
  validFrom?: string | null;
  /** Impronta del testo o del valore confermato (`uc_answers.text_hash`). */
  textHash?: string | null;
}

export function outcome(partial: Partial<Outcome> & Pick<Outcome, "value">): Outcome {
  return { normalized: null, errors: [], warnings: [], ...partial };
}

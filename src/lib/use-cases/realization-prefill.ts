/**
 * Il dossier precompilato da uno use case arrivato dal connettore (decisione di Pierpaolo del
 * 19/10/2026, docs/use-case/PIANO-LAVORI.md H6a). Solo per una scheda con
 * `intake.contractVersion = 2`:
 * - «In una frase» parte dal problema intero, in una riga, al massimo 500 caratteri (il
 *   modulo e lo schema del dossier ammettono 500);
 * - accanto, in sola lettura, «Dati raccolti da Claude»: problema, soluzione
 *   (`flowDescription`), area e strumenti, con i titoli della guida del connettore e mai le
 *   chiavi. Nel dossier diventano un blocco della Descrizione che l'editor non modifica
 *   (`extraBlocks` di `src/lib/uc/views/description.ts`, dentro «Altro»).
 *
 * Il nome di chi ha proposto, l'email e le stime non entrano mai: solo questi quattro campi.
 *
 * Modulo puro: nessun import di runtime.
 */

/** La versione del contratto del connettore (`external-submission.ts`, `CONNECTOR_CONTRACT_VERSION`). */
export const CONNECTOR_INTAKE_VERSION = 2;

/** Al massimo 500 caratteri, come `one_liner` del dossier e il modulo di avvio. */
export const PREFILL_ONE_LINER_MAX = 500;

/** Lo stesso limite di un blocco di testo della Descrizione (`DESCRIPTION_LIMITS.text`). */
const BLOCK_MAX = 4000;

/**
 * La chiave del blocco nella Descrizione del dossier. `extraBlocks` ne fa il titolo
 * («Dati raccolti da Claude»): `_` diventa uno spazio e la prima lettera maiuscola.
 */
export const COLLECTED_BLOCK_KEY = "dati_raccolti_da_Claude";

export const PREFILL_TEXT = Object.freeze({
  title: "Dati raccolti da Claude",
  hint: "Dallo use case arrivato dal connettore. Entrano nel dossier in sola lettura.",
  problem: "Problema",
  solution: "Soluzione",
  area: "Area",
  tools: "Strumenti",
});

/** Le chiavi del blocco nel dossier, nell'ordine in cui si leggono. */
const BLOCK_KEYS = Object.freeze({ problem: "problema", solution: "soluzione", area: "area", tools: "strumenti" });

export interface PrefillSource {
  /** `use_cases.description`: il problema. */
  problem: string | null;
  /** `use_cases.flow_description`: la soluzione. */
  flow: string | null;
  intake: unknown;
  /** `workspace_connector_configs.guide`, per i titoli di area e strumenti. */
  guide: unknown;
}

export interface PrefillRow {
  label: string;
  value: string;
}

export interface RealizationPrefill {
  /** «In una frase» del modulo di avvio. Vuoto se la scheda non ha un problema. */
  oneLiner: string;
  /** Le righe in sola lettura accanto alla frase, nell'ordine problema, soluzione, area, strumenti. */
  rows: PrefillRow[];
  /** Il blocco della Descrizione del dossier (`{ [COLLECTED_BLOCK_KEY]: {...} }`), vuoto senza righe. */
  description: Record<string, Record<string, string>>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/\r\n?/g, "\n").trim();
  return t ? t : null;
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/** Una scheda arrivata dal connettore (contratto v2). */
export function isConnectorIntake(intake: unknown): boolean {
  return record(intake)?.contractVersion === CONNECTOR_INTAKE_VERSION;
}

/** Il problema in una riga, al massimo 500 caratteri. */
export function prefillOneLiner(problem: string | null | undefined): string {
  const t = text(problem);
  return t ? clip(t.replace(/\s+/g, " "), PREFILL_ONE_LINER_MAX) : "";
}

/**
 * Titoli per id di un elenco della guida: stringhe (id e titolo uguali) oppure oggetti con `id`
 * e il titolo in `label`, `nome` o `name` (la lettura tollerante di `guideLabels`).
 */
function guideTitles(list: unknown): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(list)) return out;
  for (const entry of list) {
    const item = record(entry);
    const id = typeof entry === "string" ? text(entry) : text(item?.id);
    if (!id || out.has(id)) continue;
    const title = item ? ["label", "nome", "name"].map((key) => text(item[key])).find((value) => value !== null) : null;
    out.set(id, title ?? id);
  }
  return out;
}

/** Un id senza titolo nella guida: `foglio_calcolo` → «foglio calcolo». */
function idText(id: string): string {
  return id.replace(/_/g, " ");
}

/**
 * Il precompilato per una scheda del connettore, oppure null per ogni altra scheda (il modulo
 * resta quello di oggi: la frase dalla prima frase del problema, nessuna riga accanto).
 */
export function realizationPrefill(source: PrefillSource): RealizationPrefill | null {
  const intake = record(source.intake);
  if (!intake || !isConnectorIntake(intake)) return null;
  const guide = record(source.guide);
  const problem = text(source.problem);
  const solution = text(source.flow);
  const areaId = text(intake.area);
  const area = areaId ? (guideTitles(guide?.areas).get(areaId) ?? areaId) : null;
  const toolTitles = guideTitles(guide?.tools);
  const tools = Array.isArray(intake.tools)
    ? intake.tools
        .map(text)
        .filter((tool): tool is string => tool !== null && tool !== "altro")
        .map((tool) => toolTitles.get(tool) ?? idText(tool))
    : [];
  const other = text(intake.toolsOther);
  if (other) tools.push(other);
  const toolsText = tools.length ? [...new Set(tools)].join(", ") : null;

  const entries: Array<[keyof typeof BLOCK_KEYS, string | null]> = [
    ["problem", problem],
    ["solution", solution],
    ["area", area],
    ["tools", toolsText],
  ];
  const rows: PrefillRow[] = [];
  const block: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!value) continue;
    const clipped = clip(value, BLOCK_MAX);
    rows.push({ label: PREFILL_TEXT[key], value: clipped });
    block[BLOCK_KEYS[key]] = clipped;
  }
  return {
    oneLiner: prefillOneLiner(problem),
    rows,
    description: rows.length ? { [COLLECTED_BLOCK_KEY]: block } : {},
  };
}

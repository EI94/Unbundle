import { FilterChips, type FilterField, type FilterOption } from "@/components/ui-10/filter-chips";
import { INFO_PROGRESS_TEXT } from "@/lib/use-cases/info-progress";
import { KIND_LABEL, ORIGIN_LABEL } from "@/lib/use-cases/labels";
import { NEED_STATE_TEXT } from "@/lib/use-cases/needs";
import type { ReferentFilterMenu } from "@/lib/use-cases/referent/filter";
import { NEED_STATE_PARAMS, isHubChart, type HubParamKey } from "@/lib/use-cases/views";
import { withoutTransient, type HubQuery } from "./use-case-row";

/**
 * Testi dei filtri (docs/use-case/DESIGN.md §4.7, §14.3; rilascio 10, §3.4). «Cerca», «Filtri (n)», «Togli tutti» e le
 * voci «Tutti» li dice `FilterChips` da sé (`UI10_TEXT.filters`).
 */
export const FILTER_TEXT = Object.freeze({
  referent: "Referente",
  area: "Area",
  kind: "Tipo",
  origin: "Origine",
  channel: "Canale",
  agent: "Agente",
  quarter: "Trimestre",
  lab: "AI Lab",
  /** I vecchi link di «Priorità» con «da stimare» (`stima`), fuori dai grafici: il chip che lo toglie. */
  estimate: "Stima",
  estimateOptions: Object.freeze({ mancante: "Da stimare", "fuori-matrice": "Senza beneficio contato" }),
});

export type { FilterOption };

export interface FilterBarProps {
  basePath: string;
  /** I parametri della pagina già letti da `parseHubParams` (vista compresa). */
  query: HubQuery;
  /** I contributori: la ricerca e, quando serve, «Referente» (§4.7). */
  mode: "revisore" | "contributore";
  /**
   * «Tipo» è un filtro (Da costruire, Da diffondere) in ogni vista; non c'è sulle due matrici del menu «⋯», che sono
   * solo «Da costruire».
   */
  kind: "filtro" | "nessuno";
  /**
   * Le voci dei filtri dei revisori, dagli use case del workspace e con il valore scelto. `agents`: «Agente» (il
   * prefisso del titolo, mai una persona); `infos`: «Informazioni» (Raccolta informazioni). Senza voci il campo non c'è.
   */
  more?: { channels: FilterOption[]; areas: FilterOption[]; agents?: FilterOption[]; labs: FilterOption[]; quarters: FilterOption[]; infos?: FilterOption[] };
  /** (Rilascio 5, §11.2) «Referente», per tutti i ruoli; null senza la funzione. */
  referent?: ReferentFilterMenu | null;
}

export type { ReferentFilterMenu } from "@/lib/use-cases/referent/filter";

const KINDS: FilterOption[] = [
  { value: "costruire", label: KIND_LABEL.da_costruire.label },
  { value: "diffondere", label: KIND_LABEL.da_diffondere.label },
];

/** (Rilascio 10, §4, D4) I nomi lunghi dell'origine solo nel foglio; il chip dice «Dal basso», «Dall'alto». */
const ORIGINS: FilterOption[] = [
  { value: "adoption", label: ORIGIN_LABEL.adoption.long, chip: ORIGIN_LABEL.adoption.chip },
  { value: "transformation", label: ORIGIN_LABEL.transformation.long, chip: ORIGIN_LABEL.transformation.chip },
];

/** «Stato» di «Cosa serve» (`stato=`): i tre conteggi in vista e, solo qui, «Ferme», «A posto» e «Aperte». */
const NEED_STATES: FilterOption[] = NEED_STATE_PARAMS.map((state) => ({ value: state, label: NEED_STATE_TEXT.options[state] }));

/**
 * I campi del foglio «Filtri» (rilascio 10, §3.4), in quest'ordine: in «Cosa serve» prima «Stato»; poi Referente,
 * Area, Tipo, Origine, Canale, Agente, Trimestre, Informazioni, AI Lab. Un campo senza voci non c'è. Ai contributori
 * solo «Referente», quando serve. Ogni campo è un parametro dell'indirizzo, gli stessi di prima; filtri per persona non
 * esistono (art. 15.4): `parseHubParams` li scarterebbe comunque. «Stima» compare solo con un vecchio link che la
 * porta, fuori dai grafici, perché si possa togliere.
 */
export function filterFields({ query, mode, kind, more, referent = null }: Omit<FilterBarProps, "basePath">): FilterField[] {
  const fields: FilterField[] = [];
  const push = (key: HubParamKey, label: string, options: readonly FilterOption[] | undefined) => {
    if (options?.length) fields.push({ key, label, options, value: query[key] ?? null });
  };
  const reviewer = mode === "revisore";
  if (reviewer && query.vista === "cosa-serve") push("stato", NEED_STATE_TEXT.label, NEED_STATES);
  if (referent?.shown) push("referente", FILTER_TEXT.referent, referent.options.map((option) => ({ value: option.value, label: option.label, chip: option.word })));
  if (reviewer && more) {
    push("area", FILTER_TEXT.area, more.areas);
    if (kind === "filtro") push("tipo", FILTER_TEXT.kind, KINDS);
    push("origine", FILTER_TEXT.origin, ORIGINS);
    push("canale", FILTER_TEXT.channel, more.channels);
    push("agente", FILTER_TEXT.agent, more.agents);
    push("trimestre", FILTER_TEXT.quarter, more.quarters);
    push("info", INFO_PROGRESS_TEXT.filterLabel, more.infos);
    push("lab", FILTER_TEXT.lab, more.labs);
    if (query.stima && !isHubChart(query.mostra ?? null)) {
      push("stima", FILTER_TEXT.estimate, Object.entries(FILTER_TEXT.estimateOptions).map(([value, label]) => ({ value, label })));
    }
  }
  return fields;
}

/** I parametri da tenere nei moduli e nei chip: tutti quelli della pagina tranne pannelli e ricevute. */
function keptQuery(query: HubQuery): Record<string, string> {
  return Object.fromEntries(Object.entries(withoutTransient(query)).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));
}

/**
 * La barra dei filtri della pagina «Use case» (rilascio 10, §3.4; il pezzo comune `FilterChips`): «Cerca» (al
 * telefono un'icona) e «Filtri (n)», che apre un foglio con tutti i filtri (`filterFields`); sotto, i filtri attivi
 * come chip con ✕ e «Togli tutti». I filtri restano nell'indirizzo, con gli stessi parametri di prima: si condivide il
 * link e si torna indietro. La ricerca vale da 2 a 100 caratteri (`parseHubParams`).
 */
export function FilterBar({ basePath, query, mode, kind, more, referent = null }: FilterBarProps) {
  return (
    <div data-slot="filter-bar" className="min-w-0">
      <FilterChips basePath={basePath} query={keptQuery(query)} search={{ param: "q" }} fields={filterFields({ query, mode, kind, more, referent })} />
    </div>
  );
}

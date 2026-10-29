/**
 * Le corsie della Panoramica (rilascio «Panoramica»): gli use case approvati in tre corsie per
 * trimestre, poi «In realizzazione» e «Realizzati».
 *
 * - **Tre corsie.** «Questo trimestre · T4 2026», «Prossimo trimestre · T1 2027», «Più avanti»,
 *   sempre tutte e tre, anche vuote. Gli scaduti (trimestre passato, senza avvio) stanno in cima a
 *   «Questo trimestre» con «Scaduto» e il loro trimestre («T3 2026»), così non finiscono mai dietro
 *   «Mostra gli altri»; i trimestri dopo il prossimo vanno in «Più avanti» con il loro («T2 2027»).
 * - **Ordine per euro.** Prima gli euro contati all'anno, poi il tetto «da misurare · fino a X €»,
 *   poi il Valore in parola, poi il resto; a pari cifra il codice, poi il titolo (`compareLaneItems`).
 * - **Barre.** La lunghezza è la cifra sulla scala del più grande degli approvati di tutto il
 *   workspace (`laneBarScale`): un filtro non accorcia né allunga nessuna barra. Piena per gli euro
 *   contati, tratteggiata per quelli da misurare; mai sotto il 4%.
 * - **Contributori.** Le stesse corsie, per titolo: nessuna cifra, niente «Scaduto» né trimestre a
 *   parte (la pillola «Approvato · T1 2027» lo dice già), nessun giudizio sul team.
 * - **Per agente.** Gli stessi use case delle corsie per agente del titolo (`agentGroups`): quanti,
 *   gli euro contati e in che corsie stanno.
 *
 * Art. 15.4: corsie, ordini, gruppi e colori non leggono mai chi ha proposto; l'agente è il prefisso
 * del titolo, mai una persona.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { agentLabel, agentOfTitle, NO_AGENT_PARAM, type AgentParam } from "./agents.ts";
import { FIGURE_SEPARATOR, formatEuro, formatInteger, perYearText, shownPerYear, valueScreenText, type ValueParts } from "./format.ts";
import { quarterLabel, quarterOfDate, nextQuarter, WHEN_LATER_LABEL } from "./quarter.ts";
import type { QuarterCode } from "./types.ts";
import { byRealizedDesc, isContributorItem, quarterOfItem, roadmapGroupKey, roadmapGroupLabel, type AnyHubItem, type HubItem } from "./views.ts";

/** Le tre corsie, nell'ordine della pagina. */
export const LANE_KEYS = ["questo_trimestre", "prossimo_trimestre", "piu_avanti"] as const;
export type LaneKey = (typeof LANE_KEYS)[number];

/** Le card a schermo in una corsia; le altre dietro «Mostra gli altri N». */
export const LANE_PREVIEW = 5;
/** La barra più corta: 4% della scala, così anche una cifra piccola si vede. */
export const LANE_BAR_MIN = 0.04;
/** Un modello senza beneficio contato né da misurare. */
export const QUALITATIVE_RETURN_LABEL = "ritorno qualitativo";

/**
 * Le ancore della Panoramica: le corsie (anche «Per agente»), «In realizzazione» e «Realizzati».
 * Ci portano la striscia delle fasi in testa e «Vai alla Panoramica» di «Cosa serve».
 */
export const PANORAMA_SECTION_ID = Object.freeze({
  approvati: "panoramica-approvati",
  inRealizzazione: "panoramica-in-realizzazione",
  realizzati: "panoramica-realizzati",
});

export interface LaneEntry<T> {
  item: T;
  /** Trimestre passato senza avvio: «Scaduto». Solo per i revisori. */
  expired: boolean;
  /** «T3 2026» di uno scaduto, «T2 2027» di un trimestre dopo il prossimo; null altrimenti e ai contributori. */
  quarterNote: string | null;
}

export interface Lane<T> {
  key: LaneKey;
  /** «Questo trimestre · T4 2026», «Prossimo trimestre · T1 2027», «Più avanti». */
  label: string;
  /** «T4», «T1», «Più avanti»: i chip dei gruppi «Per agente». */
  short: string;
  entries: LaneEntry<T>[];
  /** Gli euro contati all'anno della corsia (revisori); null ai contributori. */
  countedEurYear: number | null;
}

export interface PanoramaLanes<T> {
  /** Sempre le tre corsie, nell'ordine di `LANE_KEYS`. */
  lanes: Lane<T>[];
  /** «In realizzazione», per titolo. */
  inProgress: T[];
  /** «Realizzati», dal più recente. */
  done: T[];
}

type LaneValue = Pick<ValueParts, "word" | "perYear" | "benefits">;

/** Il posto nell'ordine della corsia: 0 euro contati, 1 da misurare con un tetto, 2 Valore in parola, 3 il resto. */
export function laneValueRank(value: LaneValue): 0 | 1 | 2 | 3 {
  if (shownPerYear(value) !== null) return 0;
  if (value.benefits?.state === "da_misurare" && value.benefits.pendingEur > 0) return 1;
  if (value.word !== null) return 2;
  return 3;
}

/** La cifra che ordina e disegna la barra: gli euro contati, altrimenti il tetto da misurare, altrimenti 0. */
export function laneValueAmount(value: LaneValue): number {
  const perYear = shownPerYear(value);
  if (perYear) return perYear.amount;
  return laneValueRank(value) === 1 ? (value.benefits?.pendingEur ?? 0) : 0;
}

function byTitle(a: { title: string; id: string }, b: { title: string; id: string }): number {
  return a.title.localeCompare(b.title, "it-IT") || a.id.localeCompare(b.id);
}

/** Il codice in ordine di numero («XX-0002» prima di «XX-0010»); senza codice in fondo. */
function byCode(a: string | null, b: string | null): number {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  return a.localeCompare(b, "it-IT", { numeric: true });
}

/**
 * L'ordine di due use case nella corsia (revisori): la cifra (`laneValueRank`, poi l'importo, dal
 * più grande), per il Valore in parola il punteggio, tra due best practice le ore della stima di
 * Claude (senza in fondo), poi il codice, il titolo e l'id.
 */
export function compareLaneItems(a: HubItem, b: HubItem): number {
  const rank = laneValueRank(a.value) - laneValueRank(b.value);
  if (rank) return rank;
  const amount = laneValueAmount(b.value) - laneValueAmount(a.value);
  if (amount) return amount;
  if (laneValueRank(a.value) === 2) {
    const score = (b.value.score ?? -Infinity) - (a.value.score ?? -Infinity);
    // Due punteggi assenti danno NaN: pari.
    if (score) return score;
  }
  if (a.kind === "da_diffondere" && b.kind === "da_diffondere") {
    const hours =
      Number(a.claudeHoursPerYear === null) - Number(b.claudeHoursPerYear === null) || (b.claudeHoursPerYear ?? 0) - (a.claudeHoursPerYear ?? 0);
    if (hours) return hours;
  }
  return byCode(a.code, b.code) || byTitle(a, b);
}

/** La corsia di un trimestre rispetto a oggi, con «Scaduto» e il trimestre da scrivere sulla card. */
function laneOf(quarter: QuarterCode | null, today: string): { key: LaneKey; expired: boolean; quarterNote: string | null } {
  const group = roadmapGroupKey(quarter, today);
  switch (group) {
    case "scaduti":
      return { key: "questo_trimestre", expired: true, quarterNote: quarter ? quarterLabel(quarter) : null };
    case "questo_trimestre":
    case "prossimo_trimestre":
    case "piu_avanti":
      return { key: group, expired: false, quarterNote: null };
    default:
      return { key: "piu_avanti", expired: false, quarterNote: quarterLabel(group) };
  }
}

/** «T4»: il trimestre senza l'anno. */
function quarterShort(quarter: string): string {
  return quarterLabel(quarter).split(" ")[0];
}

/**
 * Le corsie della Panoramica dagli use case della pagina (già filtrati e proiettati): solo la fase
 * «Approvato», dei due tipi. I revisori: gli scaduti in cima a «Questo trimestre», poi l'ordine di
 * `compareLaneItems`; i contributori per titolo, senza «Scaduto» né trimestre a parte.
 */
export function buildLanes<T extends AnyHubItem>(items: readonly T[], today: string): PanoramaLanes<T> {
  const reviewers = items.every((item) => !isContributorItem(item));
  const entries: Record<LaneKey, LaneEntry<T>[]> = { questo_trimestre: [], prossimo_trimestre: [], piu_avanti: [] };
  for (const item of items) {
    if (item.phase !== "approvato") continue;
    const place = laneOf(quarterOfItem(item), today);
    entries[place.key].push(reviewers ? { item, expired: place.expired, quarterNote: place.quarterNote } : { item, expired: false, quarterNote: null });
  }
  const current = quarterOfDate(today);
  const shorts: Record<LaneKey, string> = {
    questo_trimestre: quarterShort(current),
    prossimo_trimestre: quarterShort(nextQuarter(current)),
    piu_avanti: WHEN_LATER_LABEL,
  };
  const lanes = LANE_KEYS.map((key): Lane<T> => {
    const list = entries[key];
    if (reviewers) {
      list.sort((a, b) => Number(b.expired) - Number(a.expired) || compareLaneItems(a.item as HubItem, b.item as HubItem));
    } else {
      list.sort((a, b) => byTitle(a.item, b.item));
    }
    return {
      key,
      label: roadmapGroupLabel(key, today),
      short: shorts[key],
      entries: list,
      countedEurYear: reviewers ? list.reduce((sum, entry) => sum + (shownPerYear((entry.item as HubItem).value)?.amount ?? 0), 0) : null,
    };
  });
  const inProgress = items.filter((item) => item.phase === "in_realizzazione").sort(byTitle);
  const done = items.filter((item) => item.phase === "realizzato").sort(byRealizedDesc);
  return { lanes, inProgress, done };
}

/** «24.500 € contati all'anno»: gli euro contati di una corsia. */
export function laneCountedText(eur: number): string {
  return `${formatEuro(eur)} contati all'anno`;
}

/** «3 use case · 24.500 € contati all'anno»; «3 use case» senza euro contati (e ai contributori). */
export function laneSummaryText(count: number, eur: number | null): string {
  const cases = `${formatInteger(count)} use case`;
  return eur ? `${cases}${FIGURE_SEPARATOR}${laneCountedText(eur)}` : cases;
}

/** «Mostra l'altro», «Mostra gli altri 3»: le card dietro le prime `LANE_PREVIEW`. */
export function laneMoreLabel(hidden: number): string {
  return hidden === 1 ? "Mostra l'altro" : `Mostra gli altri ${formatInteger(hidden)}`;
}

/** Il Valore di una card nella corsia: il testo e la barra; testo null quando la card scrive «Valore: …». */
export interface LaneValueView {
  text: string | null;
  bar: { kind: "contato" | "da_misurare"; amount: number } | null;
}

/**
 * Il Valore di una card: «12.250 € all'anno» con la barra piena; «da misurare · fino a 5.840 €» con
 * la barra tratteggiata; «ritorno qualitativo» senza barra; altrimenti testo null, e la card scrive
 * «Valore: Alto» o «Valore: da stimare».
 */
export function laneValueView(value: LaneValue): LaneValueView {
  const perYear = shownPerYear(value);
  if (perYear) return { text: perYearText(perYear), bar: { kind: "contato", amount: perYear.amount } };
  const benefits = value.benefits;
  if (benefits?.state === "da_misurare" && benefits.pendingEur > 0) return { text: valueScreenText(value), bar: { kind: "da_misurare", amount: benefits.pendingEur } };
  if (benefits?.state === "qualitativo") return { text: QUALITATIVE_RETURN_LABEL, bar: null };
  return { text: null, bar: null };
}

/**
 * La scala delle barre: la cifra più grande degli approvati (`laneValueAmount`, tetti da misurare
 * compresi). La pagina la calcola su tutte le schede dei revisori, senza filtri.
 */
export function laneBarScale(items: readonly Pick<HubItem, "phase" | "value">[]): number {
  let scale = 0;
  for (const item of items) if (item.phase === "approvato") scale = Math.max(scale, laneValueAmount(item.value));
  return scale;
}

/** «38.9%»: la larghezza della barra, tra il 4% e il 100%; null senza scala o senza cifra. */
export function laneBarWidth(amount: number, scale: number): string | null {
  if (!(scale > 0) || !(amount > 0)) return null;
  return `${(Math.min(1, Math.max(LANE_BAR_MIN, amount / scale)) * 100).toFixed(1)}%`;
}

// ─── «Per agente» ────────────────────────────────────────────────────

/** Gli use case delle corsie di un agente del titolo, o di quelli senza prefisso («Altri use case»). */
export interface AgentGroup {
  /** Il valore di `agente`: «LIBRA» o «altri». */
  param: AgentParam;
  /** «LIBRA»; null per «Altri use case». */
  agent: string | null;
  label: string;
  count: number;
  /** Gli euro contati all'anno, sommati. */
  perYearEur: number;
  /** Quanti hanno gli euro contati. */
  counted: number;
  /** In che corsie stanno, nell'ordine delle corsie; le corsie vuote no. */
  lanes: Array<{ key: LaneKey; short: string; label: string; count: number }>;
}

/**
 * I gruppi «Per agente» dalle corsie: un giro sulle corsie, nel loro ordine. In testa chi ha più
 * euro contati, poi più use case, poi il nome; «Altri use case» in fondo. Gli use case e gli euro
 * dei gruppi sono quelli delle corsie, né uno di più né uno di meno.
 */
export function agentGroups(lanes: readonly Lane<Pick<HubItem, "title" | "value">>[]): AgentGroup[] {
  const groups = new Map<AgentParam, AgentGroup>();
  for (const lane of lanes) {
    for (const { item } of lane.entries) {
      const agent = agentOfTitle(item.title);
      const param = agent ?? NO_AGENT_PARAM;
      let group = groups.get(param);
      if (!group) {
        group = { param, agent, label: agentLabel(param), count: 0, perYearEur: 0, counted: 0, lanes: [] };
        groups.set(param, group);
      }
      group.count += 1;
      const perYear = shownPerYear(item.value);
      if (perYear) {
        group.perYearEur += perYear.amount;
        group.counted += 1;
      }
      const chip = group.lanes.find((entry) => entry.key === lane.key);
      if (chip) chip.count += 1;
      else group.lanes.push({ key: lane.key, short: lane.short, label: lane.label, count: 1 });
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.agent === null) - Number(b.agent === null) || b.perYearEur - a.perYearEur || b.count - a.count || a.label.localeCompare(b.label, "it-IT"),
  );
}

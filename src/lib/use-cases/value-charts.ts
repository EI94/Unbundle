/**
 * I dati dei grafici di «Benefici e costi» (spec di Pierpaolo, 25/10/2026): la matrice a bolle
 * facilità × beneficio (dal menu «⋯»), le ore liberate e il pareggio della riga «Su tutto il
 * portafoglio» della Panoramica, la J-curve e «Valore per tipo di ritorno» di «Curva del valore»
 * (dal menu «⋯»). Qui solo numeri ed etichette; i componenti disegnano.
 *
 * - **Colore per gruppo** (`groupPalette`): i gruppi di `value_model.group`, dal più grande (più
 *   schede, poi più beneficio contato, poi il nome), prendono i primi tre colori; gli altri gruppi e
 *   le schede senza gruppo il grigio. Tre colori al massimo perché nelle bolle due colori qualsiasi
 *   possono stare vicini: oltre il terzo non restano distinguibili per chi non vede tutti i colori.
 *   Il grigio non è mai muto: la legenda dice quali gruppi ci sono dentro e se ci sono schede senza
 *   gruppo («Altri gruppi (Amministrazione) e senza gruppo»), e ogni bolla o segmento dice il suo
 *   gruppo. La tavolozza si calcola su tutte le schede del workspace, non su quelle filtrate: un
 *   filtro non ridipinge un gruppo. Senza nessun gruppo: un colore solo, senza legenda dei gruppi.
 *   In un workspace con gli agenti nei titoli (rilascio «Panoramica») il colore dice l'agente, e
 *   l'agente viene solo dal titolo, come il tag delle card: ogni bolla, ogni segmento e ogni punto
 *   della «Matrice Valore × Costo» ha il tono dell'agente del suo titolo (`markSlot`,
 *   `agentPointSlot`), il grigio senza. Il gruppo non dà né il colore né il nome: un gruppo «ORSA»
 *   non fa ORSA una scheda senza il prefisso, e i tre colori dei gruppi non ci sono. Il grigio ha un
 *   nome solo, «Altri use case», come in «Per agente» e nel filtro «Agente», e lo dice la legenda
 *   (`markLegend`); le bolle e i segmenti non dicono il loro colore, come i punti della matrice: il
 *   titolo dice già l'agente. Niente «Gruppo …», «Senza gruppo» o «Altri gruppi».
 * - **Bolle** (`buildBenefitBubbles`): le schede della vista con un modello e la facilità; x la
 *   facilità da 1 a 5, y il beneficio contato all'anno, raggio `5 + 13·√(avvio / avvio massimo)`
 *   in pixel; il bordo dice quando (questo trimestre, prossimo, più avanti) e il riempimento
 *   chiaro «da decidere».
 * - **Curva del valore** (`buildRoadmapValue`): le schede approvate o in realizzazione con un modello;
 *   mesi da `planMonths` sulle schede di tutto il workspace (`roadmapPlan`, come `get_use_case`
 *   del MCP: un filtro non sposta i mesi), curva da `jCurve` (`value-calc.ts`), ore contate,
 *   pareggio. Il costo di avvio entra nella curva con la regola di «Costo impegnato»
 *   (`roadmapTotals`): in realizzazione, oppure approvate «Da costruire»; una best practice
 *   approvata «Da diffondere» porta benefici e ricorrenti, non l'avvio.
 * - **Valore per tipo di ritorno** (`buildLeverChart`): una riga per ognuno degli 8 tipi, un
 *   segmento per use case dal più grande; le voci da misurare a parte (fuori dal totale) e le
 *   qualitative contate.
 *
 * Solo per i revisori: le schede arrivano già proiettate (`HubItem.valueModel`). Nessun
 * ordinamento o conteggio per persona. Nessun arrotondamento qui, tranne le etichette e il totale
 * di una riga di «Valore per tipo di ritorno», somma delle cifre dei suoi segmenti già arrotondate.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { LEVERS, type Lever } from "../uc/vocab.ts";
import { NO_AGENT_LABEL, agentOfTitle, agentToneOf, paletteHasAgents, shortRefOf, type AgentPalette, type AgentTone } from "./agents.ts";
import { FIGURE_SEPARATOR, formatEuro, formatInteger, lowerFirst, roundAmount } from "./format.ts";
import type { Origin } from "./types.ts";
import { CURVE_EPSILON, componentResult, jCurve, monthLabel, planMonths, valueTotals, type JCurve, type PlannedMonths, type ValueTotals } from "./value-calc.ts";
import { LEVER_LABELS, VALUE_CONFIDENCE_LABELS, type MonthCode, type ValueComponent, type ValueModel, type ValueParams } from "./value-model.ts";
import { isPriorityCandidate, roadmapGroupKey, type HubChartParam, type HubItem } from "./views.ts";

// ─── Gruppi e colori ─────────────────────────────────────────────────

/** Quanti gruppi hanno un colore loro. */
export const GROUP_COLOR_SLOTS = 3;

/** Il colore dell'agente del titolo: il tono del suo tag (`--uc-agente-*`). */
export type AgentGroupSlot = `agente-${AgentTone}`;

/**
 * Il colore di un segno dei grafici: 1, 2, 3, il colore del gruppo, oppure 0, il grigio degli altri
 * gruppi e delle schede senza gruppo; con gli agenti nei titoli, il tono dell'agente del titolo
 * (`agente-3`) o il grigio.
 */
export type GroupSlot = 0 | 1 | 2 | 3 | AgentGroupSlot;

export interface GroupPalette {
  /** Gruppo → colore (1-3): i tre gruppi più grandi. Gli altri gruppi e «senza gruppo» sono grigi. */
  slots: Readonly<Record<string, 1 | 2 | 3>>;
  /** Nessuna scheda ha un gruppo: un colore solo (1), senza legenda dei gruppi. */
  single: boolean;
  /**
   * Con gli agenti nei titoli: i toni del workspace (`workspaceAgentPalette`). Ogni bolla e ogni
   * segmento ha il tono dell'agente del suo titolo (`markSlot`), mai del gruppo. null senza agenti: i
   * colori dei gruppi.
   */
  agents: AgentPalette | null;
}

/** Una scheda per i colori dei gruppi: il modello. */
export type GroupPaletteItem = Pick<HubItem, "valueModel">;

/** Un segno di un grafico dei gruppi, una bolla o un segmento: il titolo (l'agente) e il gruppo. */
export interface GroupMark {
  title: string;
  group: string | null;
}

/** I gruppi senza un colore loro, in grigio. */
export const OTHER_GROUPS_LABEL = "Altri gruppi";
/** Le schede senza gruppo, in grigio. */
export const NO_GROUP_LABEL = "Senza gruppo";
/** Quanti nomi degli altri gruppi dice la legenda prima di «e altri N». */
export const OTHER_GROUPS_NAMED = 3;

/** Il gruppo di un modello, senza spazi ai lati; null senza gruppo. */
export function groupOf(model: Pick<ValueModel, "group"> | null | undefined): string | null {
  const group = model?.group?.trim();
  return group ? group : null;
}

/** «Gruppo Vendite», «Senza gruppo»: il gruppo di una bolla o di un segmento, a parole. */
export function groupText(group: string | null): string {
  return group ? `Gruppo ${group}` : NO_GROUP_LABEL;
}

/**
 * I colori dei gruppi, dalle schede del workspace (tutte, non solo quelle filtrate): i gruppi dal
 * più grande (più schede con un modello; a pari schede più beneficio contato, se ci sono le
 * ipotesi `params`; poi il nome), i primi tre con un colore, gli altri in grigio. Con gli agenti dei
 * titoli (`agents`, `workspaceAgentPalette`) i gruppi non hanno colori: ogni segno prende il tono
 * dell'agente del suo titolo (`markSlot`), come il tag della sua card.
 */
export function groupPalette(items: readonly GroupPaletteItem[], params?: ValueParams | null, agents?: AgentPalette | null): GroupPalette {
  if (paletteHasAgents(agents)) return { slots: {}, single: false, agents };
  const size = new Map<string, { cards: number; benefit: number }>();
  for (const item of items) {
    const group = groupOf(item.valueModel);
    if (!group || !item.valueModel) continue;
    const entry = size.get(group) ?? { cards: 0, benefit: 0 };
    entry.cards += 1;
    if (params) entry.benefit += valueTotals(item.valueModel, params).benefit;
    size.set(group, entry);
  }
  const sorted = [...size.entries()]
    .sort(([a, sa], [b, sb]) => sb.cards - sa.cards || sb.benefit - sa.benefit || a.localeCompare(b, "it-IT"))
    .map(([group]) => group);
  const slots: Record<string, 1 | 2 | 3> = {};
  sorted.slice(0, GROUP_COLOR_SLOTS).forEach((group, index) => {
    slots[group] = (index + 1) as 1 | 2 | 3;
  });
  return { slots, single: sorted.length === 0, agents: null };
}

/** Il colore di un gruppo, senza agenti nei titoli: 1, 2, 3 o il grigio; 1 con un colore solo. */
export function groupSlot(palette: GroupPalette, group: string | null): GroupSlot {
  if (palette.single) return 1;
  return group !== null && Object.prototype.hasOwnProperty.call(palette.slots, group) ? palette.slots[group] : 0;
}

/**
 * Il colore di una bolla o di un segmento: con gli agenti nei titoli il tono dell'agente del suo
 * titolo, come il tag e il punto della «Matrice Valore × Costo» (`agentPointSlot`), il grigio senza;
 * altrimenti il colore del suo gruppo (`groupSlot`).
 */
export function markSlot(palette: GroupPalette, mark: GroupMark): GroupSlot {
  return palette.agents ? (agentPointSlot(palette.agents, mark.title) ?? 0) : groupSlot(palette, mark.group);
}

/**
 * Il gruppo di una bolla o di un segmento, a parole: «Gruppo Vendite», «Senza gruppo». null con un
 * colore solo, e con gli agenti nei titoli: il colore è dell'agente, che il titolo dice già, e lo
 * dice la legenda, come per i punti della matrice.
 */
export function groupLabelOf(palette: GroupPalette, group: string | null): string | null {
  if (palette.single || palette.agents) return null;
  return groupText(group);
}

export interface GroupLegendEntry {
  slot: GroupSlot;
  label: string;
}

/**
 * Il grigio a parole: «Altri gruppi (Amministrazione, Logistica)», «Senza gruppo», «Altri gruppi
 * (Amministrazione) e senza gruppo»; oltre tre nomi «… e altri 2».
 */
export function otherGroupsLabel(others: readonly string[], ungrouped: boolean): string {
  if (!others.length) return NO_GROUP_LABEL;
  const named = others.slice(0, OTHER_GROUPS_NAMED);
  const rest = others.length - named.length;
  const list = rest > 0 ? `${named.join(", ")} e altri ${rest}` : named.join(", ");
  const label = `${OTHER_GROUPS_LABEL} (${list})`;
  return ungrouped ? `${label} e senza gruppo` : label;
}

/**
 * La legenda dei gruppi di un grafico, senza agenti nei titoli: solo i colori che ci sono,
 * nell'ordine dei colori; in fondo il grigio, con i nomi dei gruppi che ci finiscono e «senza
 * gruppo» se ci sono schede senza.
 */
export function groupLegend(palette: GroupPalette, groups: readonly (string | null)[]): GroupLegendEntry[] {
  if (palette.single) return [];
  const present = new Set(groups.map((group) => groupSlot(palette, group)));
  const entries: GroupLegendEntry[] = Object.entries(palette.slots)
    .filter(([, slot]) => present.has(slot))
    .sort(([, a], [, b]) => a - b)
    .map(([label, slot]) => ({ slot, label }));
  if (present.has(0)) {
    const others = [...new Set(groups.filter((group): group is string => group !== null && groupSlot(palette, group) === 0))].sort((a, b) => a.localeCompare(b, "it-IT"));
    entries.push({ slot: 0, label: otherGroupsLabel(others, groups.includes(null)) });
  }
  return entries;
}

/**
 * La legenda di un grafico dei gruppi (le bolle, «Valore per tipo di ritorno»): con gli agenti nei
 * titoli quella della «Matrice Valore × Costo» (`agentPointLegend`: gli agenti dei segni, poi «Altri
 * use case»), altrimenti quella dei gruppi (`groupLegend`).
 */
export function markLegend(palette: GroupPalette, marks: readonly GroupMark[]): GroupLegendEntry[] {
  return palette.agents ? agentPointLegend(palette.agents, marks.map((mark) => mark.title)) : groupLegend(palette, marks.map((mark) => mark.group));
}

// ─── I colori per agente: punti, bolle e segmenti ────────────────────

/**
 * Il colore di un punto della «Matrice Valore × Costo», e di una bolla o di un segmento (`markSlot`),
 * in un workspace con gli agenti nei titoli (`paletteHasAgents`): il tono dell'agente del titolo,
 * come il suo tag; il grigio (0) senza agente o per un agente senza tono (solo proposte). null senza
 * agenti: la matrice resta per origine.
 */
export function agentPointSlot(agents: AgentPalette | null | undefined, title: string): GroupSlot | null {
  if (!paletteHasAgents(agents)) return null;
  const tone = agentToneOf(agents, agentOfTitle(title));
  return tone ? `agente-${tone}` : 0;
}

/**
 * La legenda della «Matrice Valore × Costo» per agente, anche delle bolle e dei segmenti
 * (`markLegend`): gli agenti con un tono che hanno un punto, in ordine alfabetico come i toni, poi il
 * grigio «Altri use case» se un punto non ha un agente con un tono. Vuota senza agenti nei titoli.
 */
export function agentPointLegend(agents: AgentPalette | null | undefined, titles: readonly string[]): GroupLegendEntry[] {
  if (!paletteHasAgents(agents)) return [];
  const shown = new Map<string, AgentTone>();
  let others = false;
  for (const title of titles) {
    const agent = agentOfTitle(title);
    const tone = agentToneOf(agents, agent);
    if (agent && tone) shown.set(agent, tone);
    else others = true;
  }
  const entries: GroupLegendEntry[] = [...shown.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "it-IT"))
    .map(([agent, tone]) => ({ slot: `agente-${tone}` as const, label: agent }));
  if (others) entries.push({ slot: 0, label: NO_AGENT_LABEL });
  return entries;
}

// ─── Scale ───────────────────────────────────────────────────────────

export interface NiceScale {
  min: number;
  max: number;
  step: number;
  /** Da `min` a `max`, ogni `step`. */
  ticks: number[];
}

/**
 * Una scala con tacche tonde (1, 2, 2,5 o 5 per una potenza di dieci), da `count` a `count + 1`
 * intervalli circa, che comprende `lo`, `hi` e lo zero. Senza ampiezza: da 0 a `fallback`.
 */
export function niceScale(lo: number, hi: number, count = 4, fallback = 1000): NiceScale {
  let low = Math.min(0, lo);
  let high = Math.max(0, hi);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high - low <= 0) {
    low = 0;
    high = fallback;
  }
  const raw = (high - low) / (Math.max(1, count) + 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
  const first = Math.floor(low / step + 1e-9);
  const last = Math.ceil(high / step - 1e-9);
  const ticks: number[] = [];
  for (let k = first; k <= last; k++) ticks.push(k * step);
  return { min: first * step, max: last * step, step, ticks };
}

/**
 * La scala della J-curve: quella di `niceScale`, ma la parte piccola (sotto o sopra lo zero) che
 * non arriva a un passo si ferma al quarto di passo più vicino. Un avvio di −3.710 € sotto una
 * curva che sale a 60.000 € scende a −5.000 €, non a −20.000 €, e la J resta leggibile. La tacca
 * di quel bordo si scrive solo se sta abbastanza lontana dallo zero (un decimo della scala).
 */
export function curveScale(lo: number, hi: number): NiceScale {
  const scale = niceScale(lo, hi);
  const sub = scale.step / 4;
  const min = lo < 0 && -lo < scale.step ? -Math.ceil(-lo / sub - 1e-9) * sub : scale.min;
  const max = hi > 0 && hi < scale.step ? Math.ceil(hi / sub - 1e-9) * sub : scale.max;
  const span = max - min;
  const ticks = scale.ticks.filter((tick) => tick >= min - 1e-9 && tick <= max + 1e-9);
  const farFromZero = (edge: number) => span > 0 && Math.abs(edge) / span >= 0.1;
  if (!ticks.includes(min) && farFromZero(min)) ticks.unshift(min);
  if (!ticks.includes(max) && farFromZero(max)) ticks.push(max);
  return { min, max, step: scale.step, ticks };
}

// ─── Bolle: facilità × beneficio ─────────────────────────────────────

/** Il bordo della bolla: quando si fa. «da_decidere» ha il riempimento chiaro. */
export type BubbleWhen = "questo_trimestre" | "prossimo_trimestre" | "piu_avanti" | "da_decidere";

export const BUBBLE_WHEN_LABEL: Readonly<Record<BubbleWhen, string>> = Object.freeze({
  questo_trimestre: "questo trimestre",
  prossimo_trimestre: "prossimo trimestre",
  piu_avanti: "più avanti",
  da_decidere: "da decidere",
});

/** Approvata per un trimestre già passato: «questo trimestre · scaduto», come il tag «Scaduto» della Panoramica. */
export const BUBBLE_EXPIRED_LABEL = "scaduto";

/** «questo trimestre», «questo trimestre · scaduto», «più avanti»… */
export function bubbleWhenText(bubble: Pick<BenefitBubble, "when" | "expired">): string {
  return bubble.expired ? `${BUBBLE_WHEN_LABEL[bubble.when]}${FIGURE_SEPARATOR}${BUBBLE_EXPIRED_LABEL}` : BUBBLE_WHEN_LABEL[bubble.when];
}

/** Raggio minimo e quanto cresce con il costo di avvio, in pixel. */
export const BUBBLE_RADIUS = Object.freeze({ min: 5, grow: 13 });

/** `5 + 13·√(avvio / avvio massimo)`; con l'avvio massimo a zero, il minimo. */
export function bubbleRadius(oneoff: number, maxOneoff: number): number {
  if (!(maxOneoff > 0) || !(oneoff > 0)) return BUBBLE_RADIUS.min;
  return BUBBLE_RADIUS.min + BUBBLE_RADIUS.grow * Math.sqrt(Math.min(1, oneoff / maxOneoff));
}

/**
 * Quando: approvata con il trimestre di oggi (o già passato) «questo trimestre», col prossimo
 * «prossimo trimestre», più in là o senza trimestre «più avanti»; da valutare «da decidere».
 */
export function bubbleWhen(item: Pick<HubItem, "phase" | "targetQuarter">, today: string): BubbleWhen {
  if (item.phase !== "approvato") return item.phase === "in_realizzazione" ? "questo_trimestre" : "da_decidere";
  const key = roadmapGroupKey(item.targetQuarter, today);
  if (key === "scaduti" || key === "questo_trimestre") return "questo_trimestre";
  if (key === "prossimo_trimestre") return "prossimo_trimestre";
  return "piu_avanti";
}

export interface BenefitBubble {
  id: string;
  code: string | null;
  title: string;
  /** Facilità, da 1 a 5. */
  ease: number;
  /** Beneficio contato, euro all'anno. */
  benefit: number;
  /** Euro all'anno ancora da misurare (fuori dal beneficio). */
  pendingEur: number;
  /** Ore contate all'anno. */
  hours: number;
  /** Costo di avvio e ricorrenti all'anno. */
  oneoff: number;
  run: number;
  /** Raggio in pixel. */
  r: number;
  group: string | null;
  /** «Gruppo Vendite», «Senza gruppo»; null con un colore solo o con gli agenti nei titoli (`groupLabelOf`). */
  groupLabel: string | null;
  slot: GroupSlot;
  when: BubbleWhen;
  /** Approvata con un trimestre passato e non partita («Scaduto» nella Panoramica): il bordo resta di questo trimestre. */
  expired: boolean;
}

export interface BenefitBubbles {
  /** Dalla più grande alla più piccola: le piccole restano sopra. */
  bubbles: BenefitBubble[];
  /** L'asse del beneficio, da 0. */
  scale: NiceScale;
  /** Schede della vista con «Benefici e costi» ma senza facilità: non sono nel grafico. */
  withoutEase: number;
}

/**
 * La matrice a bolle facilità × beneficio del menu «⋯» (nella Panoramica), dalle schede di «Da
 * costruire» (`isPriorityCandidate`) con un modello. Senza facilità una scheda non ha una x: si conta in `withoutEase`.
 */
export function buildBenefitBubbles(items: readonly HubItem[], params: ValueParams, today: string, palette: GroupPalette): BenefitBubbles {
  const drafts: Array<Omit<BenefitBubble, "r">> = [];
  let withoutEase = 0;
  for (const item of items) {
    if (!isPriorityCandidate(item) || !item.valueModel) continue;
    const model = item.valueModel;
    if (typeof model.ease !== "number") {
      withoutEase += 1;
      continue;
    }
    const totals = valueTotals(model, params);
    const group = groupOf(model);
    drafts.push({
      id: item.id,
      code: item.code,
      title: item.title,
      ease: model.ease,
      benefit: totals.benefit,
      pendingEur: totals.pendingEur,
      hours: totals.hours,
      oneoff: totals.oneoff,
      run: totals.run,
      group,
      groupLabel: groupLabelOf(palette, group),
      slot: markSlot(palette, { title: item.title, group }),
      when: bubbleWhen(item, today),
      expired: item.phase === "approvato" && roadmapGroupKey(item.targetQuarter, today) === "scaduti",
    });
  }
  const maxOneoff = drafts.reduce((max, bubble) => Math.max(max, bubble.oneoff), 0);
  const bubbles = drafts
    .map((bubble) => ({ ...bubble, r: bubbleRadius(bubble.oneoff, maxOneoff) }))
    .sort((a, b) => b.r - a.r || b.benefit - a.benefit || (a.code ?? "").localeCompare(b.code ?? "") || a.id.localeCompare(b.id));
  const maxBenefit = bubbles.reduce((max, bubble) => Math.max(max, bubble.benefit), 0);
  return { bubbles, scale: niceScale(0, maxBenefit), withoutEase };
}

/**
 * Almeno una scheda da mettere in ordine («Da costruire», `isPriorityCandidate`) ha «Benefici e
 * costi»: il menu «⋯» offre «Matrice Facilità × Beneficio».
 */
export function hasPriorityValueModels(items: readonly HubItem[]): boolean {
  return items.some((item) => item.valueModel !== null && isPriorityCandidate(item));
}

/**
 * Le due matrici del menu «⋯»: «Matrice Valore × Costo» se una scheda è da mettere in ordine («Da
 * costruire», `isPriorityCandidate`), «Matrice Facilità × Beneficio» se una di queste ha «Benefici e
 * costi». Nessuna: nessuna matrice. Tutti i grafici del menu li dà `hubCharts`.
 */
export function priorityCharts(items: readonly HubItem[]): HubChartParam[] {
  if (!items.some(isPriorityCandidate)) return [];
  return hasPriorityValueModels(items) ? ["matrice", "benefici"] : ["matrice"];
}

/**
 * I grafici del menu «⋯» (solo revisori), aperti nella Panoramica al posto delle corsie, su tutte le
 * schede del workspace: un filtro non toglie una voce. Le due matrici di `priorityCharts`, poi
 * «Curva del valore» quando una scheda approvata o in realizzazione ha «Benefici e costi»
 * (`roadmapValueItems`).
 */
export function hubCharts(items: readonly HubItem[]): HubChartParam[] {
  return roadmapValueItems(items).length ? [...priorityCharts(items), "curva"] : priorityCharts(items);
}

// ─── Curva del valore e Panoramica: ore, J-curve, pareggio ───────────

/**
 * Le schede che entrano nei conti di «Curva del valore» e della riga «Su tutto il portafoglio»:
 * approvate o in realizzazione, con un modello.
 */
export function roadmapValueItems(items: readonly HubItem[]): HubItem[] {
  return items.filter((item) => item.valueModel !== null && (item.phase === "approvato" || item.phase === "in_realizzazione"));
}

/**
 * L'avvio della scheda entra nei costi della curva? La regola di «Costo impegnato»
 * (`roadmapTotals`): in realizzazione, oppure approvata «Da costruire».
 */
export function isCommittedCost(item: Pick<HubItem, "phase" | "kind">): boolean {
  return item.phase === "in_realizzazione" || (item.phase === "approvato" && item.kind === "da_costruire");
}

/**
 * I mesi di avvio e di entrata in uso delle schede della curva con un modello, calcolati su
 * `items` (tutte le schede dei revisori del workspace, non quelle filtrate: «Più avanti» dipende
 * dalle altre schede, e un filtro non deve spostarlo). Gli stessi di `get_use_case` del MCP.
 */
export function roadmapPlan(items: readonly HubItem[], params: Pick<ValueParams, "originMonth" | "buildMonths">): Map<string, PlannedMonths> {
  const scoped = roadmapValueItems(items);
  const months = planMonths(
    scoped.map((item) => ({
      id: item.id,
      stage: item.phase === "in_realizzazione" ? ("in_realizzazione" as const) : ("approvato" as const),
      targetQuarter: item.targetQuarter,
      plan: item.valueModel!.plan ?? null,
    })),
    params,
  );
  return new Map(months.map((planned) => [planned.id, planned]));
}

export interface RoadmapValueCard {
  id: string;
  code: string | null;
  title: string;
  origin: Origin;
  start: number;
  goLive: number;
  startMonth: MonthCode;
  goLiveMonth: MonthCode;
  benefit: number;
  hours: number;
  /** L'avvio che entra nella curva: zero per una best practice «Da diffondere» (`isCommittedCost`). */
  oneoff: number;
  run: number;
}

/** Una linea tratteggiata della J-curve: le schede che entrano in uso quel mese. */
export interface GoLiveMark {
  /** Indice del mese, da 0 a `horizonMonths`. */
  index: number;
  month: MonthCode;
  /** «gen 27». */
  label: string;
  /** I codici (o i titoli, senza codice) delle schede. */
  names: string[];
}

export interface RoadmapValue {
  cards: RoadmapValueCard[];
  /** Ore contate all'anno, sommate. */
  hours: number;
  curve: JCurve;
  goLives: GoLiveMark[];
  /** Il mese più basso della curva (l'investimento massimo), se va sotto zero. */
  low: { index: number; month: MonthCode; label: string; net: number } | null;
  /**
   * «Pareggio»: «mag 27»; «subito» se la curva non va mai sotto zero e sale; «oltre ott 28» se
   * a fine orizzonte è ancora sotto zero; null se resta a zero (niente costi, niente benefici).
   */
  breakevenText: string | null;
}

/** Pareggio senza attesa: la curva non va mai sotto zero. */
export const BREAKEVEN_NOW = "subito";

/** «oltre ott 28»: a fine orizzonte la curva è ancora sotto zero. */
export function beyondHorizonText(month: MonthCode): string {
  return `oltre ${monthLabel(month)}`;
}

/** Il nome di uno use case sulla curva: il tag dell'agente come nelle card («LIBRA L1»), altrimenti il codice o il titolo. */
function nameOf(card: Pick<HubItem, "code" | "title">): string {
  return shortRefOf(card) ?? card.title;
}

/**
 * I conti di «Curva del valore» per le schede con un modello (`roadmapValueItems`): mesi di avvio e di
 * entrata in uso (`planMonths`: il piano della scheda, oppure il trimestre approvato, l'origine,
 * «più avanti»), la J-curve (`jCurve`), le ore e il pareggio. null senza schede con un modello.
 *
 * `opts.plan`: i mesi di `roadmapPlan` su tutte le schede del workspace; la pagina lo passa
 * sempre, così una vista filtrata disegna le sue schede con gli stessi mesi. Senza, i mesi si
 * calcolano sulle schede ricevute. L'avvio entra solo con `isCommittedCost`.
 */
export function buildRoadmapValue(items: readonly HubItem[], params: ValueParams, opts: { plan?: ReadonlyMap<string, PlannedMonths> } = {}): RoadmapValue | null {
  const scoped = roadmapValueItems(items);
  if (!scoped.length) return null;
  const own = roadmapPlan(scoped, params);
  const cards: RoadmapValueCard[] = scoped.map((item) => {
    const totals: ValueTotals = valueTotals(item.valueModel!, params);
    const planned = opts.plan?.get(item.id) ?? own.get(item.id)!;
    return {
      id: item.id,
      code: item.code,
      title: item.title,
      origin: item.origin,
      start: planned.start,
      goLive: planned.goLive,
      startMonth: planned.startMonth,
      goLiveMonth: planned.goLiveMonth,
      benefit: totals.benefit,
      hours: totals.hours,
      oneoff: isCommittedCost(item) ? totals.oneoff : 0,
      run: totals.run,
    };
  });
  const curve = jCurve(cards, params);
  const marks = new Map<number, GoLiveMark>();
  for (const card of [...cards].sort((a, b) => a.goLive - b.goLive || nameOf(a).localeCompare(nameOf(b), "it-IT"))) {
    if (card.goLive < 0 || card.goLive > params.horizonMonths) continue;
    const mark = marks.get(card.goLive) ?? { index: card.goLive, month: curve.months[card.goLive], label: monthLabel(curve.months[card.goLive]), names: [] };
    mark.names.push(nameOf(card));
    marks.set(card.goLive, mark);
  }
  // La stessa tolleranza del pareggio (`CURVE_EPSILON`): −1e-13 è zero, non un investimento.
  let lowIndex = 0;
  curve.net.forEach((net, index) => {
    if (net < curve.net[lowIndex]) lowIndex = index;
  });
  const low =
    curve.net[lowIndex] < -CURVE_EPSILON ? { index: lowIndex, month: curve.months[lowIndex], label: monthLabel(curve.months[lowIndex]), net: curve.net[lowIndex] } : null;
  const end = curve.net[curve.net.length - 1];
  let breakevenText: string | null;
  if (curve.breakevenMonth) breakevenText = monthLabel(curve.breakevenMonth);
  else if (low && end < -CURVE_EPSILON) breakevenText = beyondHorizonText(curve.months[curve.months.length - 1]);
  else if (!low && end > CURVE_EPSILON) breakevenText = BREAKEVEN_NOW;
  else breakevenText = null;
  return {
    cards,
    hours: cards.reduce((sum, card) => sum + card.hours, 0),
    curve,
    goLives: [...marks.values()].sort((a, b) => a.index - b.index),
    low,
    breakevenText,
  };
}

// ─── Valore per tipo di ritorno ──────────────────────────────────────

/** Una voce nel popover di un segmento: «Smistamento delle richieste · 116 h · 4.043 € · ipotesi». */
export interface LeverComponentLine {
  key: string;
  label: string;
  /** «116 h · 4.043 €», «535 €», «qualitativo». */
  amount: string;
  /** «ipotesi», «da misurare»…: minuscola, dopo il separatore («· ipotesi»), come in «Cosa serve». */
  confidence: string;
  /** Entra nel totale. Le qualitative no. */
  counted: boolean;
  kind: ValueComponent["kind"];
}

export interface LeverSegment {
  id: string;
  code: string | null;
  title: string;
  /** Il gruppo dello use case (`groupOf`); null senza gruppo. */
  group: string | null;
  /** «Gruppo Vendite», «Senza gruppo»; null con un colore solo o con gli agenti nei titoli (`groupLabelOf`). */
  groupLabel: string | null;
  slot: GroupSlot;
  /** Euro all'anno di questo tipo per questo use case. */
  eur: number;
  /** Tutte le voci di questo tipo dello use case. */
  components: LeverComponentLine[];
}

export interface LeverRow {
  lever: Lever;
  /** «Risparmio di tempo». */
  label: string;
  /** Contato, euro all'anno: la somma delle cifre dei segmenti, ognuna arrotondata all'euro. */
  total: number;
  /** Un segmento per use case, dal più grande. */
  segments: LeverSegment[];
  /** Da misurare: fuori dal totale, tratteggiato. */
  pendingTotal: number;
  pending: LeverSegment[];
  /** Use case con voci qualitative di questo tipo (il popover li elenca). */
  qualitative: LeverSegment[];
  /** Quante voci qualitative di questo tipo, su tutti gli use case: «(2 qualitativi)». */
  qualitativeCount: number;
}

export interface LeverChart {
  /** Gli 8 tipi, nell'ordine di `LEVERS`. */
  rows: LeverRow[];
  /** La riga più lunga (contato più da misurare): la scala comune delle barre. */
  max: number;
}

/** «116 h · 4.043 €», «535 €», «qualitativo». */
export function componentAmountText(component: ValueComponent, params: Pick<ValueParams, "hourlyCostEur" | "includeUnmeasured">): string {
  if (component.kind === "qualitativo") return "qualitativo";
  const result = componentResult(component, params);
  return component.kind === "ore" ? `${formatInteger(result.hours)} h${FIGURE_SEPARATOR}${formatEuro(result.eur)}` : formatEuro(result.eur);
}

function bySize(a: LeverSegment, b: LeverSegment): number {
  return b.eur - a.eur || (a.code ?? "").localeCompare(b.code ?? "") || a.title.localeCompare(b.title, "it-IT") || a.id.localeCompare(b.id);
}

/**
 * «Valore per tipo di ritorno»: per ognuno degli 8 tipi, un segmento per use case con il suo
 * beneficio contato di quel tipo, dal più grande; a parte la parte da misurare (fuori dal totale)
 * e gli use case con voci qualitative. Le schede sono quelle della curva (`roadmapValueItems`).
 */
export function buildLeverChart(items: readonly HubItem[], params: ValueParams, palette: GroupPalette): LeverChart {
  const rows: LeverRow[] = LEVERS.map((lever) => ({ lever, label: LEVER_LABELS[lever], total: 0, segments: [], pendingTotal: 0, pending: [], qualitative: [], qualitativeCount: 0 }));
  const rowOf = new Map(rows.map((row) => [row.lever, row]));
  for (const item of roadmapValueItems(items)) {
    const model = item.valueModel!;
    const totals = valueTotals(model, params);
    const group = groupOf(model);
    const slot = markSlot(palette, { title: item.title, group });
    for (const lever of LEVERS) {
      const components = model.components.filter((component) => component.lever === lever);
      if (!components.length) continue;
      const row = rowOf.get(lever)!;
      const lines: LeverComponentLine[] = components.map((component, index) => {
        const result = totals.components[model.components.indexOf(component)] ?? componentResult(component, params);
        return {
          key: `${component.key}-${index}`,
          label: component.label,
          amount: componentAmountText(component, params),
          confidence: lowerFirst(VALUE_CONFIDENCE_LABELS[component.confidence]),
          counted: component.kind !== "qualitativo" && result.counted,
          kind: component.kind,
        };
      });
      const base = { id: item.id, code: item.code, title: item.title, group, groupLabel: groupLabelOf(palette, group), slot, components: lines };
      if (totals.byLever[lever] > 0) {
        row.total += roundAmount(totals.byLever[lever]);
        row.segments.push({ ...base, eur: totals.byLever[lever] });
      }
      if (totals.pendingByLever[lever] > 0) {
        row.pendingTotal += totals.pendingByLever[lever];
        row.pending.push({ ...base, eur: totals.pendingByLever[lever] });
      }
      if (totals.qualitativeByLever[lever] > 0) {
        row.qualitative.push({ ...base, eur: 0 });
        row.qualitativeCount += totals.qualitativeByLever[lever];
      }
    }
  }
  for (const row of rows) {
    row.segments.sort(bySize);
    row.pending.sort(bySize);
    row.qualitative.sort(bySize);
  }
  return { rows, max: rows.reduce((max, row) => Math.max(max, row.total + row.pendingTotal), 0) };
}

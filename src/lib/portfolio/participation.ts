/**
 * «Partecipazione per area» nella pagina «Raccolta & ranking»: quante proposte arrivano da
 * ogni area (e da ogni società del gruppo), mai da chi. Si valuta l'idea, mai la persona:
 * niente conteggi né classifiche per chi propone. Qui entrano solo conteggi già aggregati
 * dal database per area e per società; nessun campo di chi propone esiste in questi tipi.
 *
 * Regole:
 *  - la scheda c'è solo se la guida del connettore ha aree: senza, ogni proposta finirebbe
 *    in «Altre aree» o in «Area non indicata» e la scheda non direbbe nulla;
 *  - l'area è quella scritta sulla proposta (`use_cases.intake.area`, un id della guida) e
 *    si mostra con l'etichetta della guida, mai con l'id. Un id che la guida non conosce va
 *    in «Altre aree»; una proposta senza area va in «Area non indicata». Aree con la stessa
 *    etichetta sono una riga sola; un'etichetta uguale a «Altre aree» o «Area non indicata»
 *    va in «Altre aree»;
 *  - gruppi piccoli: un'area con meno di 3 proposte va in «Altre aree», così un conteggio
 *    non indica una persona; anche «Area non indicata» sotto 3 va in «Altre aree»;
 *  - società («Per società:»): si mostrano per nome quelle con almeno 3 proposte; le altre
 *    vanno in «Altre società», che unisce almeno due società. La somma della riga è sempre
 *    il totale delle proposte con una società, così nessun numero nascosto si ricava per
 *    differenza dalle aree. Quindi, se resta fuori una società sola, si unisce alla più
 *    piccola fra quelle mostrate, purché ne restino almeno due per nome; altrimenti la riga
 *    non c'è. «entrambe» vuol dire tutte e due le società: si mostra come «Entrambe le
 *    società» da 3 proposte in su, non entra mai in «Altre società» e, sotto 3, la riga non
 *    c'è. La riga non c'è neanche con 1 o 2 proposte senza società: sarebbero il totale
 *    delle aree meno la riga (per TopJet, le proposte del modulo e di Slack, senza area).
 *    Il nome si scrive come nel nome del workspace della guida («TopJet e Aliserio» →
 *    «TopJet»), altrimenti dall'id;
 *  - ordine: dalla più alta, a parità per nome; «Altre aree» e «Area non indicata» in coda,
 *    come «Altre società» ed «Entrambe le società».
 *
 * Modulo puro: lo usano la query della pagina e i test.
 */

/** Sotto questa soglia un gruppo non si mostra con il suo nome. */
export const PARTICIPATION_MIN_GROUP = 3;

/**
 * Canali in cui una persona propone alla raccolta (`use_cases.source`): connettore Claude,
 * REST e server MCP stdio, modulo di Unbundle, Slack, idea portata da un corso. Restano
 * fuori gli use case generati dall'AI di Unbundle (fonte vuota) e quelli importati dalla
 * diagnostica AI Readiness.
 */
export const PARTICIPATION_SOURCES = Object.freeze([
  "claude_connector",
  "claude_mcp",
  "web_proposed",
  "slack_proposed",
  "learning",
] as const);

export const OTHER_AREAS_LABEL = "Altre aree";
export const NO_AREA_LABEL = "Area non indicata";
export const OTHER_COMPANIES_LABEL = "Altre società";
/** Id della guida per una proposta che riguarda tutte e due le società. */
export const JOINT_COMPANY_ID = "entrambe";
export const JOINT_COMPANY_LABEL = "Entrambe le società";

/** Proposte di un'area come escono dal database (id della guida o null). */
export interface AreaCount {
  area: string | null;
  proposals: number;
  bestPractices: number;
}

/** Proposte di una società come escono dal database (id della guida o null). */
export interface CompanyCount {
  company: string | null;
  proposals: number;
}

/** Una riga della scheda: etichetta, proposte e quante sono best practice. */
export interface ParticipationRow {
  label: string;
  count: number;
  bestPractices: number;
}

export interface ParticipationCompany {
  label: string;
  count: number;
}

/** Tutto ciò che la scheda riceve. */
export interface Participation {
  rows: ParticipationRow[];
  companies: ParticipationCompany[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : null;
}

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Confronto senza maiuscole né accenti. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("it");
}

/**
 * La guida dà alle società solo un id: la grafia viene dal nome del workspace, quando lo
 * contiene come parole intere («topjet» in «TopJet e Aliserio» → «TopJet»; «gruppo_nord»
 * in «Gruppo Nord Est» → «Gruppo Nord»), altrimenti dall'id («alfa_beta» → «Alfa beta»).
 */
function companyLabel(id: string, nameWords: readonly string[]): string {
  const parts = id.split("_").filter(Boolean);
  for (let i = 0; parts.length && i + parts.length <= nameWords.length; i++) {
    if (parts.every((part, j) => fold(nameWords[i + j]) === part)) return nameWords.slice(i, i + parts.length).join(" ");
  }
  const words = parts.join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Etichette dalla guida del workspace (`workspace_connector_configs.guide`), lette in modo
 * tollerante: aree `[{ id, label }]` (un'area senza etichetta non si mostra per nome);
 * società in `workspace.società` come id, con la grafia di `workspace.nome`.
 */
export function participationGuideLabels(guide: unknown): {
  areas: Map<string, string>;
  companies: Map<string, string>;
} {
  const g = record(guide);
  const areas = new Map<string, string>();
  for (const entry of Array.isArray(g?.areas) ? g.areas : []) {
    const area = record(entry);
    const id = cleanText(area?.id);
    const label = cleanText(area?.label);
    if (id && label && !areas.has(id)) areas.set(id, label);
  }
  const workspace = record(g?.workspace);
  const nameWords = cleanText(workspace?.nome)?.match(/[\p{L}\p{N}]+/gu) ?? [];
  const list = workspace?.["società"];
  const companies = new Map<string, string>();
  for (const entry of Array.isArray(list) ? list : []) {
    const id = cleanText(entry);
    if (id && !companies.has(id)) companies.set(id, companyLabel(id, nameWords));
  }
  return { areas, companies };
}

const byCountThenLabel = (a: { count: number; label: string }, b: { count: number; label: string }) =>
  b.count - a.count || a.label.localeCompare(b.label, "it");

/** Righe della scheda e riga delle società, con soglia e ordine; null se la guida non ha aree. */
export function summarizeParticipation(input: {
  areas: readonly AreaCount[];
  companies: readonly CompanyCount[];
  guide: unknown;
}): Participation | null {
  const labels = participationGuideLabels(input.guide);
  if (!labels.areas.size) return null;

  const buckets = new Set([OTHER_AREAS_LABEL, NO_AREA_LABEL].map(fold));
  const named = new Map<string, ParticipationRow>();
  const other: ParticipationRow = { label: OTHER_AREAS_LABEL, count: 0, bestPractices: 0 };
  const none: ParticipationRow = { label: NO_AREA_LABEL, count: 0, bestPractices: 0 };
  const add = (target: ParticipationRow, row: { count: number; bestPractices: number }) => {
    target.count += row.count;
    target.bestPractices += row.bestPractices;
  };
  for (const entry of input.areas) {
    const count = toCount(entry.proposals);
    if (!count) continue;
    const bestPractices = Math.min(toCount(entry.bestPractices), count);
    const id = cleanText(entry.area);
    const label = id ? labels.areas.get(id) : undefined;
    let target: ParticipationRow;
    if (!id) target = none;
    else if (!label || buckets.has(fold(label))) target = other;
    else {
      const key = fold(label);
      target = named.get(key) ?? { label, count: 0, bestPractices: 0 };
      named.set(key, target);
    }
    add(target, { count, bestPractices });
  }
  const rows: ParticipationRow[] = [];
  for (const row of named.values()) {
    if (row.count >= PARTICIPATION_MIN_GROUP) rows.push(row);
    else add(other, row);
  }
  if (none.count < PARTICIPATION_MIN_GROUP) {
    add(other, none);
    none.count = 0;
  }
  rows.sort(byCountThenLabel);
  if (other.count) rows.push(other);
  if (none.count) rows.push(none);

  return { rows, companies: summarizeCompanies(input.companies, labels.companies) };
}

function summarizeCompanies(counts: readonly CompanyCount[], labels: Map<string, string>): ParticipationCompany[] {
  if (!labels.size) return [];
  const groups = new Map<string, number>();
  let withoutCompany = 0;
  for (const entry of counts) {
    const id = cleanText(entry.company);
    const count = toCount(entry.proposals);
    if (!id) withoutCompany += count;
    else if (count) groups.set(id, (groups.get(id) ?? 0) + count);
  }
  // Le aree contano tutte le proposte, la riga quelle con una società: la differenza è il
  // numero delle proposte senza società, che segue la stessa soglia.
  if (withoutCompany && withoutCompany < PARTICIPATION_MIN_GROUP) return [];
  const named: ParticipationCompany[] = [];
  const small: number[] = [];
  let joint = 0;
  for (const [id, count] of groups) {
    const label = labels.get(id);
    if (id === JOINT_COMPANY_ID) joint = count;
    else if (label && count >= PARTICIPATION_MIN_GROUP) named.push({ label, count });
    else small.push(count);
  }
  // «Entrambe» sotto soglia non si unisce ad altre società: il suo numero si ricaverebbe
  // per differenza, quindi niente riga.
  if (joint && joint < PARTICIPATION_MIN_GROUP) return [];
  named.sort(byCountThenLabel);
  if (small.length === 1) {
    // Una società sola fuori dalla riga si ricaverebbe per differenza: si unisce alla più
    // piccola fra quelle mostrate, purché ne restino almeno due per nome.
    const smallest = named.length > 2 ? named.pop() : undefined;
    if (!smallest) return [];
    small.push(smallest.count);
  }
  if (!named.length) return [];
  const line = [...named];
  if (small.length) line.push({ label: OTHER_COMPANIES_LABEL, count: small.reduce((sum, n) => sum + n, 0) });
  if (joint) line.push({ label: JOINT_COMPANY_LABEL, count: joint });
  return line;
}

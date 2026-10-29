/**
 * Gli agenti degli use case (rilascio «Panoramica»): il tag colorato delle card, il filtro
 * «Agente» di «Altri filtri» e i gruppi «Per agente».
 *
 * - **Dal titolo.** L'agente si legge dal titolo (decisione di Pierpaolo, nessun campo nuovo):
 *   «LIBRA L1 · Lettura delle fatture estere» → agente «LIBRA», codice «L1». Non si salva
 *   niente; un titolo senza il prefisso non ha agente («Altri use case»). L'agente è un nome in
 *   testa al titolo, mai una persona (art. 15.4).
 * - **Colori.** Dieci toni (`--uc-agente-1…10` di globals.css), dati in ordine alfabetico agli
 *   agenti di tutte le schede del workspace (`agentPalette`): un filtro non ridipinge nessuno. Il
 *   nome è sempre scritto accanto al colore, che non è mai l'unico segno.
 *
 * Modulo puro, senza import.
 */

/** L'agente di un titolo, letto dal suo prefisso. */
export interface TitleAgent {
  /** «LIBRA»: la chiave del colore e del filtro. */
  agent: string;
  /** «L1», «D10», «M1.2»; null senza codice («LIBRA · …»). */
  code: string | null;
  /** «LIBRA L1»: il testo del tag. */
  label: string;
  /** «LIBRA L1 · »: la parte del titolo che il tag sostituisce, che resta per i lettori di schermo. */
  prefix: string;
  /** Il titolo dopo il prefisso. */
  rest: string;
}

/**
 * Il prefisso dell'agente. L'agente è una parola tutta maiuscola che comincia con tre lettere
 * maiuscole e continua con maiuscole o cifre, da 3 a 16 caratteri («LIBRA», «ÈLIOS»); poi, se c'è,
 * il codice: da 0 a 3 maiuscole, da 1 a 3 cifre e un decimale facoltativo («L1», «D10», «T12»,
 * «M1.2»); poi « · » (U+00B7) con almeno uno spazio, anche non separabile, per lato. Conta solo il
 * primo « · » («LIBRA L1 · Fatture · estere»); il resto non è vuoto. Un falso positivo noto e
 * innocuo: una sigla di tre o più lettere in testa («CFO · Report», «IVA · Calcolo»).
 */
const TITLE_AGENT = /^(\p{Lu}{3}[\p{Lu}\p{Nd}]{0,13})(?:[  ]+(\p{Lu}{0,3}\p{Nd}{1,3}(?:\.\p{Nd}{1,2})?))?[  ]+·[  ]+(\S[\s\S]*)$/u;

/** L'agente del titolo (senza spazi ai lati); null senza il prefisso. */
export function titleAgent(title: string): TitleAgent | null {
  const text = title.trim();
  const match = TITLE_AGENT.exec(text);
  if (!match) return null;
  const agent = match[1];
  const code = match[2] ?? null;
  const rest = match[3];
  return { agent, code, label: code ? `${agent} ${code}` : agent, prefix: text.slice(0, text.length - rest.length), rest };
}

/**
 * L'etichetta corta di uno use case accanto a un punto dei grafici del menu «⋯»: il tag dell'agente
 * («LIBRA L1»), lo stesso delle card della Panoramica, altrimenti il codice («TJ-0012»); null senza.
 */
export function shortRefOf(item: { code: string | null; title: string }): string | null {
  return titleAgent(item.title)?.label ?? item.code;
}

/** Solo il nome dell'agente del titolo; null senza il prefisso. */
export function agentOfTitle(title: string): string | null {
  return titleAgent(title)?.agent ?? null;
}

// ─── Il filtro «Agente» (`?agente=`) ────────────────────────────────

/** `agente=altri`: gli use case senza il prefisso. */
export const NO_AGENT_PARAM = "altri";
export const NO_AGENT_LABEL = "Altri use case";

/** Il valore di `agente`: il nome di un agente o {@link NO_AGENT_PARAM}. */
export type AgentParam = string;

/** Il nome di un agente da solo, come nel prefisso del titolo. */
const AGENT_NAME = /^\p{Lu}{3}[\p{Lu}\p{Nd}]{0,13}$/u;

/**
 * Il valore di `agente` dell'indirizzo: esattamente «altri» o il nome di un agente. Maiuscole e
 * minuscole contano («libra» non vale): nessun valore vale due agenti.
 */
export function parseAgentParam(raw: string | null): AgentParam | null {
  if (raw === null) return null;
  return raw === NO_AGENT_PARAM || AGENT_NAME.test(raw) ? raw : null;
}

/** Il valore di `agente` di un titolo: il suo agente, o «altri» senza il prefisso. */
export function agentParamOf(title: string): AgentParam {
  return agentOfTitle(title) ?? NO_AGENT_PARAM;
}

/** «LIBRA», «Altri use case»: il valore di `agente` a parole. */
export function agentLabel(param: AgentParam): string {
  return param === NO_AGENT_PARAM ? NO_AGENT_LABEL : param;
}

/**
 * Le voci di «Agente» in «Altri filtri», dalle schede del workspace: gli agenti che ci sono in
 * ordine alfabetico, poi «Altri use case» se un titolo non ha il prefisso. Un valore dell'indirizzo
 * che nessuna scheda ha più resta scelto, come l'area. Senza nessun prefisso e senza una scelta:
 * vuoto, e il campo non c'è.
 */
export function agentFilterOptions(items: readonly { title: string }[], chosen: AgentParam | null): Array<{ value: string; label: string }> {
  const agents = new Set<string>();
  let others = false;
  for (const item of items) {
    const agent = agentOfTitle(item.title);
    if (agent) agents.add(agent);
    else others = true;
  }
  if (chosen === NO_AGENT_PARAM) others = true;
  else if (chosen) agents.add(chosen);
  if (!agents.size && chosen !== NO_AGENT_PARAM) return [];
  return [
    ...[...agents].sort((a, b) => a.localeCompare(b, "it-IT")).map((agent) => ({ value: agent, label: agent })),
    ...(others ? [{ value: NO_AGENT_PARAM, label: NO_AGENT_LABEL }] : []),
  ];
}

// ─── I colori ────────────────────────────────────────────────────────

/** Quanti toni ha la tavolozza degli agenti (`--uc-agente-1…10`). */
export const AGENT_TONES = 10;
export type AgentTone = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface AgentPalette {
  /** Agente → tono. */
  tones: Readonly<Record<string, AgentTone>>;
}

/**
 * I toni degli agenti, dalle schede del workspace (tutte, non solo quelle filtrate): gli agenti in
 * ordine alfabetico, l'i-esimo con il tono (i mod 10) + 1. In ordine alfabetico e non con un hash
 * del nome: FNV-1a modulo 10 darebbe lo stesso colore a SIRIO, MAIA e MEROPE, e a DENEB e LIBRA.
 * Così i dieci agenti di TopJet hanno dieci colori: ALCIONE 1, AUTO 2, DENEB 3, LIBRA 4, MAIA 5,
 * MEROPE 6, ORSA 7, SIRIO 8, SPICA 9, TAIGETE 10. Dall'undicesimo agente i toni ricominciano.
 */
export function agentPalette(items: readonly { title: string }[]): AgentPalette {
  const agents = new Set<string>();
  for (const item of items) {
    const agent = agentOfTitle(item.title);
    if (agent) agents.add(agent);
  }
  const tones: Record<string, AgentTone> = {};
  [...agents]
    .sort((a, b) => a.localeCompare(b, "it-IT"))
    .forEach((agent, index) => {
      tones[agent] = ((index % AGENT_TONES) + 1) as AgentTone;
    });
  return { tones };
}

/** Il tono di un agente; null senza tavolozza, senza agente o per un agente che non ha un tono. */
export function agentToneOf(palette: AgentPalette | null | undefined, agent: string | null | undefined): AgentTone | null {
  if (!palette || !agent) return null;
  return Object.hasOwn(palette.tones, agent) ? palette.tones[agent] : null;
}

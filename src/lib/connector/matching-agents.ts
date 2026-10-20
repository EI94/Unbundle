/**
 * Agenti già progettati che somigliano alla ricerca (`find_similar_contributions`,
 * prompt WP6): `matchingAgents` della risposta.
 *
 * Il catalogo è `agentCatalog` della guida del workspace (`workspace_connector_configs.guide`),
 * scritto da Lateral Space: per ogni agente `id`, `nome`, `sistema`, `cosaFa` e
 * `keywords`, le parole chiave con cui lo si riconosce (prompt WP6 e WP8). Finché lo
 * schema della guida di K8 (`guide-schema.ts`) non c'è, la lettura è tollerante: si
 * prendono solo gli agenti con un `id` testuale, i nomi alternativi più ovvi dei campi
 * e le parole chiave come elenco di stringhe (o un testo separato da virgole). Un
 * agente senza parole chiave non corrisponde mai.
 *
 * Confronto per parole chiave, senza database:
 *  - testo ripiegato: minuscole, accenti tolti («qualità» = «qualita»), apostrofi e
 *    simboli come spazi;
 *  - parole di almeno 3 lettere, senza le parole vuote più comuni dell'italiano;
 *  - radice leggera: si tolgono le vocali finali finché restano 3 caratteri, così
 *    singolare e plurale coincidono («fattura», «fatture» → «fattur»;
 *    «orario», «orari» → «orar»);
 *  - due radici corrispondono se sono uguali o se la più corta, di almeno 6
 *    caratteri, è l'inizio dell'altra («fattur» e «fatturazion»).
 * Una parola chiave di più parole («piano di volo») corrisponde se tutte le sue
 * parole sono nella ricerca. Gli agenti escono per numero di parole chiave
 * corrispondenti, poi nell'ordine del catalogo, al massimo `MATCHING_AGENTS_MAX`.
 *
 * In uscita solo `id`, `nome`, `sistema` e `cosaFa` (null se la guida non li ha):
 * mai le parole chiave né altri campi del catalogo.
 *
 * Modulo puro, senza import: gira con `node --test`.
 */

/** Agenti al massimo nella risposta della ricerca. */
export const MATCHING_AGENTS_MAX = 5;

/** Lunghezza minima della radice più corta perché valga il confronto per inizio. */
const PREFIX_MIN = 6;
const TEXT_MAX = 500;
const KEYWORDS_MAX = 50;
const KEYWORD_CHARS_MAX = 80;

/** Un agente del catalogo della guida, letto in modo tollerante. */
export interface CatalogAgent {
  id: string;
  nome: string | null;
  sistema: string | null;
  cosaFa: string | null;
  keywords: readonly string[];
}

/** Un agente nella risposta di `find_similar_contributions` (forma del contratto). */
export interface MatchingAgent {
  id: string;
  nome: string | null;
  sistema: string | null;
  cosaFa: string | null;
}

/** Parole vuote dell'italiano di almeno 3 lettere, già senza accenti (anche le forme con l'apostrofo). */
const STOPWORDS = new Set([
  "agli", "all", "alla", "alle", "allo", "anche", "che", "chi", "coi", "col", "coll", "come", "con", "cosa", "dagli",
  "dai", "dal", "dall", "dalla", "dalle", "dallo", "degli", "dei", "del", "dell", "della", "delle", "dello", "dove",
  "fra", "gli", "loro", "mia", "mio", "negli", "nei", "nel", "nell", "nella", "nelle", "nello", "non", "ogni", "per",
  "perche", "piu", "quando", "quell", "quella", "quelle", "quelli", "quello", "quest", "questa", "queste", "questi",
  "questo", "sono", "sua", "sugli", "sui", "sul", "sull", "sulla", "sulle", "sullo", "suo", "tra", "tutta", "tutte",
  "tutti", "tutto", "una", "uno",
]);

const VOWEL = /[aeiou]$/;

/** Minuscole, senza accenti; apostrofi, trattini e simboli come spazi. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("it")
    .replace(/[^\p{L}\p{N}]+/gu, " ");
}

function stem(word: string): string {
  let out = word;
  while (out.length > 3 && VOWEL.test(out)) out = out.slice(0, -1);
  return out;
}

/** Radici delle parole significative di un testo, senza doppioni, nell'ordine. */
export function matchStems(text: string): string[] {
  const out: string[] = [];
  for (const word of fold(text).split(" ")) {
    if ([...word].length < 3 || STOPWORDS.has(word)) continue;
    const root = stem(word);
    if (!out.includes(root)) out.push(root);
  }
  return out;
}

function stemsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= PREFIX_MIN && long.startsWith(short);
}

function shortText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? [...trimmed].slice(0, TEXT_MAX).join("") : null;
}

function firstText(entry: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = shortText(entry[key]);
    if (value) return value;
  }
  return null;
}

function keywordList(value: unknown): string[] {
  const raw = typeof value === "string" ? value.split(/[,;]/) : Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const keyword = item.trim();
    if (keyword && [...keyword].length <= KEYWORD_CHARS_MAX && !out.includes(keyword)) out.push(keyword);
    if (out.length === KEYWORDS_MAX) break;
  }
  return out;
}

/** Il catalogo degli agenti della guida (`agentCatalog`); vuoto se manca o non è un elenco. */
export function agentCatalogFromGuide(guide: Record<string, unknown> | null): CatalogAgent[] {
  const list = guide?.agentCatalog;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: CatalogAgent[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const agent = entry as Record<string, unknown>;
    const id = shortText(agent.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      nome: firstText(agent, ["nome", "name", "label"]),
      sistema: firstText(agent, ["sistema", "system"]),
      cosaFa: firstText(agent, ["cosaFa", "cosa fa", "cosa_fa", "descrizione", "description"]),
      keywords: keywordList(agent.keywords ?? agent.paroleChiave),
    });
  }
  return out;
}

/**
 * Gli agenti del catalogo che corrispondono alla ricerca, per numero di parole chiave
 * trovate e poi nell'ordine del catalogo.
 */
export function matchingAgents(
  query: string,
  guide: Record<string, unknown> | null,
  max: number = MATCHING_AGENTS_MAX
): MatchingAgent[] {
  const queryStems = matchStems(query);
  if (!queryStems.length) return [];
  const inQuery = (root: string) => queryStems.some((q) => stemsMatch(q, root));
  const scored: Array<{ agent: CatalogAgent; score: number; order: number }> = [];
  agentCatalogFromGuide(guide).forEach((agent, order) => {
    let score = 0;
    for (const keyword of agent.keywords) {
      const roots = matchStems(keyword);
      if (roots.length && roots.every(inQuery)) score += 1;
    }
    if (score > 0) scored.push({ agent, score, order });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, max))
    .map(({ agent }) => ({ id: agent.id, nome: agent.nome, sistema: agent.sistema, cosaFa: agent.cosaFa }));
}

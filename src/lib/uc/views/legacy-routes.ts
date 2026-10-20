/**
 * Vecchi indirizzi del dossier (DESIGN §2.5): ogni vecchio segmento sotto
 * `/dashboard/<ws>/casi-duso/<caso>` risponde 308 verso la pagina nuova, con
 * la query tradotta. Le pagine-stub dei vecchi segmenti chiamano
 * `legacyCaseRouteFromPath` e `permanentRedirect`, senza leggere il database.
 *
 * - `voci` → `domande`, con i filtri di oggi tradotti nei parametri nuovi;
 * - `voci/<id>` → `domande/<id>`, `documenti` → `domande/documenti`;
 * - `verifica` → `domande?vista=da-verificare`;
 * - `mappa`, `regole`, `modello-dati` → `soluzione/{mappa,regole,dati}`;
 * - `kpi` → `valore/kpi`, `roi` → `valore`, `avanzamento` → `via`;
 * - `registro` → `attivita`, `registro/csv` → `attivita/csv`.
 *
 * Un parametro che la tabella non nomina si lascia cadere. Modulo puro.
 */

export type LegacySearchParams = URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

/** I vecchi segmenti (primo livello sotto il caso) che hanno una pagina-stub. */
export const LEGACY_CASE_SEGMENTS = ["voci", "verifica", "documenti", "mappa", "regole", "modello-dati", "kpi", "roi", "avanzamento", "registro"] as const;
export type LegacyCaseSegment = (typeof LEGACY_CASE_SEGMENTS)[number];

/** `preset` del vecchio catalogo → `vista` (e altri parametri) di Domande. */
const PRESET_TO: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  must_non_verdi: { vista: "da-fare" },
  bloccate: { vista: "bloccate" },
  da_verificare: { vista: "da-verificare" },
  evoluzione: { vista: "tutte", perimetro: "fuori" },
};

/** Il vecchio «senza priorità» si scriveva `nessuno` (e `__none` nella specifica). */
const NOT_ONLY_MUST = new Set(["should", "could", "nessuno", "__none"]);

/** Il tipo della vista iniziale del vecchio catalogo: in Domande non si scrive. */
const DEFAULT_KIND = "domanda";

function entries(sp: LegacySearchParams | undefined): [string, string][] {
  if (!sp) return [];
  if (sp instanceof URLSearchParams) return [...sp.entries()];
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") out.push([key, value]);
    else if (Array.isArray(value)) for (const v of value) if (typeof v === "string") out.push([key, v]);
  }
  return out;
}

/** Primo valore non vuoto di ogni parametro (i vecchi indirizzi ne avevano uno solo). */
function firstValues(sp: LegacySearchParams | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of entries(sp)) {
    if (!out.has(key) && value.trim() !== "") out.set(key, value);
  }
  return out;
}

function withQuery(path: string, params: URLSearchParams): string {
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

function pick(from: Map<string, string>, keys: readonly string[], rename: Readonly<Record<string, string>> = {}): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of keys) {
    const value = from.get(key);
    if (value !== undefined) out.set(rename[key] ?? key, value);
  }
  return out;
}

/** I filtri del vecchio catalogo (`voci`) nei parametri di Domande (DESIGN §2.5). */
function catalogQuery(from: Map<string, string>): URLSearchParams {
  const out = new URLSearchParams();
  const preset = from.get("preset");
  if (preset && PRESET_TO[preset]) for (const [k, v] of Object.entries(PRESET_TO[preset])) out.set(k, v);
  const tipo = from.get("tipo");
  if (tipo && tipo !== DEFAULT_KIND) {
    out.set("mostra", "catalogo");
    if (tipo !== "tutti") out.set("tipo", tipo);
  }
  const modulo = from.get("modulo");
  if (modulo) out.set("argomento", modulo);
  const privacy = from.get("privacy");
  if (privacy) out.set("riservatezza", privacy);
  const priorita = from.get("priorita");
  if (priorita && NOT_ONLY_MUST.has(priorita)) out.set("indispensabili", "no");
  for (const key of ["stato", "referente", "ruolo", "q", "pagina"]) {
    const value = from.get(key);
    if (value !== undefined) out.set(key, value);
  }
  return out;
}

/**
 * Il nuovo indirizzo di un vecchio segmento del dossier, con la query tradotta;
 * null se `segments` non è un vecchio indirizzo. `base` è la radice del
 * dossier (`/dashboard/<ws>/casi-duso/<caso>`), `segments` i segmenti dopo.
 */
export function legacyCaseRoute(base: string, segments: readonly string[], searchParams?: LegacySearchParams): string | null {
  const root = base.replace(/\/+$/, "");
  const [head, ...rest] = segments;
  const sp = firstValues(searchParams);
  const all = () => new URLSearchParams(entries(searchParams));
  switch (head) {
    case "voci":
      if (rest.length === 0) return withQuery(`${root}/domande`, catalogQuery(sp));
      if (rest.length === 1 && rest[0]) return withQuery(`${root}/domande/${rest[0]}`, all());
      return null;
    case "verifica": {
      if (rest.length > 0) return null;
      const q = new URLSearchParams({ vista: "da-verificare" });
      const pagina = sp.get("pagina");
      if (pagina !== undefined) q.set("pagina", pagina);
      return withQuery(`${root}/domande`, q);
    }
    case "documenti":
      return rest.length === 0 ? withQuery(`${root}/domande/documenti`, all()) : null;
    case "mappa":
      return rest.length === 0 ? withQuery(`${root}/soluzione/mappa`, pick(sp, ["vista"])) : null;
    case "regole":
      return rest.length === 0 ? withQuery(`${root}/soluzione/regole`, pick(sp, ["apri"])) : null;
    case "modello-dati":
      return rest.length === 0 ? withQuery(`${root}/soluzione/dati`, pick(sp, ["vista", "entita", "apri"], { entita: "apri" })) : null;
    case "kpi":
      return rest.length === 0 ? withQuery(`${root}/valore/kpi`, pick(sp, ["apri"])) : null;
    case "roi":
      return rest.length === 0 ? `${root}/valore` : null;
    case "avanzamento":
      return rest.length === 0 ? `${root}/via` : null;
    case "registro":
      if (rest.length === 0) return withQuery(`${root}/attivita`, pick(sp, ["tipo", "chi", "attore", "dal", "al", "pagina"]));
      if (rest.length === 1 && rest[0] === "csv") return withQuery(`${root}/attivita/csv`, all());
      return null;
    default:
      return null;
  }
}

const CASE_ROOT = /^(\/dashboard\/[^/]+\/casi-duso\/[^/]+)\/(.+?)\/?$/;

/**
 * Per le pagine-stub: dal percorso della richiesta (già codificato, come
 * nell'URL) al nuovo indirizzo. Null se il percorso non è un vecchio indirizzo
 * del dossier.
 */
export function legacyCaseRouteFromPath(pathname: string, searchParams?: LegacySearchParams): string | null {
  const m = CASE_ROOT.exec(pathname);
  if (!m) return null;
  return legacyCaseRoute(m[1], m[2].split("/"), searchParams);
}

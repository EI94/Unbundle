/**
 * (Rilascio 10, ondata 5b) I pannelli della Soluzione nell'indirizzo, senza dipendenze: li usano la pagina
 * (`solution.ts`) e i redirect dei vecchi indirizzi (`legacy-routes.ts`). Modulo puro, senza import.
 */

/** Il pannello delle regole, nell'indirizzo della Soluzione (`?apri=regole`), e la regola aperta dentro (`regola=<id>`). */
export const RULES_PANEL = "regole";
export const RULE_PARAM = "regola";

/** I parametri del pannello delle regole che restano nell'indirizzo: ricerca, filtri, vincoli e pagina. */
export const RULES_PANEL_PARAMS: readonly string[] = Object.freeze(["q", "stato", "perimetro", "vincoli", "pagina"]);

type Params = URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * Il vecchio indirizzo `/soluzione/regole` (e `/regole`) nel pannello: `?apri=<id>` della pagina di ieri è la regola
 * aperta (`regola=<id>`); ricerca, filtri, vincoli e pagina restano. `base` è la radice del dossier.
 */
export function legacyRulesHref(root: string, sp: Params): string {
  const get = (key: string): string | null => {
    const v = sp instanceof URLSearchParams ? sp.get(key) : sp[key];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s !== "" ? s : null;
  };
  const q = new URLSearchParams({ apri: RULES_PANEL });
  for (const key of RULES_PANEL_PARAMS) {
    const value = get(key);
    if (value) q.set(key, value);
  }
  const rule = get("apri");
  if (rule) q.set(RULE_PARAM, rule);
  return `${root.replace(/\/+$/, "")}/soluzione?${q.toString()}`;
}

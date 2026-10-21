/**
 * Voce attiva della barra laterale (docs/use-case/DESIGN.md §2.1, D1).
 *
 * Ogni voce ha `match`, i segmenti sotto `/dashboard/<ws>` per cui resta accesa; il
 * predefinito è il segmento della voce stessa (`setup/leadership` per Discovery). Una voce
 * è attiva se l'indirizzo è `base/m` oppure inizia con `base/m/`, per un `m` di `match`:
 * così «Casi d'uso» resta accesa dentro un dossier e «Use case» su `/portfolio`, `/plan`
 * e `/casi-duso`. Overview, che punta alla base del workspace, è attiva solo
 * sull'indirizzo esatto. Il flag `nested` non serve più.
 *
 * Modulo puro, senza import: lo usa `app-sidebar.tsx` (componente client) e lo prova
 * `nav-active.test.ts` con `node --test`.
 */

export interface NavItemMatch {
  href: string;
  /** Segmenti sotto la base del workspace, senza barre (`"use-cases"`, `"casi-duso"`). */
  match?: readonly string[];
}

/** I segmenti della voce «Use case» con l'area accesa: le pagine che la sostituiscono restano sotto di lei. */
export const USE_CASE_NAV_MATCH: readonly string[] = Object.freeze(["use-cases", "portfolio", "plan", "casi-duso"]);

/** Senza barra finale (tranne la radice) e senza query o frammento. */
function normalizePath(path: string): string {
  const cut = path.search(/[?#]/);
  const bare = cut === -1 ? path : path.slice(0, cut);
  const trimmed = bare.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function trimSlashes(segment: string): string {
  return segment.replace(/^\/+|\/+$/g, "");
}

/** Il segmento della voce sotto la base, oppure null se la voce non sta sotto la base. */
function ownSegment(href: string, base: string): string | null {
  if (href === base) return "";
  const prefix = base === "/" ? "/" : `${base}/`;
  return href.startsWith(prefix) ? href.slice(prefix.length) : null;
}

/** Vero se la voce è quella dell'indirizzo corrente. */
export function isNavItemActive(pathname: string, basePath: string, item: NavItemMatch): boolean {
  const path = normalizePath(pathname);
  const base = normalizePath(basePath);
  const href = normalizePath(item.href);
  const own = ownSegment(href, base);
  // Una voce fuori dal workspace, o la base stessa (Overview): solo l'indirizzo esatto.
  if (own === null || own === "") return path === href;
  const segments = (item.match ?? [own]).map(trimSlashes).filter((m) => m !== "");
  if (segments.length === 0) return path === href;
  const prefix = base === "/" ? "" : base;
  return segments.some((m) => path === `${prefix}/${m}` || path.startsWith(`${prefix}/${m}/`));
}

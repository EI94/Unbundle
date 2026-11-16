/**
 * «Mappatura board»: il pannello dell'assistente sopra la pagina, come una finestra modale (docs/mappatura/
 * MAPPATURA-BOARD-PIANO.md §1.5; P29–P33, F2).
 *
 * Sotto i 1280 px il pannello sta sopra la pagina velata ed è annunciato come dialogo modale: il fuoco deve restarci.
 * - `inertOthers`: tutto quello che sta fuori dal pannello diventa inerte (la barra laterale e la barra in alto
 *   dell'app comprese), tranne quello che `keep` lascia attivo (il velo, che chiude il pannello con un clic). Chiuso il
 *   pannello, torna com'era.
 * - `tabbables` e `wrapFocus`: le due guardie del pannello (in cima e in fondo) rimandano il Tab dall'altra parte, come
 *   il drawer: dall'ultimo elemento al primo, e viceversa.
 * - `closesOnEscape`: Escape chiude il pannello dovunque sia il fuoco (anche sulla pagina), tranne dentro un altro
 *   dialogo aperto sopra di lui (un drawer del compagno chiude prima se stesso).
 *
 * Senza React: si prova con Node, con elementi finti.
 */

/** Quello di un elemento che serve a renderlo inerte. */
export interface InertNode {
  parentElement: InertNode | null;
  children: ArrayLike<InertNode>;
  inert: boolean;
}

/**
 * Rende inerte tutto quello che sta fuori da `element`: a ogni livello, dal pannello fino a `stop` (il body), i fratelli
 * del ramo che porta al pannello. `keep`: quello che resta attivo. Restituisce la funzione che rimette tutto com'era
 * (solo quello che era attivo prima).
 */
export function inertOthers(element: InertNode, stop: InertNode | null, keep: (node: InertNode) => boolean = () => false): () => void {
  const changed: InertNode[] = [];
  let branch: InertNode = element;
  while (branch.parentElement && branch !== stop) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (sibling === branch || sibling.inert || keep(sibling)) continue;
      sibling.inert = true;
      changed.push(sibling);
    }
    branch = branch.parentElement;
  }
  return () => {
    for (const node of changed) node.inert = false;
  };
}

/** Quello che si raggiunge con il Tab dentro il pannello, nell'ordine, senza le guardie. */
export const TABBABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface Focusable {
  focus(options?: FocusOptions): void;
  hasAttribute(name: string): boolean;
  /** null quando l'elemento non si vede (nascosto, o dentro un elemento nascosto). */
  offsetParent: unknown;
}

/** Gli elementi del pannello che il Tab raggiunge: visibili, non guardie. */
export function tabbables(panel: { querySelectorAll(selector: string): ArrayLike<Focusable> }): Focusable[] {
  return Array.from(panel.querySelectorAll(TABBABLE)).filter((item) => item.offsetParent !== null && !item.hasAttribute("data-focus-guard"));
}

/** Una guardia ha preso il fuoco: quella in fondo lo manda al primo elemento, quella in cima all'ultimo. */
export function wrapFocus(panel: { querySelectorAll(selector: string): ArrayLike<Focusable> }, guard: "start" | "end"): void {
  const items = tabbables(panel);
  const target = guard === "end" ? items[0] : items[items.length - 1];
  target?.focus();
}

/** Escape chiude il pannello sopra la pagina: dovunque sia il fuoco, tranne dentro un altro dialogo aperto sopra di lui. */
export function closesOnEscape(event: { key: string; defaultPrevented: boolean; target: unknown }, panel: { contains(node: unknown): boolean }): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  const target = event.target as { closest?(selector: string): unknown } | null;
  const dialog = typeof target?.closest === "function" ? target.closest('[role="dialog"]') : null;
  return !dialog || panel.contains(dialog);
}

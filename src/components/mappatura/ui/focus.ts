/**
 * «Mappatura board»: dove va il fuoco quando un controllo sparisce o si spegne sotto di lui (il difetto F1 del
 * riferimento: il fuoco cadeva sulla pagina, e il Tab ripartiva dalla barra laterale dell'app).
 *
 * - `fieldHolder`: il drawer o la vista che tiene un controllo (prende il fuoco senza entrare nel giro del Tab);
 * - `keepFocusAfter`: dopo un controllo che è appena sparito (il toast con «Annulla»);
 * - `focusKeeper`: per un controllo che può sparire alla fine di un lavoro che dura (il bottone del completamento);
 * - `focusBeforeRemoving`: prima di togliere un elemento di una lista con la sua «×» (un chip, una nota, un punto di
 *   analisi): il fuoco va allo stesso controllo dell'elemento vicino, o al «+» della lista.
 * Nessuno ruba il fuoco a chi l'ha preso: si muove solo se è sul controllo, o se è andato perso.
 *
 * Senza React: lo usano gli atomi, i campi e le viste.
 */

/**
 * Dove va il fuoco quando la persona lascia un campo con Escape: il drawer che lo tiene, o la vista della board (il suo
 * pannello, che prende il fuoco senza entrare nel giro del Tab). Mai la pagina: il Tab dopo ripartirebbe dalla barra
 * laterale dell'app, anche con un drawer aperto (F1, F2).
 */
export function fieldHolder(field: Pick<Element, "closest">): HTMLElement | null {
  return (field.closest('[role="dialog"]') ?? field.closest('[role="tabpanel"]')) as HTMLElement | null;
}

/** Il drawer o la vista di un controllo; fuori da entrambi (il toast in fondo alla pagina), la vista aperta della board. */
function holderOf(control: Pick<Element, "closest">): HTMLElement | null {
  return fieldHolder(control) ?? (control.closest("[data-board-root]")?.querySelector('[role="tabpanel"]:not([hidden])') as HTMLElement | null) ?? null;
}

/**
 * Dopo un controllo che sparisce sotto il fuoco («Usa gli stream proposti» applicato, «Annulla» del toast): il fuoco va
 * dove stava il controllo, nel drawer o nella vista (`fieldHolder`), o nella vista aperta della board se il controllo
 * stava fuori (il toast in fondo alla pagina). Solo se il fuoco è andato perso: niente lo ruba a chi lo ha preso.
 */
export function keepFocusAfter(control: Pick<Element, "closest">, doc: Pick<Document, "activeElement" | "body"> | null = typeof document === "undefined" ? null : document): void {
  if (!doc) return;
  const target = holderOf(control);
  const active = doc.activeElement;
  if (target && (!active || active === doc.body || active === control)) target.focus({ preventScroll: true });
}

/**
 * Per un controllo che può sparire alla fine di un lavoro che dura («Completa la mappatura», che non c'è più quando non
 * resta niente da classificare): ricorda adesso il drawer o la vista che lo tiene, e restituisce la funzione che, alla
 * fine del lavoro, ci rimette il fuoco se nel frattempo è andato perso.
 */
export function focusKeeper(control: Pick<Element, "closest">, doc: Pick<Document, "activeElement" | "body"> | null = typeof document === "undefined" ? null : document): () => void {
  const holder = holderOf(control);
  return () => {
    if (!doc || !holder?.isConnected) return;
    const active = doc.activeElement;
    if (!active || active === doc.body) holder.focus({ preventScroll: true });
  };
}

/** Il vicino che prende il posto di un elemento tolto da una lista di `count`: quello dopo, o quello prima; -1 se non c'è. */
export const neighbourIndex = (count: number, at: number): number => (at + 1 < count ? at + 1 : at - 1);

/** Quello che `focusBeforeRemoving` legge del DOM: un elemento con i suoi genitori, figli e bottoni. */
export interface FocusNode {
  readonly parentElement: FocusNode | null;
  readonly children: ArrayLike<FocusNode>;
  readonly ownerDocument: { readonly activeElement: unknown };
  closest(selector: string): FocusNode | null;
  matches(selector: string): boolean;
  querySelector(selector: string): FocusNode | null;
  querySelectorAll(selector: string): ArrayLike<FocusNode>;
  focus(options?: FocusOptions): void;
}

/**
 * Prima di togliere un elemento di una lista con il suo controllo (la «×» di un chip, di una nota, di un punto di
 * analisi), se il fuoco è su quel controllo: va allo stesso controllo (lo stesso posto tra i bottoni) dell'elemento
 * dopo, o di quello prima; senza vicini al «+» della lista (`[data-b="add"]`, dentro la lista o subito fuori), poi al
 * drawer o alla vista. Si chiama prima di togliere l'elemento, mentre il controllo è ancora nella pagina.
 */
export function focusBeforeRemoving(control: FocusNode, itemSelector: string): void {
  if (control.ownerDocument.activeElement !== control) return;
  const item = control.closest(itemSelector);
  const list = item?.parentElement ?? null;
  const siblings = list ? Array.from(list.children).filter((child) => child.matches(itemSelector)) : [];
  const near = item ? siblings[neighbourIndex(siblings.length, siblings.indexOf(item))] : undefined;
  const slot = item ? Array.from(item.querySelectorAll("button")).indexOf(control) : -1;
  const same = near && slot >= 0 ? (Array.from(near.querySelectorAll("button"))[slot] ?? null) : null;
  const add = list ? (list.querySelector(':scope > [data-b="add"]') ?? list.parentElement?.querySelector(':scope > [data-b="add"]') ?? null) : null;
  const target = same ?? add ?? (fieldHolder(control as unknown as Element) as FocusNode | null);
  target?.focus({ preventScroll: true });
}

/** Quello che `focusPanelStart` usa di «Chiudi»: il fuoco e il pannello (`[role=dialog]`) che lo contiene. */
export interface PanelFocusTarget {
  focus(options?: FocusOptions): void;
  closest(selector: string): { contains(other: Node | null): boolean; focus(options?: FocusOptions): void } | null;
}

/**
 * Il fuoco all'apertura del pannello (`initialFocus` del `SheetContent`): su «Chiudi», il primo
 * elemento, come faceva Base UI da sé, ma senza far scorrere il pannello. Base UI lo dava nel primo
 * fotogramma dopo l'apertura, prima che il pannello fosse disegnato, con `focus()` senza
 * `preventScroll`: al telefono il pannello è più alto della finestra (sporge fino a circa 150 px,
 * «Apri la scheda» sta sotto il bordo) e, se tra l'apertura e quel fotogramma qualcosa lo faceva
 * scorrere, tornava in cima. Una persona non lo vede, perché il fotogramma viene prima di ogni
 * disegno; lo vedevano solo le sonde che fanno scorrere il pannello in quell'intervallo (la sonda
 * «history» del harness). Dare il fuoco a «Chiudi» non ha mai bisogno di far scorrere il pannello:
 * qui va con `preventScroll` nel momento stesso in cui Base UI sceglie l'elemento, e `false` gli
 * dice di non spostarlo più. Come in Base UI, se il fuoco è già nel pannello resta dov'è e, aperto
 * con un tocco, va al pannello stesso. Senza «Chiudi» (riferimento ancora vuoto) restituisce `true`,
 * il comportamento predefinito di Base UI.
 */
export function focusPanelStart(openType: string, close: PanelFocusTarget | null, active: Node | null): boolean {
  if (!close) return true;
  const popup = close.closest("[role=dialog]");
  if (popup && active && popup.contains(active)) return false;
  (openType === "touch" && popup ? popup : close).focus({ preventScroll: true });
  return false;
}

/**
 * I pezzi comuni del rilascio 10 «Unbundle semplice» (docs/ui-10/PROPOSTA-10.md §5.4). Nascono con la Home (ondata
 * 2b); le altre ondate li adottano al posto delle loro copie. Ogni pezzo ha la sua regola, scritta qui una volta:
 *
 * - `NextStep` — il prossimo passo: l'etichetta «Prossimo passo», il solo pulsante pieno della schermata (icona e
 *   verbo di 2-3 parole) e il «?» con il perché. Se il passo non tocca a chi guarda, le parole dello stato e «Tocca a
 *   …» senza pulsante; niente da fare: «Tutto in ordine». Al telefono il pulsante sta nella prima schermata.
 * - `BigNumber` — il numero grande: uno per schermata, etichetta di al massimo 4 parole, una riga grigia di al massimo
 *   8, un link o un «?» facoltativi («Tutti i numeri ›»). Lo zero non si mostra.
 * - `Fold` — la piega: H2 vero con un pulsante `aria-expanded`, la riga di riepilogo e la freccia. Chiusa per
 *   default, aperta solo all'arrivo da un link (`defaultOpen` o `#<id>`).
 * - `SideSheet` con `useSheetParam` — il pannello: a destra fino a 32 rem, a tutto schermo al telefono, titolo e ✕,
 *   un suo pulsante pieno nel piede; sempre con un indirizzo (`?apri=`), e «Indietro» lo chiude.
 * - `FilterChips` — «Cerca» (icona al telefono), «Filtri (n)» che apre un foglio con tutti i filtri, i chip attivi con
 *   ✕ e «Togli tutti». I filtri stanno sempre nell'indirizzo.
 * - `EmptyState` — un vuoto vero: una frase di al massimo 12 parole e un'azione, piena solo se è il prossimo passo.
 *   Le sezioni a zero invece non si mostrano.
 * - `notifyDone` e `notifyWithUndo` — gli avvisi brevi, con `sonner` e la regione «Avvisi»: 4 secondi, 10 con
 *   «Annulla»; mai per un errore che chiede di agire, che sta nella pagina.
 * - `Row`, `RowList`, `TextAction` — una riga per oggetto (titolo, un fatto grigio, la freccia; almeno 44 px) e
 *   l'azione tranquilla con la freccia.
 *
 * I testi che i pezzi dicono da soli stanno in `text.ts`; tutto il resto lo passa chi li usa, dai suoi moduli di testi.
 *
 * `NextStep`, `BigNumber`, `Row`, `RowList`, `TextAction` ed `EmptyState` sono senza stato e si rendono anche sul
 * server; `Fold`, `SideSheet`, `FilterChips` e `Why` sono componenti client. Un componente del server importa il file
 * del pezzo (`@/components/ui-10/next-step`), non questo indice, che porta con sé anche i pezzi client.
 */
export { BigNumber, type BigNumberProps } from "./big-number";
export { EmptyState, type EmptyStateAction, type EmptyStateProps } from "./empty-state";
export { FilterChips, activeChips, clearAllHref, filterHref, type FilterChipsProps, type FilterField, type FilterOption } from "./filter-chips";
export { Fold, foldOpen, hashTarget, type FoldProps } from "./fold";
export { NextStep, type NextStepItem, type NextStepProps } from "./next-step";
export { Row, RowList, TextAction, type RowProps } from "./row";
export { SHEET_PARAM, SideSheet, sheetHref, useSheetParam, type SideSheetProps } from "./side-sheet";
export { UI10_TEXT } from "./text";
export { TOAST_MS, TOAST_UNDO_MS, notifyDone, notifyWithUndo, toastOptions, type ToastOptions } from "./toast";
export { Why } from "./why";

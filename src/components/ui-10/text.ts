/**
 * I testi dei pezzi comuni del rilascio 10 (docs/ui-10/PROPOSTA-10.md §5.4): le poche parole che i pezzi dicono da
 * soli. Tutto il resto (il verbo del passo, il titolo di un pannello, la frase di un vuoto) lo passa chi li usa, dal
 * suo modulo di testi.
 *
 * Modulo puro, senza import.
 */
export const UI10_TEXT = Object.freeze({
  nextStep: Object.freeze({
    /** L'etichetta sopra il pulsante (12 px, grigia). */
    label: "Prossimo passo",
    /** Il nome del «?» per i lettori di schermo. */
    why: "Perché questo passo",
    /** Niente da fare: la riga senza pulsante. */
    done: "Tutto in ordine",
  }),
  sheet: Object.freeze({
    close: "Chiudi",
  }),
  filters: Object.freeze({
    search: "Cerca",
    /** «Filtri», «Filtri (2)». */
    open: (active: number) => (active > 0 ? `Filtri (${active})` : "Filtri"),
    title: "Filtri",
    apply: "Mostra i risultati",
    all: "Tutti",
    /** Il ✕ di un chip, per i lettori di schermo. */
    remove: (label: string) => `Togli ${label}`,
    clear: "Togli tutti",
  }),
  toast: Object.freeze({
    undo: "Annulla",
  }),
});

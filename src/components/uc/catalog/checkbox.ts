/**
 * Casella di selezione nativa delle liste lunghe del catalogo (una per riga,
 * fino a 100 per pagina). La casella di shadcn (span, input nascosto e molte
 * classi) pesava più di 1 KB l'una nell'HTML; questa ha l'aspetto del tema
 * scuro (`color-scheme`, colore primario) e l'area di tocco la dà l'etichetta
 * che la contiene.
 */
export const CHECKBOX_CLASS = "size-4 shrink-0 cursor-pointer rounded-[4px] accent-primary [color-scheme:dark] disabled:cursor-not-allowed";

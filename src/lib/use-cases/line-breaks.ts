/**
 * Dove il testo a schermo dell'area «Use case» non va a capo (rilascio «Panoramica», rifiniture).
 *
 * - **Numeri e unità**: un numero resta con la parola che lo segue («40 requisiti», «12 €/mese»,
 *   «T4 2026», «17 use case»), un importo con «all'anno», un mese con il suo anno («agosto 2027»,
 *   «nov 26»).
 * - **Nomi tra «…»**: un nome corto («In valutazione», «Da decidere») resta intero, fino a
 *   `QUOTED_NAME_MAX` caratteri; uno più lungo va a capo come il resto, così un telefono stretto non
 *   scorre mai di lato.
 * - **Il «·»**: resta con il pezzo prima, come una virgola. Una riga può finire con «·», non
 *   cominciare; un conto solo dopo l'ultimo «·» («Già a posto · 2») resta con il «·».
 *
 * Il carattere è lo spazio non separabile U+00A0, lo stesso che `Intl.NumberFormat("it-IT")` mette
 * prima di «€»: chi legge lo schermo lo legge come uno spazio, e il `\s` della guardia delle parole
 * (`copy-guard.ts`) lo trova. Solo la pagina lo usa, quando scrive il testo: il MCP del team,
 * l'export e i dati salvati tengono i loro spazi, e i testi di `format.ts`, `lanes.ts`, `needs.ts`,
 * `views.ts` e degli altri moduli condivisi restano come sono.
 *
 * Modulo puro, senza import.
 */

/** Lo spazio non separabile (U+00A0). */
export const NBSP = " ";

/** « · » a schermo: il «·» resta con il pezzo prima, la riga va a capo dopo. */
export const SCREEN_SEPARATOR = `${NBSP}· `;

/** Il nome più lungo tra «…» che resta intero: il più lungo dei testi dell'area è di 27 caratteri. */
export const QUOTED_NAME_MAX = 30;

/** I mesi, interi e corti, come li scrive `format.ts`. */
const MONTHS = "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic";
const QUOTED_NAME = new RegExp(`«([^«»]{1,${QUOTED_NAME_MAX}})»`, "g");
const MONTH_YEAR = new RegExp(`\\b(${MONTHS}) (\\d{2,4})\\b`, "gi");

/**
 * Il testo come va a schermo: gli stessi caratteri, con U+00A0 al posto degli spazi dove la riga non
 * deve andare a capo (vedi sopra). Cambia solo spazi in U+00A0, mai altro; applicato due volte dà lo
 * stesso testo. null, undefined e "" restano come sono.
 */
export function keepTogether<T extends string | null | undefined>(text: T): T {
  if (!text) return text;
  return (
    text
      // 1. «In valutazione»: un nome corto tra «…» resta intero.
      .replace(QUOTED_NAME, (_, name: string) => `«${name.replace(/ /g, NBSP)}»`)
      // 2. Il «·» resta con il pezzo prima; un numero solo dopo l'ultimo «·» resta con il «·».
      .replace(/ · /g, SCREEN_SEPARATOR)
      .replace(/ · (\d[\d.,]*)$/, `${NBSP}·${NBSP}$1`)
      // 3. «17 use case», «12.250 € all'anno», «ott 2026».
      .replace(/(\d) use case\b/g, `$1${NBSP}use${NBSP}case`)
      .replace(/€ (all['’]anno|al mese)/g, `€${NBSP}$1`)
      .replace(MONTH_YEAR, `$1${NBSP}$2`)
      // 4. Un numero e quello che lo segue: «40 requisiti», «12 €/mese», «T4 2026».
      .replace(/(\d) (?=\S)/g, `$1${NBSP}`) as T
  );
}

/** Un pezzo corto che resta intero, come «66 da chiedere»: ogni spazio è U+00A0. */
export function wholePiece(piece: string): string {
  return piece.replace(/ /g, NBSP);
}

/** «96 aperti · 66 da chiedere · …»: i pezzi interi, separati dal «·» che resta con il pezzo prima. */
export function joinPieces(pieces: readonly string[]): string {
  return pieces.map(wholePiece).join(SCREEN_SEPARATOR);
}

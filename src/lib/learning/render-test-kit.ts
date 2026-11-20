/**
 * Solo per i test della Formazione resi in HTML (rilascio 10, ondata 7a): leggere il testo che si vede, contare le
 * parole con le pieghe chiuse e trovare i pulsanti pieni, come fa l'harness delle schermate. Non lo importa nessun file
 * dell'applicazione.
 */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "path", "circle", "rect", "line", "polyline", "polygon"]);

/** Le entità che React scrive, in caratteri. */
export function readable(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/ /g, " ");
}

/** Tutto il testo, anche quello nascosto. */
export function textOf(html: string): string {
  return readable(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Il testo che si vede con le pieghe chiuse: niente regioni `hidden`, niente `sr-only`, niente contenuto di un
 * `<details>` chiuso dopo il suo `<summary>`, niente SVG.
 */
export function visibleText(html: string): string {
  type Entry = { tag: string; hidden: boolean; closedDetails: boolean; hideRest: boolean };
  const stack: Entry[] = [];
  const out: string[] = [];
  const hiddenNow = () => stack.some((entry) => entry.hidden || entry.hideRest);
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    const [, closing, rawTag, attrs = "", selfClosing, text] = match;
    if (text !== undefined) {
      if (!hiddenNow()) out.push(text);
      continue;
    }
    if (!rawTag) continue;
    const tag = rawTag.toLowerCase();
    if (closing) {
      const index = stack.map((entry) => entry.tag).lastIndexOf(tag);
      if (index >= 0) {
        const [closed] = stack.splice(index);
        const parent = stack.at(-1);
        if (closed.tag === "summary" && parent?.closedDetails) parent.hideRest = true;
      }
      out.push(" ");
      continue;
    }
    if (VOID.has(tag) || selfClosing) {
      out.push(" ");
      continue;
    }
    const hidden = /\shidden(?:=|\s|$)/.test(` ${attrs}`) || /class="[^"]*\bsr-only\b/.test(attrs) || tag === "svg" || tag === "script" || tag === "style";
    stack.push({ tag, hidden, closedDetails: tag === "details" && !/\sopen(?:=|\s|$)/.test(` ${attrs}`), hideRest: false });
    out.push(" ");
  }
  return readable(out.join("")).replace(/\s+/g, " ").trim();
}

/** Le parole di un testo (i segni da soli non contano). */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** I pulsanti pieni: `[data-slot=button]` con la classe `bg-primary`, come nell'harness delle schermate. */
export function filledButtons(html: string): string[] {
  return [...html.matchAll(/<(?:a|button)\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));
}

/** Le pieghe (`Fold`) della pagina, con lo stato: aperta o chiusa. */
export function folds(html: string): Array<{ id: string; open: boolean }> {
  return [...html.matchAll(/<section id="([^"]+)" data-slot="fold"( data-open="")?/g)].map((match) => ({ id: match[1], open: !!match[2] }));
}

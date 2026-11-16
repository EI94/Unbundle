/**
 * Solo per `board-theme.test.ts`: un lettore di CSS quanto basta per confrontare il foglio della board con i due fogli
 * di riferimento (docs/mappatura/MAPPATURA-BOARD-PIANO.md §8.4). Non lo importa nessun file dell'app.
 */

export interface CssRule {
  /** Il preludio dell'at-rule che la contiene (`@media (max-width:680px)`, `@container board (…)`), o null. */
  at: string | null;
  /** Un selettore solo: le liste separate da virgole diventano più regole. */
  selector: string;
  /** Le dichiarazioni, nell'ordine in cui sono scritte: proprietà → valore. */
  declarations: Map<string, string>;
}

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();

/** Divide alla virgola o al punto e virgola di primo livello (non dentro parentesi o virgolette). */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(" || char === "[") {
      depth++;
    } else if (char === ")" || char === "]") {
      depth--;
    }
    if (char === separator && depth === 0 && !quote) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function parseDeclarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const declaration of splitTop(body, ";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    out.set(declaration.slice(0, colon).trim(), squeeze(declaration.slice(colon + 1)));
  }
  return out;
}

/** Tutte le regole di un foglio, nell'ordine in cui sono scritte, comprese quelle dentro `@media` e `@container`. */
export function parseCss(css: string): CssRule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: CssRule[] = [];
  const walk = (text: string, at: string | null) => {
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf("{", index);
      if (open === -1) break;
      const prelude = squeeze(text.slice(index, open));
      let depth = 1;
      let close = open + 1;
      while (close < text.length && depth > 0) {
        if (text[close] === "{") depth++;
        else if (text[close] === "}") depth--;
        close++;
      }
      const body = text.slice(open + 1, close - 1);
      if (prelude.startsWith("@")) walk(body, prelude);
      else for (const selector of splitTop(prelude, ",")) out.push({ at, selector: squeeze(selector), declarations: parseDeclarations(body) });
      index = close;
    }
  };
  walk(source, null);
  return out;
}

/** Le dichiarazioni di un selettore in un contesto, con le regole ripetute unite nell'ordine (l'ultima vince). Null se non c'è. */
export function declarationsOf(rules: readonly CssRule[], selector: string, at: string | null = null): Map<string, string> | null {
  const found = rules.filter((rule) => rule.selector === selector && rule.at === at);
  if (found.length === 0) return null;
  const out = new Map<string, string>();
  for (const rule of found) for (const [property, value] of rule.declarations) out.set(property, value);
  return out;
}

/** Senza spazi dove non contano: `a , b` e `a,b`, `x : y` e `x:y` sono lo stesso valore. */
export const compact = (value: string) => value.replace(/\s*([,:()/])\s*/g, "$1").replace(/\s+/g, " ").trim();

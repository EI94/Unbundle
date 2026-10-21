/**
 * Prefisso dei codici e slug di un workspace, proposti dal nome (docs/use-case/DESIGN.md
 * §10.6, D6). Li usano `use-case-admin configs` (prova a secco, poi `--apply`),
 * `createWorkspace` e Impostazioni › Valutazione › «Codici degli use case».
 *
 * - **Prefisso** (`proposePrefix`): lettere senza accenti; parole separate da tutto ciò che
 *   non è una lettera; tolte le parole vuote (di, e, la, il, the, srl, spa, anche scritte
 *   «S.p.A.» o «S.r.l.»); con 2 o più parole le iniziali delle prime 3; con una parola le
 *   prime 3 lettere; meno di 2 lettere → `UC`. Rispetta sempre il CHECK della 0019
 *   (`^[A-Z]{2,4}$`).
 * - **Slug** (`proposeSlug`): minuscole senza accenti, tutto il resto diventa `-`, da 3 a
 *   40 caratteri; già usato → `-2`, `-3`…; troppo corto → `ws-` più i primi 8 caratteri
 *   dell'id del workspace. Rispetta sempre il CHECK della 0019 (`^[a-z0-9-]{3,40}$`).
 * - **Slug di un workspace nuovo** (`slugForNewWorkspace`): unico per costruzione, senza
 *   leggere gli altri: base dal nome troncata, poi `-` e i primi 8 caratteri dell'id.
 *   `ON CONFLICT` non salva da un CHECK: lo slug deve essere valido già qui.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { USE_CASE_CODE_PREFIX_PATTERN } from "../portfolio/use-case-code.ts";

/** Prefisso quando il nome non ne dà uno. */
export const FALLBACK_CODE_PREFIX = "UC";

/** Parole che non danno un'iniziale. */
export const PREFIX_STOP_WORDS: readonly string[] = Object.freeze(["di", "e", "la", "il", "the", "srl", "spa"]);

/** CHECK di `workspace_connector_configs.slug` (0019). */
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;
export const WORKSPACE_SLUG_MIN_LENGTH = 3;
export const WORKSPACE_SLUG_MAX_LENGTH = 40;

/** Lettere latine che la scomposizione Unicode non separa dall'accento. */
const LATIN_FOLD: Readonly<Record<string, string>> = {
  ß: "ss",
  ẞ: "SS",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "TH",
  ı: "i",
};

/** Il testo con le sole lettere di base: «Città Società» → «Citta Societa». */
function foldAccents(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ßẞæÆœŒøØłŁđĐðÐþÞı]/g, (ch) => LATIN_FOLD[ch] ?? ch);
}

/**
 * «S.p.A.» e «s.r.l» → «SpA» e «srl»: una sigla puntata si unisce solo se diventa una
 * parola vuota. Ogni altra sigla resta com'è, e i suoi punti separano le parole (§10.6):
 * «A.B.C. Consulenze» ha le parole a, b, c, consulenze.
 */
function joinDottedStopWords(text: string): string {
  return text.replace(/(?<![A-Za-z])(?:[A-Za-z]\.)+[A-Za-z]\.?(?![A-Za-z])/g, (acronym) => {
    const joined = acronym.replace(/\./g, "");
    return PREFIX_STOP_WORDS.includes(joined.toLowerCase()) ? joined : acronym;
  });
}

/** Le parole del nome che contano per il prefisso, in minuscolo. */
export function prefixWords(name: string | null | undefined): string[] {
  if (typeof name !== "string") return [];
  return joinDottedStopWords(foldAccents(name))
    .split(/[^A-Za-z]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word !== "" && !PREFIX_STOP_WORDS.includes(word));
}

/** Il prefisso proposto dal nome del workspace: 2-4 lettere maiuscole, altrimenti `UC`. */
export function proposePrefix(name: string | null | undefined): string {
  const words = prefixWords(name);
  const letters = words.length >= 2 ? words.slice(0, 3).map((word) => word[0]).join("") : (words[0] ?? "").slice(0, 3);
  const prefix = letters.toUpperCase();
  return USE_CASE_CODE_PREFIX_PATTERN.test(prefix) ? prefix : FALLBACK_CODE_PREFIX;
}

/** Vero per un prefisso che il CHECK della 0019 accetta. */
export function isValidCodePrefix(value: unknown): value is string {
  return typeof value === "string" && USE_CASE_CODE_PREFIX_PATTERN.test(value);
}

/** Vero per uno slug che il CHECK della 0019 accetta. */
export function isValidWorkspaceSlug(value: unknown): value is string {
  return typeof value === "string" && WORKSPACE_SLUG_PATTERN.test(value);
}

function trimDashes(text: string): string {
  return text.replace(/^-+|-+$/g, "");
}

/** Minuscole senza accenti, ogni altro carattere `-`, al massimo `max` caratteri, senza `-` ai bordi. */
function slugBase(name: string | null | undefined, max: number): string {
  if (typeof name !== "string") return "";
  const dashed = trimDashes(foldAccents(name).toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  return trimDashes(dashed.slice(0, max));
}

/** I primi 8 caratteri dell'id, solo lettere minuscole e cifre. */
function idTail(workspaceId: string): string {
  return String(workspaceId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
}

/**
 * Lo slug proposto: quello del nome se è lungo almeno 3 caratteri, altrimenti `ws-` e
 * l'id; se è già usato (`taken`, senza distinguere maiuscole), con `-2`, `-3`… sempre
 * entro 40 caratteri.
 */
export function proposeSlug(name: string | null | undefined, taken: Iterable<string>, workspaceId: string): string {
  const used = new Set<string>();
  for (const slug of taken) used.add(String(slug).toLowerCase());
  let base = slugBase(name, WORKSPACE_SLUG_MAX_LENGTH);
  if (base.length < WORKSPACE_SLUG_MIN_LENGTH) base = `ws-${idTail(workspaceId)}`;
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${trimDashes(base.slice(0, WORKSPACE_SLUG_MAX_LENGTH - suffix.length))}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Lo slug di un workspace appena creato (`createWorkspace`): base dal nome troncata, poi
 * `-` e i primi 8 caratteri dell'id. Unico perché l'id è unico; valido per costruzione.
 * Un nome senza lettere né cifre dà `ws-` e l'id.
 */
export function slugForNewWorkspace(name: string | null | undefined, workspaceId: string): string {
  const tail = idTail(workspaceId) || "0";
  const base = slugBase(name, WORKSPACE_SLUG_MAX_LENGTH - tail.length - 1);
  return base ? `${base}-${tail}` : `ws-${tail}`;
}

/**
 * Schema degli ID delle voci di un template (PIANO §4.1, regola 2).
 *
 * Ogni tipo di voce ha un prefisso proprio, in corrispondenza biunivoca. I campi
 * sono l'eccezione: `<entita>.<campo>`, dove `<entita>` è il nome di
 * un'entità esistente (`ent.<entita>`) e il campo ha `parent = "ent.<entita>"`.
 * Il tipo `documento` (non citato dalla tabella del piano) usa `doc.`.
 *
 * Modulo puro.
 */
import { ITEM_KINDS, type ItemKind } from "../vocab.ts";

/** Lunghezza massima di una chiave (colonna `uc_items.key varchar(160)`). */
export const MAX_ITEM_KEY_LENGTH = 160;

/** Prefisso dell'ID per ogni tipo, tranne `campo`. */
export const KIND_PREFIX = {
  entita: "ent",
  kpi: "kpi",
  regola: "rule",
  fonte: "src",
  domanda: "q",
  decisione: "dv",
  parametro: "par",
  vincolo_rigido: "hc",
  vincolo_morbido: "sc",
  obiettivo: "obj",
  incertezza: "unc",
  uscita: "out",
  formula: "f",
  controllo_qualita: "dq",
  documento: "doc",
} as const satisfies Record<Exclude<ItemKind, "campo">, string>;

/** Prefissi riservati: non possono essere nomi di entità (né prefissi di campi). */
export const RESERVED_PREFIXES: readonly string[] = Object.values(KIND_PREFIX);

const PREFIX_TO_KIND: ReadonlyMap<string, ItemKind> = new Map(
  (Object.entries(KIND_PREFIX) as [Exclude<ItemKind, "campo">, string][]).map(([kind, prefix]) => [prefix, kind]),
);

/** Schema dell'ID per tipo. */
export const ID_PATTERNS: Readonly<Record<ItemKind, RegExp>> = {
  entita: /^ent\.[a-z][a-z0-9_]*$/,
  campo: /^[a-z][a-z0-9_]*\.[a-z0-9][a-z0-9_]*$/,
  kpi: /^kpi\.[a-z][a-z0-9_]*\.[a-z0-9_]+$/,
  regola: /^rule\.[a-z][a-z0-9_]*\.[a-z0-9_]+$/,
  fonte: /^src\.[a-z0-9][a-z0-9_]*\.[a-z0-9_]+$/,
  domanda: /^q\.[a-z][a-z0-9_]*\.\d{2,}$/,
  decisione: /^dv\.[a-z0-9][a-z0-9_]*$/,
  parametro: /^par\.[a-z0-9][a-z0-9_]*$/,
  vincolo_rigido: /^hc\.[a-z0-9][a-z0-9_]*$/,
  vincolo_morbido: /^sc\.[a-z0-9][a-z0-9_]*$/,
  obiettivo: /^obj\.[a-z0-9][a-z0-9_]*$/,
  incertezza: /^unc\.[a-z0-9][a-z0-9_]*$/,
  uscita: /^out\.[a-z0-9][a-z0-9_]*$/,
  formula: /^f\.[a-z0-9][a-z0-9_]*$/,
  controllo_qualita: /^dq\.[a-z0-9][a-z0-9_]*$/,
  documento: /^doc\.[a-z0-9][a-z0-9_]*$/,
};

/** Primo segmento della chiave (`ent`, `kpi`, oppure il nome dell'entità di un campo). */
export function keyPrefix(key: string): string {
  const dot = key.indexOf(".");
  return dot === -1 ? key : key.slice(0, dot);
}

/** Il tipo che il prefisso della chiave indica; `campo` se il prefisso non è riservato. */
export function kindForKey(key: string): ItemKind {
  return PREFIX_TO_KIND.get(keyPrefix(key)) ?? "campo";
}

/** Nome dell'entità di un campo (`richiesta.canale` → `richiesta`). */
export function fieldEntityKey(fieldKey: string): string {
  return `ent.${keyPrefix(fieldKey)}`;
}

export interface KeyIssue {
  code: "id_lunghezza" | "id_schema" | "id_tipo_prefisso" | "id_entita_riservata" | "id_campo_entita" | "id_campo_parent";
  message: string;
}

/**
 * Controlla l'ID di una voce. `entityKeys` sono le chiavi `ent.*` del template:
 * servono per i campi (prefisso = entità esistente, `parent = "ent.<prefisso>"`).
 */
export function checkItemKey(
  item: { key: string; kind: ItemKind; parent?: string | null },
  entityKeys: ReadonlySet<string>,
): KeyIssue | null {
  const { key, kind } = item;
  if (key.length === 0 || key.length > MAX_ITEM_KEY_LENGTH) {
    return { code: "id_lunghezza", message: `La chiave «${clip(key)}» deve avere da 1 a ${MAX_ITEM_KEY_LENGTH} caratteri.` };
  }
  if (!(ITEM_KINDS as readonly string[]).includes(kind)) {
    return { code: "id_schema", message: `Tipo di voce sconosciuto per «${clip(key)}».` };
  }
  if (!ID_PATTERNS[kind].test(key)) {
    return { code: "id_schema", message: `La chiave «${clip(key)}» non segue lo schema degli ID per il tipo ${kind}.` };
  }
  if (kindForKey(key) !== kind) {
    return { code: "id_tipo_prefisso", message: `La chiave «${clip(key)}» ha il prefisso di un altro tipo (${kindForKey(key)}), non di ${kind}.` };
  }
  if (kind === "entita") {
    const name = key.slice("ent.".length);
    if (RESERVED_PREFIXES.includes(name)) {
      return { code: "id_entita_riservata", message: `«${clip(key)}»: il nome di un'entità non può essere un prefisso riservato.` };
    }
  }
  if (kind === "campo") {
    const entity = fieldEntityKey(key);
    if (!entityKeys.has(entity)) {
      return { code: "id_campo_entita", message: `Il campo «${clip(key)}» non ha un'entità «${entity}» nel template.` };
    }
    if (item.parent !== entity) {
      return { code: "id_campo_parent", message: `Il campo «${clip(key)}» deve avere parent «${entity}».` };
    }
  }
  return null;
}

/** Vero se la chiave segue lo schema di un tipo qualsiasi (per riconoscere riferimenti nei testi). */
export function looksLikeItemKey(key: string): boolean {
  return key.length <= MAX_ITEM_KEY_LENGTH && ID_PATTERNS[kindForKey(key)].test(key);
}

function clip(s: string): string {
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

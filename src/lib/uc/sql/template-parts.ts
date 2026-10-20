/**
 * Le parti della definizione del template che leggono le pagine del dossier
 * (ruoli, moduli di richiesta con i loro testi, gate, conto dello schema di
 * partenza), estratte una volta per impronta e poi tenute in memoria nel
 * processo (DESIGN §7.1 P0-5 b).
 *
 * La definizione può pesare qualche MB: estrarne anche solo i ruoli vuol dire
 * leggerla tutta a ogni pagina. L'impronta (`definition_hash`) è quella della
 * definizione canonica e un template pubblicato non cambia
 * (`uc_templates_immutable`): la stessa impronta ha sempre le stesse parti.
 * Così la query chiede `template_parts` solo per le impronte che il processo
 * non ha ancora visto (`CASE WHEN t.definition_hash = ANY(known) …`); per le
 * altre Postgres non apre la definizione e le parti arrivano dalla memoria.
 *
 * Uso, in un solo giro (l'elenco delle impronte note si copia prima della
 * query, così una richiesta che nel frattempo sfoltisce la memoria non toglie
 * le parti a questa):
 *
 *   const parts = templatePartsReader();
 *   const [rows] = await executor.batch([toStatement(ucSql`SELECT ${parts.columns} FROM uc_cases c JOIN uc_templates t …`)]);
 *   const p = parts.read(rows[0]); // null senza riga o senza impronta valida
 *
 * Chi ordina in SQL nell'ordine dello schema (argomenti di Domande, ruoli di
 * Regole) usa `templateKeyListSql`: l'elenco delle chiavi arriva come
 * parametro per le impronte già in memoria.
 *
 * La query deve avere il template con l'alias `t`. Modulo senza import
 * dell'app e leggero (solo `statement.ts`): lo importa anche `catalog-filter.ts`,
 * che arriva nei componenti client. La memoria è del processo (un'istanza
 * serverless la riempie al primo giro).
 */
import type { Json } from "../types.ts";
import { cast, jsonb, raw, ucSql, type SqlFragment } from "./statement.ts";

/** Modulo di richiesta del template: chiave, titolo, ruolo e i testi per il referente. */
export interface TemplateModulePart {
  key: string;
  title: string | null;
  role_key: string | null;
  why: string | null;
  instructions: string | null;
  estimated_label: string | null;
  /** Solo se nello schema è un numero. */
  estimated_minutes: number | null;
}

export interface TemplateParts {
  /** `definition.roles`, così com'è (elenco vuoto se manca). */
  roles: Json[];
  /** Moduli di richiesta nell'ordine del template. */
  modules: TemplateModulePart[];
  /** `definition.gates`, così com'è (elenco vuoto se manca). */
  gates: Json[];
  /** `definition.roi`, il conto dello schema di partenza (null se manca). */
  roi: Json | null;
}

const HASH = /^[0-9a-f]{64}$/;
/** Impronte tenute in memoria; oltre il limite esce la più vecchia. */
export const TEMPLATE_PARTS_MAX = 200;
const MEMORY = new Map<string, TemplateParts>();

function hashOf(v: unknown): string | null {
  return typeof v === "string" && HASH.test(v.trim()) ? v.trim() : null;
}

/** `t.definition -> '<elenco>'` se è un array, altrimenti un array vuoto. */
function definitionList(list: "roles" | "request_modules" | "gates"): SqlFragment {
  const key = raw(`'${list}'`);
  return ucSql`CASE WHEN jsonb_typeof(t.definition -> ${key}) = 'array' THEN t.definition -> ${key} ELSE '[]'::jsonb END`;
}

/**
 * Le colonne `template_hash` e `template_parts` sul template `t`: le parti
 * solo per un'impronta che non è in `known` (altrimenti `NULL`, e la
 * definizione non si legge).
 */
export function templatePartsColumns(known: readonly string[]): SqlFragment {
  const hashes = [...new Set(known.map(hashOf).filter((h): h is string => h !== null))];
  return ucSql`t.definition_hash AS template_hash,
  CASE WHEN t.definition_hash = ANY(${cast(hashes, "text[]")}) THEN NULL ELSE jsonb_build_object(
    'roles', ${definitionList("roles")},
    'modules', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', m.elem ->> 'key', 'title', m.elem ->> 'title', 'role_key', m.elem ->> 'role_key',
        'why', m.elem ->> 'why', 'instructions', m.elem ->> 'instructions', 'estimated_label', m.elem ->> 'estimated_label',
        'estimated_minutes', CASE WHEN jsonb_typeof(m.elem -> 'estimated_minutes') = 'number' THEN m.elem -> 'estimated_minutes' END) ORDER BY m.ord), '[]'::jsonb)
      FROM jsonb_array_elements(${definitionList("request_modules")}) WITH ORDINALITY AS m(elem, ord)),
    'gates', ${definitionList("gates")},
    'roi', t.definition -> 'roi'
  ) END AS template_parts`;
}

/** Valore jsonb della riga: il driver lo dà già letto, oppure come testo. */
function jsonOf(v: unknown): unknown {
  if (typeof v !== "string") return v ?? null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return null;
  }
}

/** Le parti lette dal database; null se la colonna è vuota o non ha la forma attesa. */
export function parseTemplateParts(v: unknown): TemplateParts | null {
  const o = jsonOf(v) as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const list = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
  const text = (x: unknown): string | null => (typeof x === "string" ? x : null);
  const modules = list(o.modules).flatMap((m): TemplateModulePart[] => {
    if (!m || typeof m !== "object" || Array.isArray(m) || typeof m.key !== "string") return [];
    const minutes = m.estimated_minutes;
    return [
      {
        key: m.key,
        title: text(m.title),
        role_key: text(m.role_key),
        why: text(m.why),
        instructions: text(m.instructions),
        estimated_label: text(m.estimated_label),
        estimated_minutes: typeof minutes === "number" && Number.isFinite(minutes) ? minutes : null,
      },
    ];
  });
  return { roles: list(o.roles), modules, gates: list(o.gates), roi: o.roi === undefined ? null : (o.roi as Json) };
}

function remember(hash: string, parts: TemplateParts): void {
  MEMORY.delete(hash);
  while (MEMORY.size >= TEMPLATE_PARTS_MAX) {
    const oldest = MEMORY.keys().next();
    if (oldest.done) break;
    MEMORY.delete(oldest.value);
  }
  MEMORY.set(hash, parts);
}

export interface TemplatePartsReader {
  /** Impronte già note al momento della lettura. */
  readonly known: readonly string[];
  /** Da mettere nella SELECT (template con l'alias `t`). */
  readonly columns: SqlFragment;
  /** Le parti della riga: dalla riga se ci sono (e si ricordano), altrimenti dalla memoria. */
  read(row: Record<string, unknown> | undefined): TemplateParts | null;
}

/** Un lettore per una query: copia l'elenco delle impronte note e risolve la riga dopo. */
export function templatePartsReader(): TemplatePartsReader {
  const snapshot = new Map(MEMORY);
  const known = [...snapshot.keys()];
  return {
    known,
    columns: templatePartsColumns(known),
    read(row) {
      if (!row) return null;
      const hash = hashOf(row.template_hash);
      const fresh = parseTemplateParts(row.template_parts);
      if (fresh) {
        if (hash) remember(hash, fresh);
        return fresh;
      }
      return hash ? (snapshot.get(hash) ?? null) : null;
    },
  };
}

function roleKey(r: Json): string | null {
  return r && typeof r === "object" && !Array.isArray(r) && typeof r.key === "string" ? r.key : null;
}

/**
 * L'elenco `roles` o `request_modules` dello schema del template `t`, come
 * array jsonb di oggetti con `key`, nell'ordine dello schema: per ordinare in
 * SQL (`jsonb_array_elements(…) WITH ORDINALITY`, `elem ->> 'key'`). Per le
 * impronte in memoria l'elenco delle chiavi arriva come parametro e la
 * definizione non si legge (`coalesce` valuta il secondo argomento solo se il
 * primo è nullo); per le altre si legge dalla definizione, con la stessa forma.
 */
export function templateKeyListSql(list: "roles" | "request_modules"): SqlFragment {
  const known: Record<string, { key: string }[]> = {};
  for (const [hash, parts] of MEMORY) {
    const keys = list === "roles" ? parts.roles.map(roleKey).filter((k): k is string => k !== null) : parts.modules.map((m) => m.key);
    known[hash] = keys.map((key) => ({ key }));
  }
  return ucSql`coalesce(${jsonb(known)} -> t.definition_hash::text, ${definitionList(list)})`;
}

/** Impronte in memoria adesso (per i test e per la diagnostica). */
export function rememberedTemplateHashes(): string[] {
  return [...MEMORY.keys()];
}

/** Svuota la memoria (solo per i test). */
export function forgetTemplateParts(): void {
  MEMORY.clear();
}

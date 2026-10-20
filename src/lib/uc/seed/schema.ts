/**
 * Formato del file di seed di un caso (`unbundle.uc-case-seed/1`, PIANO §8.1)
 * e del file privato dei nomi da oscurare.
 *
 * Il seed descrive lo stato di partenza di un caso già discusso con il
 * cliente: descrizione, mappa e processi, ROI, ruoli dei referenti (senza nomi
 * né contatti), blocchi aperti, milestone e, per ogni domanda, lo stato
 * iniziale con l'eventuale valore già dichiarato nelle call.
 *
 * Regole che il formato impone già qui:
 * - uno stato iniziale solo tra `da_chiedere`, `in_verifica`, `bloccata`,
 *   `mancante` (validata e non applicabile richiedono firme e verifiche);
 * - un blocco solo `aperto` o `permanente`: il seed non può sciogliere un blocco
 *   (lo scioglimento di A.8 richiede due firme);
 * - un valore dichiarato ha sempre la provenienza `dichiarato_in_call`;
 * - chiavi delle domande uniche.
 *
 * Gli errori riportano solo il percorso e il codice, mai il testo del file.
 * Modulo puro.
 */
import { z } from "zod";
import type { Result } from "../types.ts";
import { fail, ok } from "../types.ts";

export const SEED_SCHEMA_ID = "unbundle.uc-case-seed/1" as const;

/** Stati che un seed può scrivere come import (PIANO §8.1, D27). */
export const SEED_INITIAL_STATES = ["da_chiedere", "in_verifica", "bloccata", "mancante"] as const;
export type SeedInitialState = (typeof SEED_INITIAL_STATES)[number];

/** Stati di un blocco nel seed: `aperto` diventa `attivo`, `permanente` resta. */
export const SEED_BLOCKER_STATUSES = ["aperto", "permanente"] as const;

/** Stati del caso ammessi dal seed (import, fuori dalla macchina a stati). */
export const SEED_CASE_STATUSES = ["bozza", "raccolta"] as const;

/** Limite del file di seed letto dagli script. */
export const SEED_MAX_BYTES = 8 * 1024 * 1024;

const TEXT_MAX = 20_000;
const text = z.string().max(TEXT_MAX);
const shortText = z.string().max(500);
const texts = z.array(text).max(500);
const nodeId = z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/);
const refKey = z.string().max(160);

const templateKey = z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/).max(120);
const semver = z.string().regex(/^\d+\.\d+\.\d+$/);
const questionKey = z.string().regex(/^q\.[a-z][a-z0-9_]*\.\d{2,}$/).max(160);
const blockerKey = z.string().regex(/^[a-z0-9_]{1,60}$/);
const caseCode = z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/);

const processStep = z.strictObject({
  id: nodeId,
  fase: shortText,
  nome: text,
  chi: text,
  strumento: text,
  input: texts,
  output: texts,
  decisione_umana: text,
  attrito: text,
  tempo: text,
  fonte: text,
  dati: z.array(refKey).max(500),
  note_dati: texts.optional(),
  posizione: shortText.optional(),
  // Solo nel processo con l'agente.
  perimetro: shortText.optional(),
  priorita: shortText.optional(),
  disponibilita: text.optional(),
  leve: z.array(shortText).max(20).optional(),
  serve_per: z.array(shortText).max(20).optional(),
});

const mapBlock = z.strictObject({
  id: nodeId,
  titolo: text,
  chi: text,
  descrizione: text,
  input: texts,
  output: texts,
  perimetro: shortText,
  priorita: shortText,
  disponibilita: text,
  leve: z.array(shortText).max(20),
  serve_per: z.array(shortText).max(20),
  privacy: text,
  kpi: z.array(refKey).max(200),
  documenti_cliente: z
    .array(
      z.strictObject({
        voce: text,
        tipo_risposta: shortText,
        stato_iniziale: shortText,
        owner: shortText,
        nota: text.optional(),
      }),
    )
    .max(200),
});

const answer = z
  .strictObject({
    item_key: questionKey,
    initial_state: z.enum(SEED_INITIAL_STATES),
    known_value: text.nullable(),
    known_value_source_kind: z.literal("dichiarato_in_call").nullable(),
    blocked_by: z.array(blockerKey).max(10),
  })
  .superRefine((a, ctx) => {
    const hasValue = a.known_value !== null && a.known_value.trim() !== "";
    if (hasValue !== (a.known_value_source_kind !== null)) {
      ctx.addIssue({ code: "custom", message: "valore_senza_provenienza", path: ["known_value_source_kind"] });
    }
  });

export const SeedSchema = z
  .strictObject({
    schema: z.literal(SEED_SCHEMA_ID),
    template: z.strictObject({ key: templateKey, version: semver }),
    workspace_hint: z.string().min(1).max(300),
    case: z.strictObject({
      code: caseCode,
      title: z.string().min(1).max(255),
      one_liner: z.string().max(500).nullable(),
      status: z.enum(SEED_CASE_STATUSES),
      perimeter_label: z.string().max(255).nullable(),
      owner_role_label: z.string().max(255).nullable(),
    }),
    description: z.strictObject({
      titolo: text,
      sottotitolo: text,
      in_breve: text,
      problema: text,
      soluzione: text,
      come_funziona: texts,
      cosa_non_fa: texts,
      per_chi: z.array(z.strictObject({ ruolo: text, cosa_cambia: text })).max(100),
      leve: z.array(z.strictObject({ leva: shortText, come: text, kpi: text })).max(20),
      perimetro: z.strictObject({ caso_commerciale: texts, evoluzione: texts }),
      fasi: z.array(z.strictObject({ fase: text, quando: text, cosa: text, uscita: text })).max(50),
      prerequisiti: texts,
      rischi: z.array(z.strictObject({ rischio: text, mitigazione: text })).max(100),
      domande_aperte: texts,
    }),
    map: z.strictObject({
      titolo: z.string().max(255),
      blocchi: z.array(mapBlock).max(200),
      flussi: z.array(z.strictObject({ da: nodeId, a: nodeId, etichetta: text })).max(1000),
    }),
    process: z.strictObject({
      as_is: z.array(processStep).max(500),
      to_be: z.array(processStep).max(500),
      esempio_end_to_end: z.strictObject({ titolo: z.string().max(255), passi: texts }),
    }),
    roi: z.strictObject({
      spiegazione: text,
      leve: z
        .array(
          z.strictObject({
            leva: shortText,
            kpi: z.array(refKey).max(100),
            come_diventa_euro: text,
            formula: text,
            dati_necessari: texts,
            esempio_illustrativo: text,
          }),
        )
        .max(20),
      costi: z.array(z.strictObject({ voce: text, tipo: shortText, come_si_stima: text, fonte: text })).max(200),
      formula_roi: z.strictObject({ spiegazione: text, break_even: text, valore_5_anni: text }),
      esempio: z.strictObject({ nota: text, righe: z.array(z.strictObject({ voce: text, valore: text })).max(500) }),
      cosa_serve: texts,
    }),
    contacts_roles: z
      .array(z.strictObject({ template_role_key: z.string().regex(/^[a-z0-9_]{1,80}$/), role_label: z.string().min(1).max(255) }))
      .max(50),
    contacts_note: text.optional(),
    blockers: z.array(z.strictObject({ key: blockerKey, status: z.enum(SEED_BLOCKER_STATUSES) })).max(50),
    milestones: z
      .array(
        z.strictObject({
          key: z.string().regex(/^[a-z0-9_]{1,60}$/),
          title: z.string().min(1).max(255),
          planned_label: text.nullable(),
          is_proposal: z.boolean(),
          notes: text.nullable(),
        }),
      )
      .max(100),
    answers: z.array(answer).max(10_000),
  })
  .superRefine((seed, ctx) => {
    const unique = (values: string[], path: (string | number)[], code: string) => {
      const seen = new Set<string>();
      values.forEach((v, i) => {
        if (seen.has(v)) ctx.addIssue({ code: "custom", message: code, path: [...path, i] });
        seen.add(v);
      });
    };
    unique(seed.answers.map((a) => a.item_key), ["answers"], "chiave_doppia");
    unique(seed.blockers.map((b) => b.key), ["blockers"], "blocco_doppio");
    unique(seed.milestones.map((m) => m.key), ["milestones"], "milestone_doppia");
    unique(seed.map.blocchi.map((b) => b.id), ["map", "blocchi"], "nodo_doppio");
    unique(seed.contacts_roles.map((r) => r.template_role_key), ["contacts_roles"], "ruolo_doppio");
    seed.blockers.forEach((b, i) => {
      if ((b.key === "sanitario") !== (b.status === "permanente")) {
        ctx.addIssue({ code: "custom", message: "solo_sanitario_permanente", path: ["blockers", i, "status"] });
      }
    });
  });

export type CaseSeed = z.output<typeof SeedSchema>;
export type SeedAnswer = CaseSeed["answers"][number];
export type SeedProcessStep = CaseSeed["process"]["as_is"][number];
export type SeedMapBlock = CaseSeed["map"]["blocchi"][number];

/** Un problema del file: percorso e codice, mai il testo. */
export interface SeedFileIssue {
  path: string;
  code: string;
}

function issuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, p) => (typeof p === "number" ? `${out}[${p}]` : out ? `${out}.${String(p)}` : String(p)), "");
}

function issuesOf(error: z.ZodError): SeedFileIssue[] {
  return error.issues.slice(0, 50).map((i) => ({
    path: issuePath(i.path),
    code: i.code === "custom" && /^[a-z_]{1,60}$/.test(i.message) ? i.message : i.code,
  }));
}

export type SeedParseResult = { ok: true; value: CaseSeed } | { ok: false; code: string; message: string; issues: SeedFileIssue[] };

/** Valida un seed già letto. */
export function validateSeed(input: unknown): SeedParseResult {
  const parsed = SeedSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = issuesOf(parsed.error);
  return {
    ok: false,
    code: "seed_non_valido",
    message: `Il file di seed non è valido (${issues.length === 1 ? "1 problema" : `${issues.length} problemi`}).`,
    issues,
  };
}

/** Legge e valida il testo del file di seed (≤ 8 MB). */
export function parseSeedText(textValue: string): SeedParseResult {
  if (new TextEncoder().encode(textValue).length > SEED_MAX_BYTES) {
    return { ok: false, code: "file_troppo_grande", message: "Il file di seed supera 8 MB.", issues: [] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(textValue.replace(/^﻿/, ""));
  } catch {
    return { ok: false, code: "json_non_valido", message: "Il file di seed non è un JSON valido.", issues: [] };
  }
  return validateSeed(raw);
}

// ── File dei nomi da oscurare ─────────────────────────────────────────

/**
 * File privato (`*.private.json`, ignorato da git) con i nomi delle persone da
 * oscurare nei testi del seed: un elenco di stringhe, oppure `{ names: [...] }`.
 */
const personName = z
  .string()
  .transform((s) => s.normalize("NFC").replace(/\s+/g, " ").trim())
  .pipe(z.string().min(2).max(120));

export const RedactionNamesSchema = z.union([
  z.array(personName).max(2000),
  z.strictObject({ schema: z.literal("unbundle.uc-redaction-names/1").optional(), names: z.array(personName).max(2000) }),
]);

/** Legge il file dei nomi. Restituisce i nomi senza doppioni, dal più lungo (così «Anna Maria» vince su «Anna»). */
export function parseRedactionNames(textValue: string): Result<string[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(textValue.replace(/^﻿/, ""));
  } catch {
    return fail("json_non_valido", "Il file dei nomi non è un JSON valido.");
  }
  const parsed = RedactionNamesSchema.safeParse(raw);
  if (!parsed.success) return fail("nomi_non_validi", "Il file dei nomi deve essere un elenco di nomi (da 2 a 120 caratteri).");
  const list = Array.isArray(parsed.data) ? parsed.data : parsed.data.names;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of list) {
    const k = name.toLocaleLowerCase("it");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  out.sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  return ok(out);
}

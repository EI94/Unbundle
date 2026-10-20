/**
 * Formattazione comune degli export del catalogo (Markdown e fogli Excel).
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import type { SnapshotAnswer, SnapshotItem } from "../snapshot.ts";

/** Etichette degli stati: le stesse del semaforo dell'interfaccia. */
export { STATUS_LABEL as STATUS_LABELS } from "../semaforo.ts";

export const HIDDEN_LABELS: Readonly<Record<NonNullable<SnapshotAnswer["value_hidden"]>, string>> = {
  personale: "nascosto: dato personale",
  visibilita: "nascosto per il tuo ruolo",
  ambiente_non_approvato: "nascosto: ambiente non approvato",
};

const MAX_VALUE_CHARS = 2000;

function clip(text: string, max = MAX_VALUE_CHARS): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function scalar(v: Json | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/** Le scelte delle conferme (regola, formula, valore) con le parole della pagina del referente. */
const CHOICE_LABELS: Readonly<Record<string, string>> = { confermo: "È così", correggo: "Va corretta", non_vale: "Non vale" };

/** Valore leggibile di una risposta, senza interpretazioni: testo, numero e unità, importo, scelta. */
export function displayJsonValue(value: Json | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = scalar(value);
  if (s !== null) return clip(s);
  if (Array.isArray(value)) return clip(value.map((v) => displayJsonValue(v)).filter(Boolean).join("; "));
  const o = value as { [key: string]: Json };
  if (typeof o.choice === "string") {
    const choice = CHOICE_LABELS[o.choice] ?? o.choice;
    const extra = scalar(o.text) ?? scalar(o.value) ?? scalar(o.formula);
    const exceptions = typeof o.exceptions === "string" && o.exceptions.trim() !== "" ? `eccezioni: ${o.exceptions.trim()}` : null;
    return clip([extra ? `${choice}: ${extra}` : choice, exceptions].filter(Boolean).join("; "));
  }
  if (typeof o.text === "string") return clip(o.text);
  // `si_no`: {value: true|false}
  if (typeof o.value === "boolean") return o.value ? "Sì" : "No";
  // `percentuale`: {value, base}, la base è obbligatoria
  if (typeof o.value === "number" && typeof o.base === "string") return clip(`${scalar(o.value)}% ${o.base}`.trim());
  // `data_ora`: {local, tz}
  if (typeof o.local === "string") return clip(`${o.local.replace("T", " ")}${typeof o.tz === "string" && o.tz !== "" ? ` (${o.tz})` : ""}`);
  if (o.amount !== undefined && typeof o.currency === "string") {
    const parts = [`${scalar(o.amount) ?? ""} ${o.currency}`.trim()];
    if (typeof o.vat === "string") parts.push(`IVA ${o.vat}`);
    if (typeof o.per === "string") parts.push(`per ${o.per}`);
    return clip(parts.join(", "));
  }
  if (o.value !== undefined && (typeof o.unit === "string" || o.unit === null)) {
    return clip([scalar(o.value) ?? displayJsonValue(o.value), typeof o.unit === "string" ? o.unit : ""].filter(Boolean).join(" "));
  }
  if (o.amount !== undefined && typeof o.unit === "string") return clip(`${scalar(o.amount) ?? ""} ${o.unit}`.trim());
  if (o.from !== undefined && o.to !== undefined) return clip(`${displayJsonValue(o.from)} – ${displayJsonValue(o.to)}${typeof o.unit === "string" ? ` ${o.unit}` : ""}`);
  if (typeof o.option === "string") return clip(typeof o.other_text === "string" ? `${o.option}: ${o.other_text}` : o.option);
  if (Array.isArray(o.options)) return clip(o.options.map((v) => displayJsonValue(v)).join(", "));
  if (typeof o.code === "string") return clip(o.code);
  if (Array.isArray(o.rows)) return `Tabella: ${o.rows.length} righe`;
  if (Array.isArray(o.file_ids)) return `${o.file_ids.length} file`;
  return clip(JSON.stringify(value));
}

/** Valore della risposta per l'export, oppure il motivo per cui è nascosto. */
export function displayAnswer(answer: SnapshotAnswer | null): string {
  if (!answer) return "";
  if (answer.value_hidden) return `(${HIDDEN_LABELS[answer.value_hidden]})`;
  return displayJsonValue(answer.value ?? answer.value_normalized);
}

const SOURCE_LABELS: Readonly<Record<SnapshotAnswer["source_kind"], string>> = {
  referente: "referente",
  lateral_space: "Lateral Space",
  documento: "documento",
  sistema: "sistema",
  import: "import",
  ai_proposta: "proposta AI",
  dichiarato_in_call: "dichiarato in call",
};

/** «dichiarato in call · F001», «referente», … */
export function displaySource(answer: SnapshotAnswer | null): string {
  if (!answer) return "";
  const label = SOURCE_LABELS[answer.source_kind] ?? answer.source_kind;
  return answer.source_ref ? `${label} · ${answer.source_ref}` : label;
}

/** In una bozza, le voci non a posto si segnano «non validata». */
export function isItemOkForExport(item: SnapshotItem): boolean {
  return item.status === "validata" || (item.status === "non_applicabile" && item.na !== null);
}

export function specText(item: SnapshotItem, ...keys: string[]): string {
  for (const k of keys) {
    const v = item.spec[k];
    const s = scalar(v);
    if (s !== null && s.trim()) return s;
    if (Array.isArray(v)) return v.map((x) => displayJsonValue(x)).join("; ");
  }
  return "";
}

/** Tipi di voce in ordine di lettura, con le etichette italiane. */
export const KIND_SECTIONS: readonly { kind: SnapshotItem["kind"]; label: string }[] = [
  { kind: "domanda", label: "Domande" },
  { kind: "entita", label: "Entità" },
  { kind: "campo", label: "Campi" },
  { kind: "kpi", label: "KPI" },
  { kind: "decisione", label: "Decisioni" },
  { kind: "parametro", label: "Parametri" },
  { kind: "vincolo_rigido", label: "Vincoli rigidi" },
  { kind: "vincolo_morbido", label: "Vincoli morbidi" },
  { kind: "obiettivo", label: "Obiettivi" },
  { kind: "incertezza", label: "Incertezze" },
  { kind: "uscita", label: "Uscite" },
  { kind: "formula", label: "Formule" },
  { kind: "regola", label: "Regole" },
  { kind: "fonte", label: "Fonti" },
  { kind: "controllo_qualita", label: "Controlli di qualità" },
  { kind: "documento", label: "Documenti" },
];

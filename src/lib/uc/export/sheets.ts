/**
 * Export Excel del catalogo (PIANO §5.9): righe pronte per `XLSX.utils.json_to_sheet`
 * (la scrittura del file sta nella route di export). Fogli: Catalogo,
 * Dizionario dati, Regole, KPI, Gate.
 *
 * Ogni cella di testo passa da `sheetText`: stessa protezione di `csvCell`
 * (`src/lib/learning/policy.ts`) contro le formule (`= + - @` in testa, anche
 * dopo spazi o caratteri di controllo), senza le virgolette del CSV.
 * Riceve una fotografia già filtrata per il ruolo. Modulo puro.
 */
import type { CatalogSnapshot, SnapshotItem } from "../snapshot.ts";
import { STATUS_LABELS, displayAnswer, displaySource, isItemOkForExport, specText } from "./format.ts";

export type SheetCell = string | number | boolean | null;
export type SheetRow = Record<string, SheetCell>;
export interface CatalogSheet {
  name: "Catalogo" | "Dizionario dati" | "Regole" | "KPI" | "Gate";
  rows: SheetRow[];
}

/** Limite di caratteri di una cella Excel. */
export const EXCEL_CELL_MAX = 32_767;

/** Testo sicuro per una cella: niente formule, niente caratteri di controllo, entro il limite di Excel. */
export function sheetText(value: unknown): string {
  const raw = String(value ?? "");
  const escaped = /^[\s\u0000- \u007f-\u009f]*[=+@-]/u.test(raw) ? `'${raw}` : raw;
  const clean = escaped.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return clean.length > EXCEL_CELL_MAX ? `${clean.slice(0, EXCEL_CELL_MAX - 1)}…` : clean;
}

function t(value: unknown): string {
  return sheetText(value);
}

function list(values: readonly string[]): string {
  return t(values.join(", "));
}

function statusLabel(item: SnapshotItem): string {
  return STATUS_LABELS[item.status];
}

function validatedFlag(item: SnapshotItem, draft: boolean): string {
  if (!draft) return "";
  return isItemOkForExport(item) ? "" : "non validata";
}

export function catalogToSheets(snapshot: CatalogSnapshot, options: { draft?: boolean } = {}): CatalogSheet[] {
  const draft = options.draft ?? snapshot.version === "bozza";
  const parentTitle = new Map(snapshot.items.map((i) => [i.key, i.title]));

  const catalog: SheetRow[] = snapshot.items.map((i) => ({
    ID: t(i.key),
    Tipo: t(i.kind),
    Sezione: t(i.section),
    Titolo: t(i.title),
    Stato: t(statusLabel(i)),
    ...(draft ? { Validazione: t(validatedFlag(i, draft)) } : {}),
    Priorità: t(i.priority ?? ""),
    Usi: list(i.serves_for),
    Privacy: t(i.privacy_class),
    Perimetro: t(i.perimeter ?? ""),
    Disponibilità: list(i.availability),
    Modulo: t(i.request_module_key ?? ""),
    Ruolo: t(i.owner_role_key ?? ""),
    "Tipo di risposta": t(i.response_type ?? ""),
    Unità: t(i.unit ?? ""),
    Valore: t(i.status === "non_applicabile" && i.na ? "non applicabile" : displayAnswer(i.answer)),
    Provenienza: t(displaySource(i.answer)),
    "Versione risposta": i.answer ? i.answer.version : null,
    "Valido dal": t(i.answer?.valid_from ?? ""),
    "Validata il": t(i.validated_at ? i.validated_at.slice(0, 10) : ""),
    "Motivo non applicabile": t(i.na?.reason ?? ""),
    "Deroga fino al": t(i.waiver?.scadenza ?? ""),
  }));

  const dictionary: SheetRow[] = snapshot.items
    .filter((i) => i.kind === "entita" || i.kind === "campo")
    .map((i) => ({
      Entità: t(i.kind === "entita" ? i.key : (i.parent_key ?? "")),
      "Nome entità": t(i.kind === "entita" ? i.title : (parentTitle.get(i.parent_key ?? "") ?? "")),
      Campo: t(i.kind === "campo" ? i.key : ""),
      Titolo: t(i.title),
      "Tipo di dato": t(specText(i, "tipo_dato")),
      Unità: t(i.unit ?? ""),
      Obbligatorio: i.spec.obbligatorio === true ? "sì" : i.spec.obbligatorio === false ? "no" : "",
      Chiave: t(specText(i, "chiave")),
      Granularità: t(specText(i, "granularita")),
      Privacy: t(i.privacy_class),
      Stato: t(statusLabel(i)),
      ...(draft ? { Validazione: t(validatedFlag(i, draft)) } : {}),
    }));

  const rules: SheetRow[] = snapshot.items
    .filter((i) => i.kind === "regola" || i.kind === "vincolo_rigido" || i.kind === "vincolo_morbido")
    .map((i) => ({
      ID: t(i.key),
      Tipo: t(i.kind),
      Titolo: t(i.title),
      "Tipo di regola": t(specText(i, "tipo_regola")),
      "Forma logica": t(specText(i, "forma_logica")),
      Eccezioni: t(specText(i, "eccezioni")),
      Parametri: t(specText(i, "parametri")),
      "Chi la conferma": t(i.owner_role_key ?? ""),
      Perimetro: t(i.perimeter ?? ""),
      Stato: t(statusLabel(i)),
      ...(draft ? { Validazione: t(validatedFlag(i, draft)) } : {}),
      "Testo confermato (impronta)": t(i.answer?.text_hash ?? ""),
    }));

  const kpis: SheetRow[] = snapshot.items
    .filter((i) => i.kind === "kpi")
    .map((i) => ({
      ID: t(i.key),
      Titolo: t(i.title),
      Formula: t(specText(i, "formula")),
      "Formula tecnica": t(specText(i, "formula_tecnica")),
      Unità: t(i.unit ?? specText(i, "unit")),
      Direzione: t(specText(i, "direzione")),
      Granularità: t(specText(i, "granularita")),
      Baseline: t(specText(i, "baseline")),
      Target: t(specText(i, "target")),
      "Riga di conto economico": t(specText(i, "pnl_line")),
      Leve: list(i.levers),
      Priorità: t(i.priority ?? ""),
      Stato: t(statusLabel(i)),
      ...(draft ? { Validazione: t(validatedFlag(i, draft)) } : {}),
    }));

  const gate: SheetRow[] = snapshot.gate
    ? [
        {
          Gate: t(snapshot.gate.key),
          Decisione: t(snapshot.gate.decision ?? ""),
          Regola: t(snapshot.gate.policy_scope ?? ""),
          "Voci richieste": snapshot.gate.required,
          "Voci a posto": snapshot.gate.ok,
          Deroghe: list(snapshot.gate.waiver_keys),
          "Versione del catalogo": typeof snapshot.version === "number" ? snapshot.version : t("bozza"),
          "Congelato il": t(snapshot.frozen_at ? snapshot.frozen_at.slice(0, 10) : ""),
          "Impronta del riepilogo": t(snapshot.gate.summary_text_hash ?? ""),
        },
      ]
    : [{ Gate: t("nessuno"), "Versione del catalogo": typeof snapshot.version === "number" ? snapshot.version : t("bozza") }];

  return [
    { name: "Catalogo", rows: catalog },
    { name: "Dizionario dati", rows: dictionary },
    { name: "Regole", rows: rules },
    { name: "KPI", rows: kpis },
    { name: "Gate", rows: gate },
  ];
}

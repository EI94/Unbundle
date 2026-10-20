/**
 * Il catalogo che scarica il responsabile del cliente (DESIGN §3.13.1, §3.6.8;
 * art. 15.4): «Scarica in Excel», prima del via la bozza di lavoro, dopo il
 * catalogo validato. Solo Excel: JSON e Markdown restano a Lateral Space (la
 * route li rifiuta agli altri ruoli).
 *
 * Al cliente non arrivano autore, data o provenienza di una risposta, né i
 * segnali sul lavoro dei referenti:
 * - della risposta resta solo il valore, e solo per `valore`, `conferma` e
 *   `correzione`; «Non lo so» (con il suo «chi potrebbe saperlo»), deleghe,
 *   proposte di «non si applica» e risposte ai chiarimenti non escono;
 * - niente data o versione della risposta, provenienza, fiducia, impronta del
 *   testo, motivo dello stato di Lateral Space;
 * - gli stati con le parole del cliente (`statusView(…, "cliente")`): «Da
 *   rispondere», mai «Manca il dato».
 * I fogli si costruiscono qui, colonna per colonna: una colonna nuova
 * dell'export di Lateral Space (`sheets.ts`) non arriva al cliente da sola.
 *
 * Riceve la fotografia già filtrata per la visibilità (`snapshotForViewer`) e
 * toglie di nuovo i valori personali (`withoutPersonalValues`). Modulo puro.
 */
import * as XLSX from "xlsx";
import type { CatalogSnapshot, SnapshotAnswer, SnapshotItem, ValueHiddenReason } from "../snapshot.ts";
import type { Json } from "../types.ts";
import type { AnswerKind, ItemStatus } from "../vocab.ts";
import { statusView } from "../views/status-groups.ts";
import { HIDDEN_LABELS, displayJsonValue, isItemOkForExport, specText } from "./format.ts";
import { withoutPersonalValues, type RenderedExport } from "./render.ts";
import { EXPORT_CONTENT_TYPES, exportFileName } from "./request.ts";
import { sheetText, type SheetRow } from "./sheets.ts";

/** Le risposte di cui il cliente vede il valore. */
export const CLIENT_ANSWER_KINDS: readonly AnswerKind[] = ["valore", "conferma", "correzione"];

/** Della risposta, al cliente arriva solo il valore (oppure perché è nascosto). */
export interface ClientAnswer {
  value: Json | null;
  value_hidden: ValueHiddenReason | null;
}

export interface ClientItem {
  key: string;
  kind: SnapshotItem["kind"];
  section: SnapshotItem["section"];
  parent_key: string | null;
  title: string;
  spec: SnapshotItem["spec"];
  priority: SnapshotItem["priority"];
  serves_for: SnapshotItem["serves_for"];
  privacy_class: SnapshotItem["privacy_class"];
  perimeter: SnapshotItem["perimeter"];
  availability: string[];
  levers: SnapshotItem["levers"];
  response_type: SnapshotItem["response_type"];
  unit: string | null;
  request_module_key: string | null;
  owner_role_key: string | null;
  status: ItemStatus;
  validated_at: string | null;
  answer: ClientAnswer | null;
  na: { reason: string | null } | null;
  waiver: { scadenza: string } | null;
}

export interface ClientCatalog {
  case: { code: string; title: string };
  version: number | "bozza";
  frozen_at: string | null;
  gate: CatalogSnapshot["gate"];
  items: ClientItem[];
}

function clientAnswer(answer: SnapshotAnswer | null): ClientAnswer | null {
  if (!answer || !CLIENT_ANSWER_KINDS.includes(answer.kind)) return null;
  if (answer.value_hidden) return { value: null, value_hidden: answer.value_hidden };
  return { value: answer.value ?? answer.value_normalized ?? null, value_hidden: null };
}

/** La fotografia (già filtrata per il ruolo) con quello che il cliente può leggere, e nient'altro. */
export function snapshotForClient(snapshot: CatalogSnapshot): ClientCatalog {
  const safe = withoutPersonalValues(snapshot);
  return {
    case: { code: safe.case.code, title: safe.case.title },
    version: safe.version,
    frozen_at: safe.frozen_at,
    gate: safe.gate,
    items: safe.items.map((i) => ({
      key: i.key,
      kind: i.kind,
      section: i.section,
      parent_key: i.parent_key,
      title: i.title,
      spec: i.spec,
      priority: i.priority,
      serves_for: [...i.serves_for],
      privacy_class: i.privacy_class,
      perimeter: i.perimeter,
      availability: [...i.availability],
      levers: [...i.levers],
      response_type: i.response_type,
      unit: i.unit,
      request_module_key: i.request_module_key,
      owner_role_key: i.owner_role_key,
      status: i.status,
      validated_at: i.validated_at,
      answer: clientAnswer(i.answer),
      na: i.na ? { reason: i.na.reason } : null,
      waiver: i.waiver ? { scadenza: i.waiver.scadenza } : null,
    })),
  };
}

const t = (value: unknown) => sheetText(value);
const list = (values: readonly string[]) => t(values.join(", "));
const status = (i: ClientItem) => t(statusView(i.status, "cliente").label);
/** `specText` legge solo `spec`. */
const spec = (i: ClientItem, ...keys: string[]) => t(specText({ spec: i.spec } as SnapshotItem, ...keys));
/** Nella bozza, le voci non a posto si segnano «non validata», come per Lateral Space (`isItemOkForExport` legge solo stato e `na`). */
function flag(i: ClientItem, draft: boolean): SheetRow {
  if (!draft) return {};
  const ok = isItemOkForExport({ status: i.status, na: i.na } as SnapshotItem);
  return { Validazione: t(ok ? "" : "non validata") };
}

function value(i: ClientItem): string {
  if (i.status === "non_applicabile" && i.na) return "non si applica";
  if (!i.answer) return "";
  if (i.answer.value_hidden) return `(${HIDDEN_LABELS[i.answer.value_hidden]})`;
  return displayJsonValue(i.answer.value);
}

export interface ClientSheet {
  name: "Catalogo" | "Dizionario dati" | "Regole" | "KPI" | "Via allo sviluppo";
  rows: SheetRow[];
}

/**
 * I fogli del cliente: quelli di Lateral Space senza le colonne sulle risposte
 * (provenienza, versione, «valido dal», impronta del testo), con gli stati del
 * cliente; «Via allo sviluppo» al posto di «Gate».
 */
export function clientCatalogSheets(c: ClientCatalog): ClientSheet[] {
  const draft = c.version === "bozza";
  const parentTitle = new Map(c.items.map((i) => [i.key, i.title]));

  const catalog: SheetRow[] = c.items.map((i) => ({
    ID: t(i.key),
    Tipo: t(i.kind),
    Sezione: t(i.section),
    Titolo: t(i.title),
    Stato: status(i),
    ...flag(i, draft),
    Priorità: t(i.priority ?? ""),
    Usi: list(i.serves_for),
    Privacy: t(i.privacy_class),
    Perimetro: t(i.perimeter ?? ""),
    Disponibilità: list(i.availability),
    Modulo: t(i.request_module_key ?? ""),
    Ruolo: t(i.owner_role_key ?? ""),
    "Tipo di risposta": t(i.response_type ?? ""),
    Unità: t(i.unit ?? ""),
    Valore: t(value(i)),
    "Validata il": t(i.validated_at ? i.validated_at.slice(0, 10) : ""),
    "Motivo non applicabile": t(i.na?.reason ?? ""),
    "Deroga fino al": t(i.waiver?.scadenza ?? ""),
  }));

  const dictionary: SheetRow[] = c.items
    .filter((i) => i.kind === "entita" || i.kind === "campo")
    .map((i) => ({
      Entità: t(i.kind === "entita" ? i.key : (i.parent_key ?? "")),
      "Nome entità": t(i.kind === "entita" ? i.title : (parentTitle.get(i.parent_key ?? "") ?? "")),
      Campo: t(i.kind === "campo" ? i.key : ""),
      Titolo: t(i.title),
      "Tipo di dato": spec(i, "tipo_dato"),
      Unità: t(i.unit ?? ""),
      Obbligatorio: i.spec.obbligatorio === true ? "sì" : i.spec.obbligatorio === false ? "no" : "",
      Chiave: spec(i, "chiave"),
      Granularità: spec(i, "granularita"),
      Privacy: t(i.privacy_class),
      Stato: status(i),
      ...flag(i, draft),
    }));

  const rules: SheetRow[] = c.items
    .filter((i) => i.kind === "regola" || i.kind === "vincolo_rigido" || i.kind === "vincolo_morbido")
    .map((i) => ({
      ID: t(i.key),
      Tipo: t(i.kind),
      Titolo: t(i.title),
      "Tipo di regola": spec(i, "tipo_regola"),
      "Forma logica": spec(i, "forma_logica"),
      Eccezioni: spec(i, "eccezioni"),
      Parametri: spec(i, "parametri"),
      "Chi la conferma": t(i.owner_role_key ?? ""),
      Perimetro: t(i.perimeter ?? ""),
      Stato: status(i),
      ...flag(i, draft),
    }));

  const kpis: SheetRow[] = c.items
    .filter((i) => i.kind === "kpi")
    .map((i) => ({
      ID: t(i.key),
      Titolo: t(i.title),
      Formula: spec(i, "formula"),
      "Formula tecnica": spec(i, "formula_tecnica"),
      Unità: i.unit ? t(i.unit) : spec(i, "unit"),
      Direzione: spec(i, "direzione"),
      Granularità: spec(i, "granularita"),
      Baseline: spec(i, "baseline"),
      Target: spec(i, "target"),
      "Riga di conto economico": spec(i, "pnl_line"),
      Leve: list(i.levers),
      Priorità: t(i.priority ?? ""),
      Stato: status(i),
      ...flag(i, draft),
    }));

  // «Via allo sviluppo» al posto di «Gate» (§2.6): niente codice del passaggio, regola o impronta.
  const via: SheetRow[] = [
    {
      Decisione: t(c.gate?.decision ?? ""),
      Indispensabili: c.gate ? c.gate.required : null,
      "A posto": c.gate ? c.gate.ok : null,
      Deroghe: list(c.gate?.waiver_keys ?? []),
      "Versione del catalogo": typeof c.version === "number" ? c.version : t("bozza"),
      "Congelato il": t(c.frozen_at ? c.frozen_at.slice(0, 10) : ""),
    },
  ];

  return [
    { name: "Catalogo", rows: catalog },
    { name: "Dizionario dati", rows: dictionary },
    { name: "Regole", rows: rules },
    { name: "KPI", rows: kpis },
    { name: "Via allo sviluppo", rows: via },
  ];
}

/** Fogli → file Excel, come `sheetsToXlsx` (le celle sono già protette da `sheetText`). */
function clientSheetsToXlsx(sheets: readonly ClientSheet[]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheet.rows), sheet.name);
  return new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "buffer", compression: true }) as Uint8Array);
}

/** Il file Excel del cliente, dalla fotografia già filtrata per il ruolo. */
export function renderClientCatalogExport(snapshot: CatalogSnapshot): RenderedExport {
  const catalog = snapshotForClient(snapshot);
  return {
    body: clientSheetsToXlsx(clientCatalogSheets(catalog)),
    contentType: EXPORT_CONTENT_TYPES.xlsx,
    fileName: exportFileName(catalog.case.code, catalog.version, "xlsx"),
  };
}

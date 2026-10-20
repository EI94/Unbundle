/**
 * Export Markdown del catalogo (PIANO §5.9): dizionario dati e catalogo per
 * tipo di voce. Riceve una fotografia già filtrata per il ruolo
 * (`snapshotForViewer`): qui non si decide chi vede cosa.
 *
 * Nella bozza (`version: "bozza"`, solo ruoli Lateral Space) ogni voce non a
 * posto è segnata «non validata». Modulo puro.
 */
import type { CatalogSnapshot, SnapshotItem } from "../snapshot.ts";
import { ITEM_STATUSES } from "../vocab.ts";
import { KIND_SECTIONS, STATUS_LABELS, displayAnswer, displaySource, isItemOkForExport, specText } from "./format.ts";

/** Testo sicuro in una cella di tabella Markdown: niente a capo, `|` e HTML attivo. */
export function mdCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?|\n/g, " ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();
}

/** Testo sicuro fuori dalle tabelle (titoli, paragrafi). */
export function mdText(value: unknown): string {
  return mdCell(value).replace(/^([#>*+-]|\d+\.)\s/, "\\$1 ");
}

function row(cells: unknown[]): string {
  return `| ${cells.map(mdCell).join(" | ")} |`;
}

function table(header: string[], rows: unknown[][]): string[] {
  if (rows.length === 0) return ["_Nessuna voce._"];
  return [row(header), `|${header.map(() => " --- ").join("|")}|`, ...rows.map(row)];
}

function statusCell(item: SnapshotItem, draft: boolean): string {
  const label = STATUS_LABELS[item.status];
  return draft && !isItemOkForExport(item) ? `${label} (non validata)` : label;
}

function dateIt(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function catalogToMarkdown(snapshot: CatalogSnapshot, options: { draft?: boolean } = {}): string {
  const draft = options.draft ?? snapshot.version === "bozza";
  const lines: string[] = [];
  lines.push(`# Catalogo · ${mdText(snapshot.case.code)} · ${mdText(snapshot.case.title)}`, "");
  lines.push(`- Template: ${mdText(`${snapshot.template.key} ${snapshot.template.version}`)}`);
  lines.push(
    draft
      ? "- Versione: **bozza**. Le voci non a posto sono segnate «non validata»: non è il catalogo approvato."
      : `- Versione: **v${snapshot.version}**, congelata il ${dateIt(snapshot.frozen_at)}`,
  );
  if (snapshot.gate) {
    lines.push(
      `- Gate ${snapshot.gate.key}: ${snapshot.gate.ok} di ${snapshot.gate.required} voci a posto` +
        (snapshot.gate.decision ? ` · decisione: ${mdText(snapshot.gate.decision)}` : "") +
        (snapshot.gate.waiver_keys.length > 0 ? ` · deroghe: ${snapshot.gate.waiver_keys.map(mdText).join(", ")}` : ""),
    );
  }
  if (snapshot.case.contract_refs.length > 0) lines.push(`- Riferimenti di contratto: ${snapshot.case.contract_refs.map(mdText).join(", ")}`);
  lines.push("");

  lines.push("## Riepilogo", "");
  lines.push(...table(["Stato", "Voci"], ITEM_STATUSES.map((s) => [STATUS_LABELS[s], snapshot.counts.by_status[s] ?? 0])));
  lines.push(row(["Totale", snapshot.counts.total]), "");

  lines.push("## Dizionario dati", "");
  const entities = snapshot.items.filter((i) => i.kind === "entita");
  const fieldsByParent = new Map<string, SnapshotItem[]>();
  for (const f of snapshot.items.filter((i) => i.kind === "campo")) {
    const list = fieldsByParent.get(f.parent_key ?? "") ?? [];
    list.push(f);
    fieldsByParent.set(f.parent_key ?? "", list);
  }
  if (entities.length === 0) lines.push("_Nessuna entità._", "");
  for (const e of entities) {
    lines.push(`### ${mdText(e.key)} · ${mdText(e.title)}`, "");
    if (e.explanation) lines.push(mdText(e.explanation), "");
    lines.push(
      ...table(
        ["Campo", "Titolo", "Tipo", "Unità", "Obbligatorio", "Privacy", "Stato"],
        (fieldsByParent.get(e.key) ?? []).map((f) => [
          f.key,
          f.title,
          specText(f, "tipo_dato"),
          f.unit ?? "",
          f.spec.obbligatorio === true ? "sì" : f.spec.obbligatorio === false ? "no" : "",
          f.privacy_class,
          statusCell(f, draft),
        ]),
      ),
      "",
    );
  }

  lines.push("## Catalogo", "");
  for (const { kind, label } of KIND_SECTIONS) {
    const items = snapshot.items.filter((i) => i.kind === kind);
    if (items.length === 0) continue;
    lines.push(`### ${label} (${items.length})`, "");
    lines.push(
      ...table(
        ["ID", "Titolo", "Stato", "Priorità", "Privacy", "Valore", "Provenienza", "Versione"],
        items.map((i) => [
          i.key,
          i.title,
          statusCell(i, draft),
          i.priority ?? "",
          i.privacy_class,
          i.status === "non_applicabile" && i.na ? "non applicabile" : displayAnswer(i.answer),
          displaySource(i.answer),
          i.answer ? `v${i.answer.version}` : "",
        ]),
      ),
      "",
    );
  }

  const linkCount = snapshot.links.length;
  lines.push("## Collegamenti", "", `${linkCount} collegamenti tra voci. L'elenco completo è nell'export JSON.`, "");
  return `${lines.join("\n").trimEnd()}\n`;
}

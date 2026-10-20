"use client";

import { useState } from "react";
import { ClipboardPaste, Download, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Issue } from "@/lib/uc/answers/issues";
import { gridFromPaste, gridFromValue, tableTemplateCsv, type TableGrid } from "@/lib/uc/views/referente-form";
import { CONTROL_CLASS, FieldErrors, TextAreaControl, type InputProps } from "./fields";

/**
 * Input `tabella`: si incolla da Excel (TAB, celle tra virgolette, a capo nelle
 * celle) oppure si scrive riga per riga. Dopo l'incolla la tabella diventa una
 * griglia modificabile; la griglia scorre in orizzontale dentro il suo riquadro,
 * mai la pagina (il riquadro è `relative`, così anche i testi `sr-only`, che
 * sono assoluti, restano dentro). Dal link del referente c'è il modello Excel
 * (`/api/r/[token]/items/[itemId]/template.xlsx`, PIANO §5.9); senza, con le
 * colonne del template, il modello CSV generato qui.
 *
 * Con `layout="cards"` (telefono, DESIGN §4.3 R2c) è un editor a schede: una
 * scheda per riga, le etichette sopra i campi.
 */

/** Righe modificabili a schermo: oltre, si corregge in Excel e si incolla di nuovo. */
const VISIBLE_ROWS = 50;

const DEFAULT_COLUMNS = [
  { key: "col_1", label: "Colonna 1" },
  { key: "col_2", label: "Colonna 2" },
];

function downloadCsv(csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "modello.csv";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** «1 riga · ne servono almeno 3». */
function rowsCountText(filled: number, minRows: number | null): string {
  return `${filled === 1 ? "1 riga" : `${filled} righe`}${minRows ? ` · ne servono almeno ${minRows}` : ""}`;
}

/**
 * Editor a schede per il telefono (DESIGN §4.3 R2c): una scheda per riga con
 * «Riga 1 · Togli», le etichette sopra i campi, «+ Aggiungi una riga» e il
 * conteggio delle righe. Niente scorrimento orizzontale.
 */
function TableCards({ id, config, value, onChange, issues, disabled }: InputProps) {
  const grid = gridFromValue(value, config);
  const columns = grid.columns.length > 0 ? grid.columns : DEFAULT_COLUMNS;
  const rows = grid.rows.length > 0 ? grid.rows : [columns.map(() => "")];
  const minRows = typeof config.min_rows === "number" ? config.min_rows : null;
  const filledRows = grid.rows.filter((r) => r.some((c) => c.trim() !== "")).length;
  const emit = (next: TableGrid) => onChange({ columns: next.columns, rows: next.rows });
  const setCell = (row: number, col: number, v: string) => {
    const next = rows.map((r) => [...r]);
    next[row] = columns.map((_, j) => (j === col ? v : (next[row][j] ?? "")));
    emit({ columns, rows: next });
  };
  const tableIssues = issues.filter((i) => !i.field || i.field === "rows" || i.field.startsWith("rows") || i.field === "value");
  return (
    <div className="min-w-0 space-y-3">
      <ol className="space-y-3">
        {rows.slice(0, VISIBLE_ROWS).map((r, i) => (
          <li key={i} className="min-w-0 space-y-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
            <div className="flex min-h-11 items-center justify-between gap-2">
              <p className="text-sm font-medium">Riga {i + 1}</p>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 px-3 text-base"
                disabled={disabled || grid.rows.length === 0}
                onClick={() => emit({ columns, rows: rows.filter((_, k) => k !== i) })}
                aria-label={`Togli la riga ${i + 1}`}
              >
                Togli
              </Button>
            </div>
            {columns.map((c, j) => (
              <div key={c.key} className="min-w-0 space-y-1.5">
                <label htmlFor={`${id}-r${i}-c${j}`} className="block text-sm font-medium break-words">
                  {c.label}
                </label>
                <input
                  id={`${id}-r${i}-c${j}`}
                  value={r[j] ?? ""}
                  onChange={(e) => setCell(i, j, e.target.value)}
                  disabled={disabled}
                  enterKeyHint="next"
                  autoComplete="off"
                  className={CONTROL_CLASS}
                />
              </div>
            ))}
          </li>
        ))}
      </ol>
      {rows.length > VISIBLE_ROWS ? <p className="text-sm text-muted-foreground">E altre {rows.length - VISIBLE_ROWS} righe: per cambiarle, apri il link dal computer.</p> : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="button" variant="outline" className="min-h-11 text-base" disabled={disabled} onClick={() => emit({ columns, rows: [...rows, columns.map(() => "")] })}>
          <Plus aria-hidden />
          Aggiungi una riga
        </Button>
        <span className="text-sm text-muted-foreground">{rowsCountText(filledRows, minRows)}</span>
      </div>
      <FieldErrors issues={tableIssues} />
    </div>
  );
}

export function TableInput(props: InputProps & { templateHref?: string; layout?: "grid" | "cards" }) {
  if (props.layout === "cards") return <TableCards {...props} />;
  return <TableSheet {...props} />;
}

function TableSheet({ id, config, value, onChange, issues, disabled, label, templateHref }: InputProps & { templateHref?: string }) {
  const fixedColumns = Array.isArray(config.columns) && config.columns.length > 0;
  const grid = gridFromValue(value, config);
  const columns = grid.columns.length > 0 ? grid.columns : DEFAULT_COLUMNS;
  const [paste, setPaste] = useState("");
  const [pasteIssues, setPasteIssues] = useState<{ errors: Issue[]; warnings: Issue[] }>({ errors: [], warnings: [] });
  const template = tableTemplateCsv(config);
  const minRows = typeof config.min_rows === "number" ? config.min_rows : null;
  const filledRows = grid.rows.filter((r) => r.some((c) => c.trim() !== "")).length;

  const emit = (next: TableGrid) => onChange({ columns: next.columns, rows: next.rows });
  const readPaste = (textValue: string) => {
    const r = gridFromPaste(textValue, config);
    setPasteIssues({ errors: r.errors, warnings: r.warnings });
    if (r.grid) {
      emit(r.grid);
      setPaste("");
    }
  };
  const setCell = (row: number, col: number, v: string) => {
    const rows = grid.rows.map((r) => [...r]);
    while (rows.length <= row) rows.push(columns.map(() => ""));
    rows[row] = columns.map((_, j) => (j === col ? v : (rows[row][j] ?? "")));
    emit({ columns, rows });
  };
  const setLabel = (col: number, v: string) => emit({ columns: columns.map((c, j) => (j === col ? { ...c, label: v } : c)), rows: grid.rows });
  const addRow = () => emit({ columns, rows: [...grid.rows, columns.map(() => "")] });
  const removeRow = (row: number) => emit({ columns, rows: grid.rows.filter((_, i) => i !== row) });
  const addColumn = () => emit({ columns: [...columns, { key: `col_${columns.length + 1}`, label: `Colonna ${columns.length + 1}` }], rows: grid.rows.map((r) => [...r, ""]) });
  const rows = grid.rows.length > 0 ? grid.rows : [columns.map(() => "")];
  const shown = rows.slice(0, VISIBLE_ROWS);
  const tableIssues = issues.filter((i) => !i.field || i.field === "rows" || i.field.startsWith("rows") || i.field === "value");

  return (
    <div className="min-w-0 space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={`${id}-paste`} className="flex items-center gap-2 text-sm font-medium">
          <ClipboardPaste className="size-4 shrink-0" aria-hidden />
          Incolla da Excel
        </label>
        <TextAreaControl
          id={`${id}-paste`}
          value={paste}
          onChange={setPaste}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text/plain");
            if (t) {
              e.preventDefault();
              readPaste(t);
            }
          }}
          disabled={disabled}
          rows={2}
          placeholder="Seleziona le celle in Excel con l'intestazione, copia e incolla qui."
          ariaLabel={`${label}: incolla la tabella`}
        />
        {paste.trim() ? (
          <Button type="button" variant="outline" className="min-h-11" disabled={disabled} onClick={() => readPaste(paste)}>
            Leggi la tabella
          </Button>
        ) : null}
        <FieldErrors issues={pasteIssues.errors} />
        {pasteIssues.warnings.length > 0 ? (
          <ul className="space-y-1 text-sm break-words text-muted-foreground">
            {[...new Set(pasteIssues.warnings.map((w) => w.message))].map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
        {templateHref && !disabled ? (
          <Button variant="link" className="h-auto min-h-11 px-0" render={<a href={templateHref} download rel="noopener noreferrer" />} nativeButton={false}>
            <Download aria-hidden />
            Scarica il modello Excel
          </Button>
        ) : template ? (
          <Button type="button" variant="link" className="h-auto min-h-11 px-0" onClick={() => downloadCsv(template)}>
            <Download aria-hidden />
            Scarica il modello (CSV per Excel)
          </Button>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Oppure scrivi riga per riga</p>
        <div className="relative max-w-full overflow-x-auto rounded-lg border border-border">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead className="bg-muted/60">
              <tr>
                {columns.map((c, j) => (
                  <th key={c.key} scope="col" className="min-w-32 border-b border-border p-1.5 text-left font-medium">
                    {fixedColumns ? (
                      <span className="block px-1.5 py-1 break-words">{c.label}</span>
                    ) : (
                      <input
                        value={c.label}
                        onChange={(e) => setLabel(j, e.target.value)}
                        disabled={disabled}
                        aria-label={`Nome della colonna ${j + 1}`}
                        className="h-10 w-full min-w-28 rounded-md border border-input bg-background px-2 text-base font-medium"
                      />
                    )}
                  </th>
                ))}
                <th className="w-12 border-b border-border p-1.5">
                  <span className="sr-only">Azioni</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-b-0">
                  {columns.map((c, j) => (
                    <td key={c.key} className="p-1.5">
                      <input
                        value={r[j] ?? ""}
                        onChange={(e) => setCell(i, j, e.target.value)}
                        disabled={disabled}
                        aria-label={`Riga ${i + 1}, ${c.label}`}
                        className="h-10 w-full min-w-28 rounded-md border border-input bg-background px-2 text-base"
                      />
                    </td>
                  ))}
                  <td className="p-1.5 text-center">
                    <Button type="button" variant="ghost" size="icon" className="size-10" disabled={disabled || grid.rows.length === 0} onClick={() => removeRow(i)} aria-label={`Togli la riga ${i + 1}`}>
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > VISIBLE_ROWS ? (
          <p className="text-sm text-muted-foreground">E altre {rows.length - VISIBLE_ROWS} righe: per cambiarle, correggi in Excel e incolla di nuovo.</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={disabled} onClick={addRow}>
            <Plus aria-hidden />
            Aggiungi una riga
          </Button>
          {fixedColumns ? null : (
            <Button type="button" variant="outline" className="min-h-11" disabled={disabled || columns.length >= 50} onClick={addColumn}>
              <Plus aria-hidden />
              Aggiungi una colonna
            </Button>
          )}
          <span className="text-sm text-muted-foreground">{rowsCountText(filledRows, minRows)}</span>
        </div>
      </div>
      <FieldErrors issues={tableIssues} />
    </div>
  );
}

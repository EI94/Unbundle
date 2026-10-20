"use client";

import { useId, useState } from "react";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { DetailSheetFrame } from "@/components/uc/ui/detail-sheet";
import { updateDescriptionBlockAction } from "@/lib/actions/uc-shell";
import type { Json } from "@/lib/uc/types";
import { DESCRIPTION_LIMITS, type DescriptionBlockKind, type DescriptionField } from "@/lib/uc/views/description";
import { cn } from "@/lib/utils";

export interface BlockEditorConfig {
  workspaceId: string;
  caseId: string;
  blockKey: string;
  title: string;
  kind: DescriptionBlockKind;
  fields: readonly DescriptionField[];
  hint: string | null;
  /** Valore salvato nella forma dell'editor (`blockValueForEditor`). */
  value: Json;
  /** JSON stabile del valore salvato così com'è: il server rifiuta se nel frattempo è cambiato. */
  base: string;
}

type Rec = Record<string, string>;

function asLines(v: Json): string {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").join("\n") : "";
}

function asRecords(v: Json): Rec[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, Json> => !!x && typeof x === "object" && !Array.isArray(x))
    .map((r) => Object.fromEntries(Object.entries(r).filter(([, s]) => typeof s === "string")) as Rec);
}

function perimeterOf(v: Json): { inside: string; evolution: string } {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {};
  return { inside: asLines(o.caso_commerciale ?? []), evolution: asLines(o.evoluzione ?? []) };
}

/**
 * Il pulsante che apre la modifica di un blocco (solo il responsabile Lateral
 * Space, DESIGN §3.7.1) e il pannello con il modulo:
 * - `modifica`: «Modifica», visibile al passaggio del mouse o al focus sul
 *   blocco (sempre sul telefono e mentre si modifica la pagina);
 * - `aggiungi`: «+ Aggiungi un esempio concreto», per un blocco vuoto mentre si
 *   modifica la pagina;
 * - `scrivi`: [Scrivi «In breve»] della descrizione vuota.
 * Si cambia solo quel blocco: la versione precedente resta nelle versioni e i
 * testi passano dalla scansione (niente dati sanitari, preferenze
 * discriminatorie o nomi di persone). Il pulsante pieno «Salva» sta nel
 * pannello.
 */
export function BlockEditButton({ editor, variant, label, revealOnHover = true }: { editor: BlockEditorConfig; variant: "modifica" | "aggiungi" | "scrivi"; label: string; revealOnHover?: boolean }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [records, setRecords] = useState<Rec[]>([]);
  const [inside, setInside] = useState("");
  const [evolution, setEvolution] = useState("");
  const id = `uc-desc-${editor.blockKey}`;
  const formId = useId();

  function start() {
    setText(editor.kind === "testo" ? (typeof editor.value === "string" ? editor.value : "") : asLines(editor.value));
    setRecords(editor.kind === "schede" && asRecords(editor.value).length === 0 ? [{}] : asRecords(editor.value));
    const p = perimeterOf(editor.value);
    setInside(p.inside);
    setEvolution(p.evolution);
    setOpen(true);
  }

  function save() {
    const value =
      editor.kind === "testo"
        ? text
        : editor.kind === "elenco"
          ? text.split("\n")
          : editor.kind === "schede"
            ? records
            : { caso_commerciale: inside.split("\n"), evoluzione: evolution.split("\n") };
    run(() => updateDescriptionBlockAction(editor.workspaceId, editor.caseId, { block: editor.blockKey, value, base: editor.base }), { onSuccess: () => setOpen(false) });
  }

  const trigger =
    variant === "modifica" ? (
      <Button
        size="sm"
        variant="ghost"
        onClick={start}
        aria-label={`Modifica «${editor.title}»`}
        className={cn(
          "min-h-11 shrink-0 text-muted-foreground sm:min-h-8",
          revealOnHover && "opacity-0 group-focus-within/blocco:opacity-100 group-hover/blocco:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
        )}
      >
        <Pencil aria-hidden />
        Modifica
      </Button>
    ) : variant === "aggiungi" ? (
      <Button size="sm" variant="ghost" onClick={start} className="-ml-2.5 min-h-11 justify-start text-muted-foreground sm:min-h-8">
        <Plus aria-hidden />
        {label}
      </Button>
    ) : (
      <Button variant="outline" onClick={start} className="min-h-11 sm:min-h-8">
        <Pencil aria-hidden />
        {label}
      </Button>
    );

  return (
    <>
      {trigger}
      {open && (
        <DetailSheetFrame
          open
          onOpenChange={(v) => {
            if (!v && !pending) setOpen(false);
          }}
          title={variant === "modifica" ? `Modifica «${editor.title}»` : editor.title}
          description={editor.hint ?? undefined}
          size="xl"
          footer={
            <div className="flex flex-wrap gap-2">
              <Button type="submit" form={formId} disabled={pending} className="min-h-11 sm:min-h-8">
                {pending ? "Salvo…" : "Salva"}
              </Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)} className="min-h-11 sm:min-h-8">
                Annulla
              </Button>
            </div>
          }
        >
          <form
            id={formId}
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {editor.kind === "testo" && (
              <Textarea aria-label={editor.title} value={text} onChange={(e) => setText(e.target.value)} maxLength={DESCRIPTION_LIMITS.text} rows={8} className="text-base sm:text-sm" />
            )}
            {editor.kind === "elenco" && (
              <Textarea
                aria-label={`${editor.title}, un punto per riga`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder="Un punto per riga"
                className="text-base sm:text-sm"
              />
            )}
            {editor.kind === "perimetro" && (
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-inside`}>Dentro il perimetro</Label>
                  <Textarea id={`${id}-inside`} value={inside} onChange={(e) => setInside(e.target.value)} rows={5} placeholder="Un punto per riga" className="text-base sm:text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-evolution`}>Fuori contratto</Label>
                  <Textarea id={`${id}-evolution`} value={evolution} onChange={(e) => setEvolution(e.target.value)} rows={5} placeholder="Un punto per riga" className="text-base sm:text-sm" />
                </div>
              </div>
            )}
            {editor.kind === "schede" && (
              <div className="space-y-3">
                {records.map((rec, i) => (
                  <fieldset key={i} className="space-y-2 rounded-xl p-3 ring-1 ring-foreground/10">
                    <legend className="sr-only">Scheda {i + 1}</legend>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground" aria-hidden>
                        Scheda {i + 1}
                      </span>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRecords((cur) => cur.filter((_, j) => j !== i))} aria-label={`Togli la scheda ${i + 1}`}>
                        <Trash2 aria-hidden />
                        Togli
                      </Button>
                    </div>
                    {editor.fields.map((f) => (
                      <div key={f.key} className="space-y-1">
                        <Label htmlFor={`${id}-${i}-${f.key}`}>{f.label}</Label>
                        {f.multiline ? (
                          <Textarea
                            id={`${id}-${i}-${f.key}`}
                            value={rec[f.key] ?? ""}
                            maxLength={DESCRIPTION_LIMITS.field}
                            rows={2}
                            className="text-base sm:text-sm"
                            onChange={(e) => setRecords((cur) => cur.map((r, j) => (j === i ? { ...r, [f.key]: e.target.value } : r)))}
                          />
                        ) : (
                          <Input
                            id={`${id}-${i}-${f.key}`}
                            value={rec[f.key] ?? ""}
                            maxLength={DESCRIPTION_LIMITS.field}
                            className="h-11 text-base sm:h-8 sm:text-sm"
                            onChange={(e) => setRecords((cur) => cur.map((r, j) => (j === i ? { ...r, [f.key]: e.target.value } : r)))}
                          />
                        )}
                      </div>
                    ))}
                  </fieldset>
                ))}
                <Button type="button" size="sm" variant="outline" disabled={records.length >= DESCRIPTION_LIMITS.records} onClick={() => setRecords((cur) => [...cur, {}])}>
                  <Plus aria-hidden />
                  Aggiungi una scheda
                </Button>
              </div>
            )}
          </form>
        </DetailSheetFrame>
      )}
    </>
  );
}

/**
 * Un elenco che mostra le prime righe e poi «Mostra tutti i 7 passi» o
 * «Mostra tutto» (DESIGN §3.7.1). I testi arrivano già dal server.
 */
export function ShowMoreList({ items, initial, moreLabel, ordered = false }: { items: readonly string[]; initial: number; moreLabel: string; ordered?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all || items.length <= initial ? items : items.slice(0, initial);
  const List = ordered ? "ol" : "ul";
  return (
    <div className="space-y-2">
      <List className={cn("space-y-1.5 pl-5 text-sm", ordered ? "list-decimal marker:text-muted-foreground marker:tabular-nums" : "list-disc")}>
        {shown.map((t, i) => (
          <li key={i} className="pl-1 break-words">
            {t}
          </li>
        ))}
      </List>
      {!all && items.length > initial && (
        <Button type="button" size="sm" variant="ghost" onClick={() => setAll(true)} className="-ml-2.5 min-h-11 text-muted-foreground sm:min-h-8">
          <ChevronDown aria-hidden />
          {moreLabel}
        </Button>
      )}
    </div>
  );
}

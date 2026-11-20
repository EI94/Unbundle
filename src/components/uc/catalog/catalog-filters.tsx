"use client";

import Link from "next/link";
import { Paperclip } from "lucide-react";
import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { Button } from "@/components/ui/button";
import { FilterChips } from "@/components/ui-10/filter-chips";
import { questionQuery, questionTabOf, segmentPatch, type QuestionDefaults, type QuestionFilter } from "@/lib/uc/views/catalog-filter";
import { DOMANDE_TEXT } from "@/lib/uc/views/domande-text";
import { questionKeptQuery, type QuestionFilterField } from "@/lib/uc/views/question-bar";
import type { QuestionSegmentItem } from "@/lib/uc/views/rows";

/** Classe delle `select` native che restano (moduli dei pannelli): 44 px e testo a 16 px al telefono. */
export const SELECT_CLASS =
  "h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8 sm:text-sm dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground";

/** La lunghezza della ricerca, come la legge `parseQuestionFilter`. */
const SEARCH_MAX = 100;

export interface QuestionToolbarProps {
  basePath: string;
  filter: QuestionFilter;
  defaults: QuestionDefaults;
  segments: QuestionSegmentItem[];
  /** I campi del foglio «Filtri» (`questionFilterFields`). */
  fields: QuestionFilterField[];
  selection: { available: boolean; active: boolean; onToggle: () => void };
  /** «File (6)»: il pannello dell'archivio (`?apri=file`), con la lista che resta sotto. */
  files: { href: string; count: number };
}

/**
 * La barra di Domande (rilascio 10, §3.5): i segmenti, poi «Cerca» · «Filtri (n)» (il pezzo comune `FilterChips`,
 * con i chip dei filtri attivi e «Togli tutti») · «Seleziona» · «File (6)». Tutto vive nell'indirizzo: si condivide
 * e si ricarica uguale. Nessun pulsante pieno: il pieno è il passo della testata.
 */
export function QuestionToolbar({ basePath, filter, defaults, segments, fields, selection, files }: QuestionToolbarProps) {
  const active = questionTabOf(filter.vista);
  return (
    <div className="min-w-0 space-y-3">
      {segments.length > 0 && (
        <SegmentedNav
          ariaLabel={DOMANDE_TEXT.segments}
          active={active ?? ""}
          gridOnPhone
          items={segments.map((s) => ({ key: s.key, label: s.label, count: s.count, href: `${basePath}${questionQuery(filter, defaults, segmentPatch(filter, s.key))}` }))}
        />
      )}
      <div data-slot="question-bar" className="flex min-w-0 flex-wrap items-start gap-2">
        <FilterChips className="min-w-0 flex-1" basePath={basePath} query={questionKeptQuery(filter, defaults)} search={{ param: "q", maxLength: SEARCH_MAX }} fields={fields} />
        <div className="flex shrink-0 items-center gap-2">
          {selection.available && (
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" aria-pressed={selection.active} onClick={selection.onToggle}>
              {selection.active ? DOMANDE_TEXT.bar.selectDone : DOMANDE_TEXT.bar.select}
            </Button>
          )}
          <Button variant="outline" className="min-h-11 sm:min-h-9" render={<Link href={files.href} scroll={false} />} nativeButton={false}>
            <Paperclip aria-hidden data-icon="inline-start" />
            {DOMANDE_TEXT.bar.files(files.count)}
          </Button>
        </div>
      </div>
    </div>
  );
}

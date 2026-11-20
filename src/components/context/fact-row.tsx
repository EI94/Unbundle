"use client";

import Link from "next/link";
import { ChevronRight, Lock } from "lucide-react";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { FactView, LiveRow } from "@/lib/db/queries/context-memory";
import { Mark } from "./fields";
import { factMarks } from "./view-model";

const T = CONTEXT_TEXT;

/** Il lucchetto di «Solo Lateral Space», con il testo per i lettori di schermo. */
export function LsLock() {
  return (
    <span className="inline-flex items-center text-muted-foreground" title={T.fact.lsOnly}>
      <Lock aria-hidden className="size-3.5" />
      <span className="sr-only">{T.fact.lsOnly}</span>
    </span>
  );
}

/**
 * Una riga della Memoria (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2): la frase; a destra, piccola, la
 * fonte; un segno solo quando serve («dedotto», «da verificare», il lucchetto). Sul telefono fonte e segni vanno a capo
 * sotto la frase. Un tocco apre il pannello del fatto.
 */
export function FactRow({ fact, onOpen }: { fact: FactView; onOpen: (factId: string) => void }) {
  const marks = factMarks(fact);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(fact.id)}
        className="flex min-h-11 w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
      >
        <span className="min-w-0 text-sm leading-relaxed break-words">{fact.statement}</span>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:justify-end">
          {marks.inferred ? <Mark>{T.fact.inferred}</Mark> : null}
          {marks.toCheck ? <Mark>{T.fact.toCheck}</Mark> : null}
          {marks.lsOnly ? <LsLock /> : null}
          <span>{fact.sourceLabel}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * Un dato dell'Intervista iniziale, letto dal vivo: fonte «Intervista iniziale», senza azioni. (Rilascio 10, §3.7) Con
 * `href` tutta la riga è un link: un'unità porta alla sua board, un obiettivo alla pagina «Obiettivi».
 */
export function LiveRowItem({ row, href }: { row: LiveRow; href?: string | null }) {
  const body = (
    <>
      <span className="min-w-0 text-sm leading-relaxed break-words">
        {row.tag ? <span className="mr-1.5 text-xs text-muted-foreground">{row.tag}</span> : null}
        {row.text}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        {T.fact.sourceDiscovery}
        {href ? <ChevronRight aria-hidden className="size-4" /> : null}
      </span>
    </>
  );
  if (href) {
    return (
      <li>
        <Link
          href={href}
          className="flex min-h-11 w-full flex-col gap-1 rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
        >
          {body}
        </Link>
      </li>
    );
  }
  return <li className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">{body}</li>;
}

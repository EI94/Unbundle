"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Lock, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { WORDS } from "@/lib/uc/views/labels";
import { DATA_VIEWS, DATA_VIEW_LABEL, SOLUTION_Q_MAX, type DataView } from "@/lib/uc/views/model";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";

/**
 * Soluzione › Dati (DESIGN §3.7.4) e i pezzi della barra degli strumenti che
 * usa anche Regole: la ricerca e i parametri nell'indirizzo. Ricerca, filtri e
 * pagine stanno sul server: qui si cambia solo l'indirizzo (con
 * `useTransition`, la pagina vecchia resta finché arriva la nuova).
 */

/** Cambia alcuni parametri dell'indirizzo; la pagina e il pannello aperto si azzerano. */
export function useUrlParams(): { pending: boolean; set: (patch: Record<string, string | null>) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("pagina");
    next.delete("apri");
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };
  return { pending, set };
}

/**
 * La ricerca lato server (`?q=`): parte dopo una breve pausa nella scrittura,
 * o subito con Invio; Esc la svuota. Incollare una chiave funziona.
 */
export function SolutionSearch({ value, label, className }: { value: string | null; label: string; className?: string }) {
  const { pending, set } = useUrlParams();
  const [text, setText] = useState(value ?? "");
  // L'ultima ricerca mandata: se l'indirizzo cambia da fuori («Togli i filtri»), il campo si allinea.
  const [lastSent, setLastSent] = useState(value ?? "");
  const [seenValue, setSeenValue] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (value !== seenValue) {
    setSeenValue(value);
    if ((value ?? "") !== lastSent) {
      setText(value ?? "");
      setLastSent(value ?? "");
    }
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const send = (t: string) => {
    if (timer.current) clearTimeout(timer.current);
    const clean = t.trim();
    if (clean === lastSent) return;
    setLastSent(clean);
    set({ q: clean || null });
  };

  return (
    <form
      role="search"
      className={cn("relative min-w-0", className)}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        send(text);
      }}
    >
      <label className="sr-only" htmlFor="uc-solution-q">
        {label}
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        id="uc-solution-q"
        type="search"
        value={text}
        maxLength={SOLUTION_Q_MAX}
        placeholder={label}
        autoComplete="off"
        className="h-11 pr-9 pl-8 text-base sm:h-8 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => send(t), 350);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            setText("");
            send("");
          }
        }}
      />
      {text && (
        <button
          type="button"
          aria-label="Svuota la ricerca"
          onClick={() => {
            setText("");
            send("");
          }}
          className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:size-7"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </form>
  );
}

/** La barra di Dati: il `Select` «Vista» e «Cerca per nome». */
export function DataToolbar({ view, q }: { view: DataView; q: string | null }) {
  const { pending, set } = useUrlParams();
  const items = DATA_VIEWS.map((v) => ({ value: v, label: DATA_VIEW_LABEL[v] }));
  return (
    <div className="mb-5 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center" aria-busy={pending}>
      <div className="flex min-w-0 items-center gap-2">
        <span id="uc-data-view" className="text-sm text-muted-foreground">
          Vista
        </span>
        <Select items={items} value={view} onValueChange={(v) => v && set({ vista: v === "entita" ? null : String(v), q: null })}>
          <SelectTrigger aria-labelledby="uc-data-view" className="min-h-11 min-w-44 sm:min-h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <SolutionSearch key={view} value={q} label="Cerca per nome" className="sm:max-w-sm sm:flex-1" />
    </div>
  );
}

export interface DataListRow {
  id: string;
  title: string;
  line: string | null;
  status: { tone: SemaforoColor; label: string; sublabel: string | null };
  locked: boolean;
  href: string;
}

/**
 * Le righe di una vista di Dati: titolo, stato, una riga di spiegazione e il
 * lucchetto «Si apre dopo la scheda privacy». Ogni riga apre il suo pannello
 * (`?apri=`). Niente priorità né chiavi nella riga.
 */
export function DataList({ groups }: { groups: { label: string | null; rows: DataListRow[] }[] }) {
  return (
    <div className="min-w-0 space-y-6">
      {groups.map((g, i) => (
        <section key={`${g.label ?? "tutte"}-${i}`} className="min-w-0" aria-label={g.label ?? undefined}>
          {g.label && <h2 className="mb-1 text-xs tracking-wide text-muted-foreground">{g.label}</h2>}
          <ul className="divide-y divide-border border-y border-border">
            {g.rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.href}
                  scroll={false}
                  className="flex min-h-11 min-w-0 items-center gap-3 py-2.5 hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.title}</span>
                    {(r.line || r.locked) && (
                      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        {r.line && <span className="truncate">{r.line}</span>}
                        {r.locked && (
                          <span className="inline-flex shrink-0 items-center gap-1">
                            <Lock className="size-3" aria-hidden />
                            {WORDS.dopoSchedaPrivacy}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <StatusDot tone={r.status.tone} label={r.status.label} className="shrink-0" />
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

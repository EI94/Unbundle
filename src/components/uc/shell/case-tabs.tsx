"use client";

import { useEffect, useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { activeTabKey, tabAriaCurrent, type CaseTab } from "@/lib/uc/views/case-shell";
import { OVERVIEW_TEXT, viaBarText } from "@/lib/uc/views/progress";
import { formatCountIt } from "@/lib/uc/views/format";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { cn } from "@/lib/utils";
import { CaseStepButton, type CaseStepView } from "./case-menu";

/**
 * Le schede del dossier (DESIGN §2.2, §3.3): al massimo 5, solo quelle che chi
 * guarda può aprire. `min-h-11`; quella in caricamento ha un puntino che pulsa
 * (`useLinkStatus`) e `aria-busy`. Sul telefono la riga scorre, sfuma a destra
 * e tiene in vista la scheda attiva.
 */

function TabLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span aria-busy={pending || undefined} className="inline-flex items-center gap-1.5">
      {label}
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full bg-current transition-opacity", pending ? "animate-pulse opacity-70" : "opacity-0")} />
    </span>
  );
}

/** Il primo segmento sotto il dossier; null sulla Panoramica. */
function useTabSegment(): string | null {
  const raw = useSelectedLayoutSegment();
  return raw && !raw.startsWith("__") ? raw : null;
}

/** La scheda accesa; con le schede di chi guarda, dopo il via Domande accende «Costruzione» (`activeTabKey`). */
function useActiveTab(tabs?: readonly CaseTab[]) {
  return activeTabKey(useTabSegment(), tabs);
}

function TabRow({ basePath, tabs, compact = false, ariaLabel }: { basePath: string; tabs: readonly CaseTab[]; compact?: boolean; ariaLabel: string }) {
  const segment = useTabSegment();
  const active = activeTabKey(segment, tabs);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    // Solo in orizzontale, dentro la riga: la pagina non si muove.
    const el = activeRef.current;
    const box = listRef.current;
    if (!el || !box || box.scrollWidth <= box.clientWidth) return;
    const a = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (a.left < b.left) box.scrollLeft -= b.left - a.left + 8;
    else if (a.right > b.right) box.scrollLeft += a.right - b.right + 24;
  }, [active]);
  return (
    <nav aria-label={ariaLabel} className="min-w-0">
      {/* contain: inline-size: la larghezza delle schede non allarga la pagina, la riga scorre. */}
      <div
        ref={listRef}
        className="-mb-px flex min-w-0 gap-1 overflow-x-auto [contain:inline-size] [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none] sm:[mask-image:none]"
      >
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              ref={isActive ? activeRef : undefined}
              href={t.segment ? `${basePath}/${t.segment}` : basePath}
              // (Rilascio 10, D9 (a)) Su Domande, dopo il via, «Costruzione» è accesa ma non è la pagina: «true».
              aria-current={isActive ? tabAriaCurrent(segment, t) : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center border-b-2 px-2.5 text-sm whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                compact && "lg:min-h-10",
                isActive ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <TabLabel label={t.label} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function clampCount(value: number, max: number): number {
  return Math.max(0, Math.min(max, Number.isFinite(value) ? Math.round(value) : 0));
}

/**
 * (Rilascio 10, §3.5) L'avanzamento piccolo della testata, accanto allo stato: la barra e «186/245». Non sulla
 * Panoramica, che ha il numero grande «186 di 245» (un numero per schermata); non è un link: la Panoramica è la prima
 * scheda. I lettori di schermo leggono la frase intera. Senza domande indispensabili non c'è (lo zero non si mostra).
 */
export function CaseHeadProgress({ ok, required, inReview, audience }: { ok: number; required: number; inReview: number; audience: "ls" | "cliente" }) {
  const active = useActiveTab();
  const total = Number.isFinite(required) ? Math.round(required) : 0;
  if (active === "panoramica" || total <= 0) return null;
  const done = clampCount(ok, total);
  const review = clampCount(inReview, total - done);
  const text = viaBarText({ ok: done, required: total, inReview: review, audience });
  return (
    <span data-slot="case-head-progress" className="inline-flex items-center gap-2 text-sm text-muted-foreground" title={text}>
      <span
        role="progressbar"
        aria-label={OVERVIEW_TEXT.barLabel}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={text}
        className="relative flex h-1.5 w-16 overflow-hidden rounded-full bg-muted"
      >
        <span className="h-full bg-uc-verde" style={{ width: `${(done / total) * 100}%` }} />
        {review > 0 && <span className="h-full bg-uc-giallo/40" style={{ width: `${(review / total) * 100}%` }} />}
      </span>
      <span aria-hidden className="tabular-nums">
        {formatCountIt(done)}/{formatCountIt(total)}
      </span>
    </span>
  );
}

/** Le schede sotto la testata, dentro il blocco della testata. */
export function CaseTabs({ basePath, tabs }: { basePath: string; tabs: readonly CaseTab[] }) {
  if (tabs.length === 0) return null;
  return (
    <div className="mt-4">
      <TabRow basePath={basePath} tabs={tabs} ariaLabel="Sezioni della realizzazione" />
    </div>
  );
}

export interface CaseStickyBarProps {
  basePath: string;
  tabs: readonly CaseTab[];
  /** Id del blocco testata più schede: la barra compare quando esce dallo schermo. */
  headId: string;
  title: string;
  status: { tone: SemaforoColor; label: string };
  progress: { ok: number; required: number } | null;
  step: CaseStepView | null;
}

/**
 * La barra fissa in alto quando la testata esce di vista (DESIGN §3.3), sotto
 * la barra del workspace (61 px sul telefono, 53 px da tablet in su). Da `lg`:
 * titolo e stato, le schede, il primario piccolo. Sotto `lg`: le schede e una
 * riga sottile «Titolo · 0/245». Alta zero nel flusso: non sposta la pagina.
 */
export function CaseStickyBar({ basePath, tabs, headId, title, status, progress, step }: CaseStickyBarProps) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = document.getElementById(headId);
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [headId]);
  if (tabs.length === 0) return null;
  const count = progress && progress.required > 0 ? `${formatCountIt(progress.ok)}/${formatCountIt(progress.required)}` : null;
  return (
    <div className="sticky top-14 z-20 h-0 md:top-0">
      {visible && (
        <div className="absolute inset-x-0 top-0 border-b border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col px-4 sm:px-6 lg:flex-row lg:items-center lg:gap-4 lg:px-8">
            <div className="hidden min-w-0 items-center gap-2 lg:flex">
              <span className="max-w-56 truncate text-sm font-medium" title={title}>
                {title}
              </span>
              <StatusDot tone={status.tone} label={status.label} hideLabel />
            </div>
            <div className="min-w-0 lg:flex-1">
              <TabRow basePath={basePath} tabs={tabs} compact ariaLabel="Sezioni della realizzazione (barra fissa)" />
            </div>
            <p className="truncate pb-1.5 text-xs text-muted-foreground tabular-nums lg:hidden">
              {title}
              {count ? ` · ${count}` : ""}
            </p>
            {step && (
              <div className="hidden shrink-0 lg:block">
                <CaseStepButton step={step} size="sm" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

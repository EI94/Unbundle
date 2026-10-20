"use client";

import { useEffect, useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { activeTabKey, type CaseTab } from "@/lib/uc/views/case-shell";
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

function useActiveTab() {
  const raw = useSelectedLayoutSegment();
  return activeTabKey(raw && !raw.startsWith("__") ? raw : null);
}

function TabRow({ basePath, tabs, compact = false, ariaLabel }: { basePath: string; tabs: readonly CaseTab[]; compact?: boolean; ariaLabel: string }) {
  const active = useActiveTab();
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
              aria-current={isActive ? "page" : undefined}
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

/** Le schede sotto la testata, dentro il blocco della testata. */
export function CaseTabs({ basePath, tabs }: { basePath: string; tabs: readonly CaseTab[] }) {
  if (tabs.length === 0) return null;
  return (
    <div className="mt-4">
      <TabRow basePath={basePath} tabs={tabs} ariaLabel="Sezioni del dossier" />
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
    <div className="sticky top-[61px] z-20 h-0 md:top-[53px]">
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
              <TabRow basePath={basePath} tabs={tabs} compact ariaLabel="Sezioni del dossier (barra fissa)" />
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

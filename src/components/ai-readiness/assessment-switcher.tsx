"use client";

import Link from "next/link";
import { Check, ChevronDown, Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLinkItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PAGE_TITLE_CLASS } from "@/components/dashboard/page-container";
import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { cn } from "@/lib/utils";

const T = READINESS_TEXT.switcher;
const ITEM = "min-h-11 gap-2 sm:min-h-8";

export interface AssessmentOption {
  id: string;
  name: string;
  /** Lo stato in italiano («Aperta»). */
  status: string;
  href: string;
}

/**
 * Il titolo della dashboard AI Readiness è un menu delle rilevazioni (rilascio 10, ondata 7b, §3.9): il nome della
 * rilevazione aperta, e nel menu le altre con il loro stato e «Nuova rilevazione» per chi gestisce. Con una rilevazione
 * sola e niente da creare il titolo è solo un titolo. Resta un H1: il menu sta dentro.
 */
export function AssessmentSwitcher({ title, currentId, options, newHref }: { title: string; currentId: string | null; options: readonly AssessmentOption[]; newHref: string | null }) {
  const others = options.filter((o) => o.id !== currentId);
  if (others.length === 0 && !newHref) {
    return <h1 className={cn(PAGE_TITLE_CLASS, "min-w-0 break-words")}>{title}</h1>;
  }
  return (
    <h1 className={cn(PAGE_TITLE_CLASS, "min-w-0")}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={T.label(title)}
          data-slot="assessment-switcher"
          className="-ml-2 flex min-h-11 max-w-full min-w-0 items-center gap-1.5 rounded-lg px-2 text-left outline-hidden hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted/60 sm:min-h-9"
        >
          <span className="min-w-0 break-words">{title}</span>
          <ChevronDown className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-auto min-w-64 max-w-[min(24rem,calc(100vw-2rem))]">
          {options.map((o) => (
            <DropdownMenuLinkItem key={o.id} render={<Link href={o.href} aria-current={o.id === currentId ? "page" : undefined} />} className={ITEM}>
              {o.id === currentId ? <Check aria-hidden /> : <span aria-hidden className="size-4" />}
              <span className="flex min-w-0 flex-col">
                <span className="break-words text-sm font-medium">{o.name}</span>
                <span className="text-xs text-muted-foreground">{o.status}</span>
              </span>
            </DropdownMenuLinkItem>
          ))}
          {newHref ? (
            <>
              {options.length ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLinkItem render={<Link href={newHref} />} className={ITEM} data-testid="assessment-new-link">
                <Plus aria-hidden />
                {T.newOne}
              </DropdownMenuLinkItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </h1>
  );
}

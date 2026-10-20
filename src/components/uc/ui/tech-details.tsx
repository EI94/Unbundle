import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { isLsViewer } from "@/lib/uc/views/status-groups";
import type { CaseRole } from "@/lib/uc/vocab";
import { CopyButton } from "./copy-button";

/**
 * «Dettagli tecnici» (DESIGN §5.1, §6.1): chiavi, hash, «Dal template»,
 * relazioni, codici dei fatti. Solo per Lateral Space: per gli altri ruoli
 * non si rende nulla. Chiuso di partenza; con `copyValue` c'è «Copia».
 */
export interface TechDetailsProps {
  roles: readonly CaseRole[];
  children: React.ReactNode;
  copyValue?: string;
  title?: string;
  className?: string;
}

export function TechDetails({ roles, children, copyValue, title = "Dettagli tecnici", className }: TechDetailsProps) {
  if (!isLsViewer(roles)) return null;
  return (
    <details data-slot="tech-details" className={cn("group min-w-0 rounded-lg ring-1 ring-foreground/10", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 text-sm text-muted-foreground select-none hover:text-foreground sm:min-h-9 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        {title}
      </summary>
      <div className="space-y-2 border-t px-3 py-3 font-mono text-xs break-all text-muted-foreground">
        {children}
        {copyValue && (
          <div className="font-sans">
            <CopyButton value={copyValue} />
          </div>
        )}
      </div>
    </details>
  );
}

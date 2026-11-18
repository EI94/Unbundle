import { roleLabel } from "@/lib/workspace-roles";
import Link from "next/link";
import type { Workspace } from "@/lib/db/schema";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SHELL_TEXT } from "@/lib/shell/text";

/**
 * Una card di «I tuoi workspace» (rilascio 10, PROPOSTA-10 §3.2): il nome, «Condiviso» per un workspace di un'altra
 * organizzazione, il ruolo in parole. Niente più lo stato del workspace («Setup», «Mapping»): non lo aggiornava nessuno.
 */
export function WorkspaceCard({
  workspace,
  accessSource,
  accessRole,
}: {
  workspace: Pick<Workspace, "id" | "name">;
  orgSlug: string;
  accessRole?: string;
  accessSource?: "organization" | "workspace";
}) {
  return (
    <Link
      href={`/dashboard/${workspace.id}`}
      className="group flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{workspace.name}</p>
          {accessSource === "workspace" ? (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {SHELL_TEXT.picker.shared}
            </Badge>
          ) : null}
        </div>
        {accessRole ? <p className="mt-0.5 text-xs text-muted-foreground">{roleLabel(accessRole)}</p> : null}
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

import Link from "next/link";
import type { Workspace } from "@/lib/db/schema";
import { ArrowRight } from "lucide-react";

const statusLabels: Record<string, string> = {
  setup: "Setup",
  mapping: "Mapping",
  analysis: "Analisi",
  complete: "Completato",
};

export function WorkspaceCard({
  workspace,
}: {
  workspace: Workspace;
  orgSlug: string;
}) {
  return (
    <Link
      href={`/dashboard/${workspace.id}`}
      className="group flex items-center justify-between rounded-lg border border-border px-4 py-3.5 hover:bg-accent transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{workspace.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {statusLabels[workspace.status] ?? workspace.status}
        </p>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-3" />
    </Link>
  );
}

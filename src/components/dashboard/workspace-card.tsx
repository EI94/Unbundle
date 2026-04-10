import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Workspace } from "@/lib/db/schema";
import { ArrowRight } from "lucide-react";

const statusLabels: Record<string, string> = {
  setup: "Setup",
  mapping: "Mapping",
  analysis: "Analisi",
  complete: "Completato",
};

const statusColors: Record<string, string> = {
  setup: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  mapping:
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  analysis:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  complete:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

export function WorkspaceCard({
  workspace,
  orgSlug,
}: {
  workspace: Workspace;
  orgSlug: string;
}) {
  return (
    <Link href={`/dashboard/${workspace.id}`}>
      <Card className="group cursor-pointer transition-all hover:shadow-md hover:border-primary/30">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <CardTitle className="text-base font-semibold line-clamp-1">
            {workspace.name}
          </CardTitle>
          <Badge
            variant="secondary"
            className={statusColors[workspace.status] ?? ""}
          >
            {statusLabels[workspace.status] ?? workspace.status}
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {workspace.description ?? "Nessuna descrizione"}
          </p>
          <div className="mt-4 flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
            Apri workspace
            <ArrowRight className="ml-1 h-4 w-4" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

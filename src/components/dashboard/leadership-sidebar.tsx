import { getWorkspaceById, getDepartmentsByWorkspace, getStrategicGoalsByWorkspace } from "@/lib/db/queries/workspaces";
import { getOrganizationBySlug } from "@/lib/db/queries/organizations";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Building2,
  Target,
  MapPin,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { getUnitTerm, capitalize } from "@/lib/utils/unit-terminology";

export async function LeadershipSidebar({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return null;

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId))
    .limit(1);

  const departments = await getDepartmentsByWorkspace(workspaceId);
  const goals = await getStrategicGoalsByWorkspace(workspaceId);
  const term = getUnitTerm(workspace);

  const thesis = org?.companyValueThesis as {
    coreValueProposition?: string;
    strategicNodes?: string[];
    commodityNodes?: string[];
    marginDrivers?: string[];
  } | null;

  const boundary = workspace.systemBoundary as {
    includedFunctions?: string[];
    rationale?: string;
  } | null;

  return (
    <div className="w-80 border-l border-border bg-muted/30">
      <ScrollArea className="h-full">
        <div className="p-4 space-y-6">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <MapPin className="h-4 w-4 text-primary" />
              Value Thesis
              {thesis ? (
                <CheckCircle2 className="h-3 w-3 text-green-500" />
              ) : (
                <Circle className="h-3 w-3 text-muted-foreground" />
              )}
            </h3>
            {thesis ? (
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  {thesis.coreValueProposition}
                </p>
                {thesis.strategicNodes && thesis.strategicNodes.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Nodi strategici:
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {thesis.strategicNodes.map((node) => (
                        <Badge key={node} variant="secondary" className="text-xs">
                          {node}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Verra&apos; compilata durante l&apos;intervista
              </p>
            )}
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Building2 className="h-4 w-4 text-primary" />
              {capitalize(term.plural)}
              {departments.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {departments.length}
                </Badge>
              )}
            </h3>
            {departments.length > 0 ? (
              <ul className="space-y-2">
                {departments.map((dept) => (
                  <li
                    key={dept.id}
                    className="text-sm flex items-center justify-between"
                  >
                    <span>{dept.name}</span>
                    <Badge
                      variant="outline"
                      className="text-xs capitalize"
                    >
                      {dept.mappingStatus.replace("_", " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Nessuna {term.singular} ancora creata
              </p>
            )}
          </div>

          <Separator />

          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Target className="h-4 w-4 text-primary" />
              Obiettivi Strategici
              {goals.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {goals.length}
                </Badge>
              )}
            </h3>
            {goals.length > 0 ? (
              <ul className="space-y-2">
                {goals.map((goal) => (
                  <li key={goal.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-xs shrink-0 capitalize"
                      >
                        {goal.type === "key_result" ? "KR" : goal.type}
                      </Badge>
                      <span className="truncate">{goal.title}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Nessun obiettivo ancora definito
              </p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

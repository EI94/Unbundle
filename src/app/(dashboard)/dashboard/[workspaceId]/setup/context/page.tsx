import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import {
  getWorkspaceById,
  getDepartmentsByWorkspace,
  getStrategicGoalsByWorkspace,
} from "@/lib/db/queries/workspaces";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import {
  ArrowRight,
  Compass,
  Check,
} from "lucide-react";
import { getUnitTerm, capitalize } from "@/lib/utils/unit-terminology";

export default async function ContextSetupPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId))
    .limit(1);

  const [departments, goals] = await Promise.all([
    getDepartmentsByWorkspace(workspaceId),
    getStrategicGoalsByWorkspace(workspaceId),
  ]);

  const thesis = org?.companyValueThesis as {
    coreValueProposition?: string;
    strategicNodes?: string[];
    commodityNodes?: string[];
    marginDrivers?: string[];
    keyRisks?: string[];
    aiReadiness?: string;
  } | null;

  const boundary = workspace.systemBoundary as {
    includedFunctions?: string[];
    excludedFunctions?: string[];
    rationale?: string;
    timeHorizon?: string;
  } | null;

  const term = getUnitTerm(workspace);
  const hasData = thesis || boundary || departments.length > 0 || goals.length > 0;

  return (
    <div className="flex-1 p-8 lg:p-12 max-w-3xl">
      <div className="mb-10">
        <span className="text-xs text-muted-foreground tracking-wide uppercase">
          Contesto
        </span>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">
          Contesto organizzativo
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dati raccolti durante la Discovery. Alimentano tutti gli step successivi.
        </p>
      </div>

      {!hasData ? (
        <div className="mt-16 text-center max-w-md mx-auto">
          <h2 className="text-lg font-medium">Nessun dato raccolto</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Il contesto viene costruito durante la Discovery.
            L&apos;AI raccoglie value thesis, perimetro, {term.plural} e obiettivi.
          </p>
          <Link
            href={`/dashboard/${workspaceId}/setup/leadership`}
            className="group mt-6 inline-flex items-center gap-2 text-sm font-medium hover:gap-3 transition-all"
          >
            Avvia la Discovery
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      ) : (
        <div className="space-y-10">
          {/* Value Thesis */}
          {thesis && (
            <section>
              <p className="text-xs text-muted-foreground tracking-wide mb-3">
                Value thesis
              </p>
              {thesis.coreValueProposition && (
                <p className="text-sm leading-relaxed mb-4">
                  {thesis.coreValueProposition}
                </p>
              )}
              <div className="grid grid-cols-2 gap-6">
                {thesis.strategicNodes && thesis.strategicNodes.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Nodi strategici</p>
                    <ul className="space-y-1">
                      {thesis.strategicNodes.map((n) => (
                        <li key={n} className="text-sm flex items-center gap-2">
                          <span className="h-1 w-1 rounded-full bg-foreground shrink-0" />
                          {n}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {thesis.commodityNodes && thesis.commodityNodes.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Nodi commodity</p>
                    <ul className="space-y-1">
                      {thesis.commodityNodes.map((n) => (
                        <li key={n} className="text-sm flex items-center gap-2 text-muted-foreground">
                          <span className="h-1 w-1 rounded-full bg-muted-foreground shrink-0" />
                          {n}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {thesis.marginDrivers && thesis.marginDrivers.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs text-muted-foreground mb-2">Motori di margine</p>
                  <ul className="space-y-1">
                    {thesis.marginDrivers.map((d, i) => (
                      <li key={i} className="text-sm text-muted-foreground">{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {thesis.keyRisks && thesis.keyRisks.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs text-muted-foreground mb-2">Rischi</p>
                  <ul className="space-y-1">
                    {thesis.keyRisks.map((r, i) => (
                      <li key={i} className="text-sm text-muted-foreground">{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {thesis.aiReadiness && (
                <div className="mt-4">
                  <p className="text-xs text-muted-foreground mb-1">AI Readiness</p>
                  <p className="text-sm">{thesis.aiReadiness}</p>
                </div>
              )}
            </section>
          )}

          {/* System Boundary */}
          {boundary && (
            <section>
              <p className="text-xs text-muted-foreground tracking-wide mb-3">
                Perimetro di analisi
              </p>
              {boundary.rationale && (
                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {boundary.rationale}
                </p>
              )}
              <div className="grid grid-cols-2 gap-6">
                {boundary.includedFunctions && boundary.includedFunctions.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Incluse</p>
                    <ul className="space-y-1">
                      {boundary.includedFunctions.map((f, i) => (
                        <li key={i} className="text-sm flex items-center gap-2">
                          <Check className="h-3 w-3 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {boundary.excludedFunctions && boundary.excludedFunctions.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Escluse</p>
                    <ul className="space-y-1">
                      {boundary.excludedFunctions.map((f, i) => (
                        <li key={i} className="text-sm text-muted-foreground">{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {boundary.timeHorizon && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Orizzonte: {boundary.timeHorizon}
                </p>
              )}
            </section>
          )}

          {/* Departments */}
          {departments.length > 0 && (
            <section>
              <p className="text-xs text-muted-foreground tracking-wide mb-3">
                {capitalize(term.plural)} ({departments.length})
              </p>
              <div className="space-y-1">
                {departments.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-accent transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm">{d.name}</p>
                      {d.description && (
                        <p className="text-xs text-muted-foreground truncate">{d.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 ml-3">
                      {d.teamSize && <span>{d.teamSize} persone</span>}
                      <span className="capitalize">{d.mappingStatus.replace("_", " ")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Goals */}
          {goals.length > 0 && (
            <section>
              <p className="text-xs text-muted-foreground tracking-wide mb-3">
                Obiettivi ({goals.length})
              </p>
              <div className="space-y-1">
                {goals.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                  >
                    <span className="text-xs text-muted-foreground shrink-0 w-8 uppercase">
                      {g.type === "key_result" ? "KR" : g.type}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{g.title}</p>
                      {g.description && (
                        <p className="text-xs text-muted-foreground truncate">{g.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import {
  Building2,
  MapPin,
  Target,
  Users,
  Compass,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Layers,
  Clock,
  Shield,
} from "lucide-react";

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

  const hasData = thesis || boundary || departments.length > 0 || goals.length > 0;

  return (
    <div className="flex-1 p-6 lg:p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Contesto Organizzativo
        </h1>
        <p className="mt-1 text-muted-foreground">
          Panoramica completa dei dati raccolti sull&apos;organizzazione.
          Queste informazioni alimentano tutti gli step successivi.
        </p>
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 p-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-5">
            <Compass className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-xl font-semibold mb-2">
            Nessun dato ancora raccolto
          </h3>
          <p className="max-w-md text-sm text-muted-foreground leading-relaxed mb-6">
            Il contesto organizzativo viene costruito durante l&apos;Intervista
            Strategica. L&apos;AI raccoglie value thesis, perimetro di analisi,
            dipartimenti e obiettivi strategici.
          </p>
          <Link
            href={`/dashboard/${workspaceId}/setup/leadership`}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Compass className="h-4 w-4" />
            Avvia l&apos;Intervista Strategica
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Value Thesis */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4 text-primary" />
                Value Thesis
                {thesis ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <Badge variant="outline" className="text-xs">
                    Da definire
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            {thesis ? (
              <CardContent className="space-y-4">
                {thesis.coreValueProposition && (
                  <div>
                    <p className="text-sm font-medium mb-1">
                      Proposta di valore
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {thesis.coreValueProposition}
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {thesis.strategicNodes &&
                    thesis.strategicNodes.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5 text-blue-500" />
                          Nodi strategici
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {thesis.strategicNodes.map((n) => (
                            <Badge key={n} variant="secondary" className="text-xs">
                              {n}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  {thesis.commodityNodes &&
                    thesis.commodityNodes.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5 text-gray-400" />
                          Nodi commodity
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {thesis.commodityNodes.map((n) => (
                            <Badge key={n} variant="outline" className="text-xs">
                              {n}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
                {thesis.marginDrivers &&
                  thesis.marginDrivers.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">
                        Motori di margine
                      </p>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        {thesis.marginDrivers.map((d, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="text-primary mt-1">•</span>
                            {d}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                {thesis.keyRisks && thesis.keyRisks.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                      Rischi chiave
                    </p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      {thesis.keyRisks.map((r, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-amber-500 mt-1">•</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {thesis.aiReadiness && (
                  <div>
                    <p className="text-sm font-medium mb-1 flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5 text-violet-500" />
                      AI Readiness
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {thesis.aiReadiness}
                    </p>
                  </div>
                )}
              </CardContent>
            ) : (
              <CardContent>
                <p className="text-sm text-muted-foreground italic">
                  Verr&agrave; definita durante l&apos;Intervista Strategica
                </p>
              </CardContent>
            )}
          </Card>

          {/* System Boundary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4 text-primary" />
                Perimetro di Analisi
                {boundary ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <Badge variant="outline" className="text-xs">
                    Da definire
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            {boundary ? (
              <CardContent className="space-y-4">
                {boundary.rationale && (
                  <div>
                    <p className="text-sm font-medium mb-1">Motivazione</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {boundary.rationale}
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {boundary.includedFunctions &&
                    boundary.includedFunctions.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2 text-green-600 dark:text-green-400">
                          Funzioni incluse
                        </p>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          {boundary.includedFunctions.map((f, i) => (
                            <li key={i} className="flex items-center gap-2">
                              <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  {boundary.excludedFunctions &&
                    boundary.excludedFunctions.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2 text-muted-foreground">
                          Funzioni escluse
                        </p>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          {boundary.excludedFunctions.map((f, i) => (
                            <li key={i} className="flex items-center gap-2">
                              <span className="h-3 w-3 text-center text-xs text-muted-foreground shrink-0">
                                —
                              </span>
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                </div>
                {boundary.timeHorizon && (
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">Orizzonte:</span>
                    <span className="text-muted-foreground">
                      {boundary.timeHorizon}
                    </span>
                  </div>
                )}
              </CardContent>
            ) : (
              <CardContent>
                <p className="text-sm text-muted-foreground italic">
                  Verr&agrave; definito durante l&apos;Intervista Strategica
                </p>
              </CardContent>
            )}
          </Card>

          {/* Departments */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-primary" />
                Dipartimenti
                {departments.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {departments.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {departments.length > 0 ? (
                <div className="space-y-3">
                  {departments.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between rounded-lg border border-border/60 p-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{d.name}</p>
                        {d.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {d.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {d.teamSize && (
                          <Badge variant="outline" className="text-xs">
                            {d.teamSize} persone
                          </Badge>
                        )}
                        <Badge
                          variant="secondary"
                          className="text-xs capitalize"
                        >
                          {d.mappingStatus.replace("_", " ")}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Nessun dipartimento ancora creato
                </p>
              )}
            </CardContent>
          </Card>

          {/* Strategic Goals */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-primary" />
                Obiettivi Strategici
                {goals.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {goals.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {goals.length > 0 ? (
                <div className="space-y-2">
                  {goals.map((g) => (
                    <div
                      key={g.id}
                      className="flex items-center gap-3 rounded-lg border border-border/60 p-3"
                    >
                      <Badge
                        variant="outline"
                        className="text-xs shrink-0 capitalize"
                      >
                        {g.type === "key_result" ? "KR" : g.type}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {g.title}
                        </p>
                        {g.description && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {g.description}
                          </p>
                        )}
                      </div>
                      {g.direction && (
                        <Badge variant="secondary" className="text-xs">
                          {g.direction}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Nessun obiettivo ancora definito
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

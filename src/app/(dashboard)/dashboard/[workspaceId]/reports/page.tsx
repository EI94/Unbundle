import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { db } from "@/lib/db";
import { reports } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { GenerateReportButton } from "@/components/dashboard/generate-report-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FileText, TrendingUp, Shield, Lightbulb, AlertTriangle, BarChart3 } from "lucide-react";
import type { ReportContent } from "@/lib/ai/generate-report";

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const allReports = await db
    .select()
    .from(reports)
    .where(eq(reports.workspaceId, workspaceId))
    .orderBy(desc(reports.generatedAt));

  const latestReport = allReports[0];
  const reportContent = latestReport?.content as ReportContent | null;

  return (
    <div className="flex-1 p-6 lg:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Report</h1>
          <p className="mt-1 text-muted-foreground">
            Executive report e output dell&apos;analisi Unbundle
          </p>
        </div>
        <GenerateReportButton workspaceId={workspaceId} />
      </div>

      {!reportContent ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">Nessun report generato</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Completa il mapping, la classificazione e la generazione dei use
            case, poi genera il report esecutivo.
          </p>
        </div>
      ) : (
        <div className="max-w-4xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Executive Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {reportContent.executiveSummary}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Value Thesis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {reportContent.valueThesisSummary}
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                  Top 3 Automate
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {reportContent.topAutomate.map((item, i) => (
                  <div key={i} className="space-y-1">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.description}
                    </p>
                    <Badge variant="outline" className="text-xs">
                      {item.impact}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4 text-purple-600" />
                  Top 3 Differentiate
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {reportContent.topDifferentiate.map((item, i) => (
                  <div key={i} className="space-y-1">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.description}
                    </p>
                    <Badge variant="outline" className="text-xs">
                      {item.impact}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="h-4 w-4 text-amber-600" />
                  Top 3 Innovate
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {reportContent.topInnovate.map((item, i) => (
                  <div key={i} className="space-y-1">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.description}
                    </p>
                    <Badge variant="outline" className="text-xs">
                      {item.impact}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {reportContent.governanceBlockers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Blockers da risolvere
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {reportContent.governanceBlockers.map((blocker, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-amber-500 mt-1">&#x2022;</span>
                      {blocker}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                KPI Baseline e Target
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {reportContent.kpiBaseline.map((kpi, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg bg-muted/50 p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{kpi.metric}</p>
                      <p className="text-xs text-muted-foreground">
                        {kpi.timeframe}
                      </p>
                    </div>
                    <div className="text-right font-mono text-sm">
                      <span className="text-muted-foreground">
                        {kpi.current}
                      </span>
                      <span className="mx-1">→</span>
                      <span className="font-semibold text-primary">
                        {kpi.target}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sequencing e Piano Operativo</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {reportContent.sequencingRecommendation}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Operating Model Implications</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {reportContent.operatingModelImplications.map((impl, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-primary mt-1">&#x2022;</span>
                    {impl}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

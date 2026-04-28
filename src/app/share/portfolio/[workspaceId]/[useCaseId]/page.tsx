import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import {
  getPortfolioContributionsByWorkspace,
  getUseCaseById,
} from "@/lib/db/queries/use-cases";
import { getOrCreateWorkspaceScoringModel } from "@/lib/db/queries/scoring-model";
import type { UseCase } from "@/lib/db/schema";
import type { ScoringModelConfig } from "@/lib/db/queries/scoring-model";
import {
  buildPortfolioSharePath,
  verifyPortfolioShareToken,
} from "@/lib/portfolio/share-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portfolio viewer",
  robots: { index: false, follow: false },
};

const kindLabels: Record<string, string> = {
  best_practice: "Best Practice",
  use_case_ai: "Use Case AI",
};

const statusLabels: Record<string, string> = {
  needs_inputs: "Dati mancanti",
  in_review: "In review",
  scored: "Valutato",
  archived: "Archiviato",
};

const sustainabilityPalette = {
  neutral: { fill: "#64748b", soft: "rgba(100, 116, 139, 0.18)" },
  red: { fill: "#ef4444", soft: "rgba(239, 68, 68, 0.18)" },
  yellow: { fill: "#f59e0b", soft: "rgba(245, 158, 11, 0.2)" },
  green: { fill: "#22c55e", soft: "rgba(34, 197, 94, 0.18)" },
} as const;

type PublicPortfolioItem = Pick<
  UseCase,
  | "id"
  | "title"
  | "description"
  | "businessCase"
  | "flowDescription"
  | "humanInTheLoop"
  | "guardrails"
  | "dataRequirements"
  | "sustainabilityImpact"
  | "overallImpactScore"
  | "overallFeasibilityScore"
  | "overallEsgScore"
  | "overallScore"
  | "portfolioKind"
  | "portfolioReviewStatus"
>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function clampScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, value));
}

function formatScore(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "-";
}

function sustainabilityBand(score: number | null | undefined, esgEnabled: boolean) {
  if (!esgEnabled || typeof score !== "number" || !Number.isFinite(score) || score <= 0) {
    return "neutral";
  }
  if (score >= 3.7) return "green";
  if (score >= 2.6) return "yellow";
  return "red";
}

function loginHref(workspaceId: string, useCaseId: string) {
  const callbackUrl = `/dashboard/${workspaceId}/portfolio/review/${useCaseId}`;
  return `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

function InvalidShareLink() {
  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex min-h-[70vh] max-w-xl items-center">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Link non valido</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Questo link viewer non è valido o è stato copiato parzialmente.
              Chiedi al team che gestisce il workspace di condividere di nuovo
              il link da Unbundle.
            </p>
            <Link href="/login">
              <Button>Accedi a Unbundle</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function MetricPill({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="rounded-2xl border bg-background/70 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{formatScore(value)}</div>
    </div>
  );
}

function DetailSection({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="rounded-2xl border bg-background/50 p-4">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
        {value?.trim() || "-"}
      </div>
    </div>
  );
}

function PublicMatrix({
  workspaceId,
  selectedId,
  token,
  items,
  config,
  esgEnabled,
}: {
  workspaceId: string;
  selectedId: string;
  token: string;
  items: PublicPortfolioItem[];
  config: ScoringModelConfig;
  esgEnabled: boolean;
}) {
  const highImpact = clampScore(config.thresholds.highImpact);
  const highFeasibility = clampScore(config.thresholds.highFeasibility);
  const highImpactTop = 100 - (highImpact / 5) * 100;
  const highFeasibilityLeft = (highFeasibility / 5) * 100;
  const positioned = items
    .filter(
      (item) =>
        typeof item.overallImpactScore === "number" &&
        typeof item.overallFeasibilityScore === "number" &&
        (item.overallImpactScore !== 0 || item.overallFeasibilityScore !== 0)
    )
    .map((item) => {
      const x = (clampScore(item.overallFeasibilityScore) / 5) * 100;
      const y = 100 - (clampScore(item.overallImpactScore) / 5) * 100;
      const band = sustainabilityBand(item.overallEsgScore, esgEnabled);
      return { ...item, x, y, band, palette: sustainabilityPalette[band] };
    });

  if (positioned.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed p-8 text-sm text-muted-foreground">
        Appena ci saranno contributi valutati, li vedrai qui sulla matrice.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative aspect-[1.5/1] overflow-hidden rounded-[28px] border bg-linear-to-br from-emerald-500/10 via-background to-amber-500/10 p-6">
        <div
          className="absolute bottom-10 top-8 border-l border-dashed border-foreground/30"
          style={{ left: `${highFeasibilityLeft}%` }}
        />
        <div
          className="absolute left-12 right-8 border-t border-dashed border-foreground/30"
          style={{ top: `${highImpactTop}%` }}
        />
        <div className="absolute left-5 top-5 text-xs font-medium text-muted-foreground">
          Impatto
        </div>
        <div className="absolute bottom-4 right-5 text-xs font-medium text-muted-foreground">
          Fattibilità
        </div>
        <div className="absolute right-6 top-5 rounded-full border bg-background/70 px-3 py-1 text-[11px] text-muted-foreground">
          Quick win
        </div>
        <div className="absolute left-6 top-5 rounded-full border bg-background/70 px-3 py-1 text-[11px] text-muted-foreground">
          Strategic bet
        </div>
        <div className="absolute bottom-5 left-6 rounded-full border bg-background/70 px-3 py-1 text-[11px] text-muted-foreground">
          Not yet
        </div>
        <div className="absolute bottom-5 right-6 rounded-full border bg-background/70 px-3 py-1 text-[11px] text-muted-foreground">
          Capability builder
        </div>

        {positioned.map((item) => {
          const isSelected = item.id === selectedId;
          const isUseCase = item.portfolioKind === "use_case_ai";
          return (
            <Link
              key={item.id}
              href={buildPortfolioSharePath(workspaceId, item.id, { token })}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${Math.max(6, Math.min(94, item.x))}%`,
                top: `${Math.max(8, Math.min(92, item.y))}%`,
              }}
              title={item.title}
            >
              <span
                className={[
                  "grid size-10 place-items-center rounded-full transition-transform hover:scale-110",
                  isSelected ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "",
                ].join(" ")}
                style={{ backgroundColor: item.palette.soft }}
              >
                <span
                  className={isUseCase ? "block size-4 rounded-full" : "block size-4 rounded-sm"}
                  style={{ backgroundColor: item.palette.fill }}
                />
              </span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Cerchio = Use Case AI</span>
        <span>Quadrato = Best Practice</span>
        <span>Verde/Giallo/Rosso = impatto sostenibilità</span>
      </div>
    </div>
  );
}

export default async function PublicPortfolioSharePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; useCaseId: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { workspaceId, useCaseId } = await params;
  const token = firstParam((await searchParams).token) ?? "";

  const session = await auth();
  if (session?.user?.id) {
    const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
    if (access) {
      redirect(`/dashboard/${workspaceId}/portfolio/review/${useCaseId}`);
    }
  }

  if (!verifyPortfolioShareToken(workspaceId, token)) {
    return <InvalidShareLink />;
  }

  const [workspace, selected, model, contributions] = await Promise.all([
    getWorkspaceById(workspaceId),
    getUseCaseById(useCaseId),
    getOrCreateWorkspaceScoringModel(workspaceId),
    getPortfolioContributionsByWorkspace(workspaceId),
  ]);

  if (!workspace || !selected || selected.workspaceId !== workspaceId) notFound();
  if (!selected.portfolioKind) notFound();

  const esgEnabled = workspace.esgEnabled === true;
  const teamName =
    workspace.aiTransformationTeamName?.trim() || "AI Transformation";
  const sorted = contributions
    .slice()
    .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
  const privateReviewHref = `/dashboard/${workspaceId}/portfolio/review/${useCaseId}`;
  const loginUrl = loginHref(workspaceId, useCaseId);

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border bg-card/80 p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Viewer mode</Badge>
                <Badge variant="secondary">{workspace.name}</Badge>
                <Badge variant="outline">{teamName}</Badge>
              </div>
              <div>
                <h1 className="max-w-4xl text-3xl font-semibold tracking-tight sm:text-4xl">
                  Raccolta & Ranking
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Stai vedendo una copia in sola lettura del portfolio condivisa
                  via Slack. Se hai un account Unbundle con accesso al workspace,
                  accedi e potrai aprire la scheda editabile.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={loginUrl}>
                <Button>Accedi per modificare</Button>
              </Link>
              <Link href={privateReviewHref}>
                <Button variant="outline">Apri dashboard</Button>
              </Link>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <Card className="rounded-[28px]">
            <CardHeader>
              <CardTitle>Matrice portfolio</CardTitle>
            </CardHeader>
            <CardContent>
              <PublicMatrix
                workspaceId={workspaceId}
                selectedId={selected.id}
                token={token}
                items={sorted}
                config={model.resolvedConfig}
                esgEnabled={esgEnabled}
              />
            </CardContent>
          </Card>

          <Card className="rounded-[28px]">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{selected.title}</CardTitle>
                <Badge variant="secondary" className="text-[10px]">
                  {kindLabels[selected.portfolioKind] ?? selected.portfolioKind}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-normal">
                  {statusLabels[selected.portfolioReviewStatus] ??
                    selected.portfolioReviewStatus}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MetricPill label="Impatto" value={selected.overallImpactScore} />
                <MetricPill
                  label="Fattibilità"
                  value={selected.overallFeasibilityScore}
                />
                {esgEnabled && (
                  <MetricPill label="ESG" value={selected.overallEsgScore} />
                )}
                <MetricPill
                  label="Score"
                  value={selected.overallScore}
                />
              </div>
              <DetailSection label="Anteprima" value={selected.description} />
              <DetailSection label="Flusso" value={selected.flowDescription} />
              <DetailSection
                label={
                  selected.portfolioKind === "best_practice"
                    ? "Beneficiari e adozione"
                    : "Controllo umano"
                }
                value={selected.humanInTheLoop}
              />
              {selected.guardrails && (
                <DetailSection label="Guardrail" value={selected.guardrails} />
              )}
              <DetailSection label="Impatto atteso" value={selected.businessCase} />
              <DetailSection label="Dati necessari" value={selected.dataRequirements} />
              {esgEnabled && (
                <DetailSection
                  label="Impatto ambientale e sociale"
                  value={selected.sustainabilityImpact}
                />
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((item) => {
            const band = sustainabilityBand(item.overallEsgScore, esgEnabled);
            const palette = sustainabilityPalette[band];
            const isSelected = item.id === selected.id;
            return (
              <Link
                key={item.id}
                href={buildPortfolioSharePath(workspaceId, item.id, { token })}
                className={[
                  "rounded-3xl border p-4 transition-colors hover:bg-muted/50",
                  isSelected ? "border-foreground/40 bg-muted/40" : "bg-card/70",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{item.title}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {kindLabels[item.portfolioKind ?? ""] ?? item.portfolioKind}
                      </Badge>
                    </div>
                    <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {item.description ?? "Nessuna descrizione disponibile."}
                    </p>
                  </div>
                  <span
                    className={
                      item.portfolioKind === "use_case_ai"
                        ? "mt-1 size-3 shrink-0 rounded-full"
                        : "mt-1 size-3 shrink-0 rounded-sm"
                    }
                    style={{ backgroundColor: palette.fill }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Impact {formatScore(item.overallImpactScore)}</span>
                  <span>Feasibility {formatScore(item.overallFeasibilityScore)}</span>
                  <span>Score {formatScore(item.overallScore, 2)}</span>
                </div>
              </Link>
            );
          })}
        </section>
      </div>
    </main>
  );
}

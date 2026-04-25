import * as XLSX from "xlsx";
import { auth } from "@/lib/auth";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getPortfolioContributionsByWorkspace } from "@/lib/db/queries/use-cases";
import { getOrCreateWorkspaceScoringModel } from "@/lib/db/queries/scoring-model";
import {
  buildPortfolioWavePlan,
  buildWaveCandidate,
  getSustainabilityBand,
} from "@/lib/portfolio/planning";

export const dynamic = "force-dynamic";

const currency = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const kindLabels: Record<string, string> = {
  best_practice: "Best Practice",
  use_case_ai: "Use Case AI",
};

const reviewStatusLabels: Record<string, string> = {
  needs_inputs: "Dati mancanti",
  in_review: "In review",
  scored: "Valutato",
  archived: "Archiviato",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const waveBudget = Math.max(
    10000,
    Number(url.searchParams.get("waveBudget") ?? "150000") || 150000
  );
  const waveDurationMonths = Math.max(
    1,
    Math.min(12, Number(url.searchParams.get("waveDurationMonths") ?? "3") || 3)
  );

  const [model, contributions] = await Promise.all([
    getOrCreateWorkspaceScoringModel(workspaceId),
    getPortfolioContributionsByWorkspace(workspaceId),
  ]);
  const esgEnabled = workspace.esgEnabled === true;
  const plan = buildPortfolioWavePlan({
    items: contributions,
    config: model.resolvedConfig,
    esgEnabled,
    waveBudget,
    waveDurationMonths,
  });

  const workbook = XLSX.utils.book_new();

  const portfolioRows = contributions
    .slice()
    .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0))
    .map((item) => {
      const candidate = buildWaveCandidate(item, model.resolvedConfig, esgEnabled);
      return {
        Titolo: item.title,
        Tipo: kindLabels[item.portfolioKind ?? ""] ?? item.portfolioKind ?? "Contributo",
        "Stato review":
          reviewStatusLabels[item.portfolioReviewStatus] ?? item.portfolioReviewStatus,
        "Overall score": item.overallScore ?? null,
        Impact: item.overallImpactScore ?? null,
        Feasibility: item.overallFeasibilityScore ?? null,
        ESG: item.overallEsgScore ?? null,
        Efficiency: candidate.efficiencyScore || null,
        Profitability: candidate.profitabilityScore || null,
        Effort: candidate.effortScore || null,
        Sustainability: esgEnabled
          ? getSustainabilityBand(item.overallEsgScore)
          : "neutral",
        "Costo stimato": candidate.estimatedCost,
        "Valore lordo stimato": candidate.estimatedValue,
        "Valore netto stimato": candidate.estimatedNetValue,
        Problema: item.description ?? "",
        Flusso: item.flowDescription ?? "",
        "Business case": item.businessCase ?? "",
        "Human in the loop": item.humanInTheLoop ?? "",
        Guardrail: item.guardrails ?? "",
        "Dati necessari": item.dataRequirements ?? "",
        "Impatto ambientale e sociale": item.sustainabilityImpact ?? "",
      };
    });
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(portfolioRows),
    "Portfolio"
  );

  const waveRows = plan.waves.flatMap((wave) =>
    wave.items.map((item) => ({
      Wave: wave.label,
      Inizio: wave.startLabel,
      Fine: wave.endLabel,
      "Budget wave": wave.budget,
      "Budget usato wave": wave.budgetUsed,
      "Titolo contributo": item.useCase.title,
      Tipo:
        kindLabels[item.useCase.portfolioKind ?? ""] ??
        item.useCase.portfolioKind ??
        "Contributo",
      "Overall score": item.useCase.overallScore ?? null,
      "Costo stimato": item.estimatedCost,
      "Valore lordo stimato": item.estimatedValue,
      "Valore netto stimato": item.estimatedNetValue,
      Efficiency: item.efficiencyScore || null,
      Profitability: item.profitabilityScore || null,
      Effort: item.effortScore || null,
      Sustainability: item.sustainabilityBand,
      Descrizione: item.useCase.description ?? "",
    }))
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(waveRows), "Waves");

  const summaryRows = [
    { Voce: "Workspace", Valore: workspace.name },
    { Voce: "ESG attivo", Valore: esgEnabled ? "Si" : "No" },
    { Voce: "Budget per wave", Valore: currency.format(waveBudget) },
    { Voce: "Durata wave (mesi)", Valore: String(waveDurationMonths) },
    { Voce: "Contributi pianificati", Valore: String(plan.totals.items) },
    { Voce: "Numero wave", Valore: String(plan.waves.length) },
    { Voce: "Budget complessivo", Valore: currency.format(plan.totals.budget) },
    {
      Voce: "Budget utilizzato",
      Valore: currency.format(plan.totals.budgetUsed),
    },
    {
      Voce: "Valore lordo stimato",
      Valore: currency.format(plan.totals.estimatedValue),
    },
    {
      Voce: "Valore netto stimato",
      Valore: currency.format(plan.totals.estimatedNetValue),
    },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Summary");

  const file = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  const safeName = workspace.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return new Response(file, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName || "unbundle"}-portfolio.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

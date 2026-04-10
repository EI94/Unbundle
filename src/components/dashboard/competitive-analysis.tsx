"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp,
  Zap,
  ShieldAlert,
  Loader2,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import {
  generateCompetitiveAnalysis,
  type CompetitiveAnalysis,
} from "@/lib/actions/intelligence";

interface CompetitiveAnalysisViewerProps {
  workspaceId: string;
}

const relevanceColors: Record<string, string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  medium:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

const timeframeLabels: Record<string, string> = {
  immediate: "Immediato",
  short_term: "Breve termine",
  medium_term: "Medio termine",
  long_term: "Lungo termine",
};

export function CompetitiveAnalysisViewer({
  workspaceId,
}: CompetitiveAnalysisViewerProps) {
  const [analysis, setAnalysis] = useState<CompetitiveAnalysis | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleGenerate = () => {
    startTransition(async () => {
      const result = await generateCompetitiveAnalysis(workspaceId);
      setAnalysis(result);
    });
  };

  if (!analysis) {
    return (
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>Analisi Competitiva AI</CardTitle>
          <CardDescription>
            Genera un report di intelligence competitiva basato sulle attivita'
            mappate, i use case identificati e i segnali recenti.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pb-6">
          <Button onClick={handleGenerate} disabled={isPending} size="lg">
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analisi in corso...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Genera Analisi
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Sommario Esecutivo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {analysis.summary}
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="trends">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="trends" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            Trend ({analysis.marketTrends.length})
          </TabsTrigger>
          <TabsTrigger value="opportunities" className="gap-2">
            <Zap className="h-4 w-4" />
            Opportunita' ({analysis.automationOpportunities.length})
          </TabsTrigger>
          <TabsTrigger value="risks" className="gap-2">
            <ShieldAlert className="h-4 w-4" />
            Rischi ({analysis.riskFactors.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="mt-4 space-y-3">
          {analysis.marketTrends.map((trend, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold">{trend.trend}</h4>
                      <Badge
                        className={`text-xs ${
                          relevanceColors[trend.relevance]
                        }`}
                      >
                        {trend.relevance === "high"
                          ? "Alta"
                          : trend.relevance === "medium"
                            ? "Media"
                            : "Bassa"}{" "}
                        rilevanza
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {trend.description}
                    </p>
                    <div className="mt-2 flex items-center gap-1 text-xs font-medium text-primary">
                      <ArrowRight className="h-3 w-3" />
                      {trend.suggestedAction}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="opportunities" className="mt-4 space-y-3">
          {analysis.automationOpportunities.map((opp, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                    <Zap className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold">{opp.area}</h4>
                      <Badge variant="outline" className="text-xs">
                        {timeframeLabels[opp.timeframe] ?? opp.timeframe}
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">
                          Stato attuale:
                        </span>
                        <p className="font-medium">{opp.currentState}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Guadagno potenziale:
                        </span>
                        <p className="font-medium text-green-600 dark:text-green-400">
                          {opp.potentialGain}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="risks" className="mt-4 space-y-3">
          {analysis.riskFactors.map((risk, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                    <ShieldAlert className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold">{risk.risk}</h4>
                      <Badge
                        className={`text-xs ${
                          relevanceColors[risk.probability]
                        }`}
                      >
                        P:{" "}
                        {risk.probability === "high"
                          ? "Alta"
                          : risk.probability === "medium"
                            ? "Media"
                            : "Bassa"}
                      </Badge>
                      <Badge
                        className={`text-xs ${
                          relevanceColors[risk.impact]
                        }`}
                      >
                        I:{" "}
                        {risk.impact === "high"
                          ? "Alto"
                          : risk.impact === "medium"
                            ? "Medio"
                            : "Basso"}
                      </Badge>
                    </div>
                    <div className="mt-2 rounded-md bg-muted p-2">
                      <span className="text-xs text-muted-foreground">
                        Mitigazione:
                      </span>
                      <p className="text-xs font-medium">{risk.mitigation}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <div className="flex justify-center">
        <Button variant="outline" onClick={handleGenerate} disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Rigenerazione...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Rigenera Analisi
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

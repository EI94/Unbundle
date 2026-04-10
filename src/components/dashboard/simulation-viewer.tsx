"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, FlaskConical, Cpu, Users, TrendingUp, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { generateSimulationAction } from "@/lib/actions/simulation";
import type { SimulationResult } from "@/lib/ai/generate-simulation";

export function SimulationViewer({ workspaceId }: { workspaceId: string }) {
  const [loading, setLoading] = useState(false);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await generateSimulationAction(workspaceId);
      setSimulation(result);
      toast.success("Simulazione completata");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Errore nella simulazione"
      );
    } finally {
      setLoading(false);
    }
  };

  if (!simulation) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
        <FlaskConical className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold">
          Simulazione &amp; Org Redesign
        </h3>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Genera scenari &quot;what if&quot; per capire l&apos;impatto della
          trasformazione su ruoli, costi e organizzazione.
        </p>
        <Button onClick={handleGenerate} disabled={loading} className="mt-4">
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FlaskConical className="mr-2 h-4 w-4" />
          )}
          {loading ? "Simulazione in corso..." : "Avvia Simulazione"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Tabs defaultValue={simulation.scenarios[0]?.name}>
        <TabsList>
          {simulation.scenarios.map((s) => (
            <TabsTrigger key={s.name} value={s.name}>
              {s.name}
            </TabsTrigger>
          ))}
          <TabsTrigger value="aios">AI OS</TabsTrigger>
        </TabsList>

        {simulation.scenarios.map((scenario) => (
          <TabsContent key={scenario.name} value={scenario.name} className="mt-6 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{scenario.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {scenario.description}
                </p>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Card>
                <CardContent className="pt-4 text-center">
                  <Users className="h-5 w-5 text-primary mx-auto mb-1" />
                  <div className="text-2xl font-bold">
                    -{scenario.impacts.fteReduction}
                  </div>
                  <p className="text-xs text-muted-foreground">FTE ridotti</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <Users className="h-5 w-5 text-blue-500 mx-auto mb-1" />
                  <div className="text-2xl font-bold">
                    +{scenario.impacts.fteReallocation}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    FTE riallocati
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <TrendingUp className="h-5 w-5 text-green-500 mx-auto mb-1" />
                  <div className="text-lg font-bold">
                    {scenario.impacts.estimatedCostSaving}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Saving stimato
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <TrendingUp className="h-5 w-5 text-primary mx-auto mb-1" />
                  <div className="text-lg font-bold">
                    {scenario.impacts.estimatedRevenueImpact}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Impatto revenue
                  </p>
                </CardContent>
              </Card>
            </div>

            {scenario.impacts.newRolesCreated.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Nuovi ruoli</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {scenario.impacts.newRolesCreated.map((role, i) => (
                      <Badge key={i} variant="secondary">
                        {role}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {scenario.impacts.rolesTransformed.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Ruoli trasformati
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {scenario.impacts.rolesTransformed.map((rt, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span className="font-medium">{rt.role}:</span>
                        <span className="text-muted-foreground">{rt.from}</span>
                        <span>→</span>
                        <span className="text-primary">{rt.to}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Cpu className="h-4 w-4" /> AI OS Building Blocks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {scenario.aiOsBuilding.map((block, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-muted/50 p-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{block.block}</p>
                        <p className="text-xs text-muted-foreground">
                          {block.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            block.buildVsBuy === "buy"
                              ? "secondary"
                              : "default"
                          }
                          className="text-xs"
                        >
                          {block.buildVsBuy}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {block.priority.replace(/_/g, " ")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {block.estimatedCost}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {scenario.risks.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Rischi
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm">
                    {scenario.risks.map((risk, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-amber-500 mt-0.5">&#x2022;</span>
                        {risk}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ))}

        <TabsContent value="aios" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>AI Operating System — Raccomandazioni</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {Object.entries(simulation.aiOsSummary).map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-start gap-4 rounded-lg bg-muted/50 p-4"
                >
                  <Badge
                    variant={value.needed ? "default" : "secondary"}
                    className="shrink-0 mt-0.5"
                  >
                    {value.needed ? "Necessario" : "Opzionale"}
                  </Badge>
                  <div>
                    <p className="text-sm font-medium capitalize">
                      {key.replace(/([A-Z])/g, " $1").trim()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {value.recommendation}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Bot, Wrench, Shield, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { generateBlueprintsAction } from "@/lib/actions/blueprints";
import type { AgentBlueprint } from "@/lib/ai/generate-blueprints";

export function BlueprintViewer({ workspaceId }: { workspaceId: string }) {
  const [loading, setLoading] = useState(false);
  const [blueprints, setBlueprints] = useState<AgentBlueprint[]>([]);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await generateBlueprintsAction(workspaceId);
      setBlueprints(result);
      toast.success(`${result.length} blueprint generati`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Errore nella generazione"
      );
    } finally {
      setLoading(false);
    }
  };

  if (blueprints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center">
        <Bot className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold">Agent Blueprinting</h3>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Genera blueprint tecnici per gli agenti AI necessari a implementare i
          use case.
        </p>
        <Button onClick={handleGenerate} disabled={loading} className="mt-4">
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Bot className="mr-2 h-4 w-4" />
          )}
          {loading ? "Generazione in corso..." : "Genera Blueprint"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {blueprints.map((bp) => (
        <Card key={bp.useCaseId}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              {bp.agentName}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{bp.agentDescription}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Input</h4>
                {bp.inputs.map((input, i) => (
                  <div key={i} className="text-xs mb-1">
                    <Badge variant="outline" className="mr-1">
                      {input.type}
                    </Badge>
                    {input.name} ({input.source})
                  </div>
                ))}
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Output</h4>
                {bp.outputs.map((output, i) => (
                  <div key={i} className="text-xs mb-1">
                    <Badge variant="outline" className="mr-1">
                      {output.type}
                    </Badge>
                    {output.name} ({output.destination})
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                <Wrench className="h-3 w-3" /> Tools necessari
              </h4>
              <div className="flex flex-wrap gap-2">
                {bp.tools.map((tool, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    [{tool.type}] {tool.name}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                <Shield className="h-3 w-3" /> Guardrails
              </h4>
              <ul className="text-xs space-y-1 text-muted-foreground">
                {bp.guardrails.map((g, i) => (
                  <li key={i}>&#x2022; {g}</li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2">
                Step di implementazione
              </h4>
              <ol className="text-xs space-y-1 text-muted-foreground list-decimal list-inside">
                {bp.implementationSteps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span>
                Sforzo stimato:{" "}
                <strong>{bp.estimatedEffort}</strong>
              </span>
              <span className="text-muted-foreground">
                LLM: {bp.llmRequirements.modelType} (~
                {bp.llmRequirements.estimatedCostPerRun}/run)
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

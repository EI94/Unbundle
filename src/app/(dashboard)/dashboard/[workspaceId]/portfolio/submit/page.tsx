import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { createPortfolioSubmissionAction } from "@/lib/actions/portfolio";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

function CommonFields({
  portfolioKind,
  showGuardrails,
}: {
  portfolioKind: "best_practice" | "use_case_ai";
  showGuardrails: boolean;
}) {
  return (
    <>
      <input type="hidden" name="portfolioKind" value={portfolioKind} />
      <div className="grid gap-4">
        <div>
          <label className="text-sm font-medium">Titolo</label>
          <Input name="title" placeholder="Dai un nome chiaro al contributo" required />
        </div>
        <div>
          <label className="text-sm font-medium">
            {portfolioKind === "best_practice"
              ? "Prima (problema / come funzionava)"
              : "Problema (perché serve)"}{" "}
          </label>
          <Textarea name="problem" required rows={4} placeholder="Scrivi in modo semplice: contesto, frizione, perché è importante" />
        </div>
        <div>
          <label className="text-sm font-medium">
            {portfolioKind === "best_practice"
              ? "Adesso (come funziona con l'AI)"
              : "Flusso as-is → to-be"}{" "}
          </label>
          <Textarea name="flowDescription" required rows={4} placeholder="Descrivi i passi principali. Se puoi: strumenti, dati, output." />
        </div>
        <div>
          <label className="text-sm font-medium">
            {portfolioKind === "best_practice"
              ? "Risultato (beneficio osservato)"
              : "Impatto atteso"}{" "}
          </label>
          <Textarea name="expectedImpact" required rows={4} placeholder="Tempo, qualità, costo, ricavi, rischio… anche in stima / range va bene." />
        </div>
        <div>
          <label className="text-sm font-medium">Human-in-the-loop</label>
          <Textarea name="humanInTheLoop" required rows={3} placeholder="Chi fa cosa? Chi valida? Chi approva? Quante persone coinvolte?" />
        </div>
        {showGuardrails && (
          <div>
            <label className="text-sm font-medium">Guardrail</label>
            <Textarea name="guardrails" rows={3} placeholder="Vincoli, compliance, privacy, tono di voce, escalation…" />
          </div>
        )}
        <div>
          <label className="text-sm font-medium">Dati necessari</label>
          <Textarea name="dataRequirements" required rows={3} placeholder="Che dati servono? Dove stanno? Sono già disponibili?" />
        </div>
        {portfolioKind === "use_case_ai" && (
          <div>
            <label className="text-sm font-medium">Urgenza</label>
            <Input name="urgency" placeholder="es. quick win / progetto 3-6 mesi / 6-12 mesi" />
          </div>
        )}
      </div>
    </>
  );
}

export default async function PortfolioSubmitPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  return (
    <div className="flex-1 p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Nuovo contributo</h1>
        <p className="mt-1 text-muted-foreground max-w-2xl">
          Compila in modo semplice. Alla fine ti ringraziamo e il team di AI Transformation
          potrà valutare e confrontare i contributi nella matrice.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Seleziona il tipo e rispondi alle domande</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="use_case_ai">
            <TabsList>
              <TabsTrigger value="use_case_ai">Use Case AI</TabsTrigger>
              <TabsTrigger value="best_practice">Best Practice</TabsTrigger>
            </TabsList>

            <TabsContent value="use_case_ai" className="mt-6">
              <form
                action={createPortfolioSubmissionAction.bind(null, workspaceId)}
                className="space-y-6"
              >
                <CommonFields portfolioKind="use_case_ai" showGuardrails />
                <Button type="submit" className="w-full">
                  Invia use case AI
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="best_practice" className="mt-6">
              <form
                action={createPortfolioSubmissionAction.bind(null, workspaceId)}
                className="space-y-6"
              >
                <CommonFields portfolioKind="best_practice" showGuardrails={false} />
                <Button type="submit" className="w-full">
                  Invia best practice
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}


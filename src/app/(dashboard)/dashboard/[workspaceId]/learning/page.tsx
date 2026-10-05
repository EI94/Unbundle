import Link from "next/link";
import { ChartColumn } from "lucide-react";
import { getLearningHome } from "@/lib/learning/server";
import { getLearningAdminCatalog } from "@/lib/learning/admin";
import { LearningShell, LearningUnavailable } from "@/components/learning/learning-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export default async function LearningHome({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const home = await getLearningHome(workspaceId);
  const admin = home.enabled ? await getLearningAdminCatalog(workspaceId) : null;
  return <LearningShell workspaceId={workspaceId} title="La tua formazione">
    <p>Materiali, attività e feedback personali. Un percorso per imparare e riprovare, senza classifiche.</p>
    {(admin?.canCreate || admin?.canManage) && <div className="flex flex-wrap gap-3">
      <Link className="inline-block rounded-lg border px-4 py-2 text-sm font-medium" href={`/dashboard/${workspaceId}/learning/admin`}>Gestisci formazione</Link>
      <Link className="inline-block rounded-lg border px-4 py-2 text-sm font-medium" href={`/dashboard/${workspaceId}/learning/register`}>Registro formazione IA</Link>
    </div>}
    {!home.enabled ? <LearningUnavailable message="La formazione non è ancora attiva in questo ambiente. Le altre sezioni del workspace restano disponibili." /> : home.programs.length === 0 ? <LearningUnavailable message="Non hai ancora un percorso assegnato in questo workspace. Rivolgiti al responsabile della formazione." /> : <div className="grid gap-4 sm:grid-cols-2">{home.programs.map((program) => <Card key={program.id}><CardHeader><CardTitle>{program.title}</CardTitle></CardHeader><CardContent className="space-y-3">
      {program.cohortId && <p className="text-sm text-muted-foreground">Turno {program.cohortId}</p>}
      <div className="flex flex-wrap gap-2">
        <Link className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 py-2 text-primary-foreground" href={`/dashboard/${workspaceId}/learning/${program.id}`}>Apri percorso</Link>
        {(program.canReview || program.canAggregate || program.canExport || program.canManage) && <Link data-testid="program-results-link" className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted" href={`/dashboard/${workspaceId}/learning/${program.id}/results`}>
          <ChartColumn aria-hidden className="size-4" /> Risultati
        </Link>}
      </div>
    </CardContent></Card>)}</div>}
  </LearningShell>;
}

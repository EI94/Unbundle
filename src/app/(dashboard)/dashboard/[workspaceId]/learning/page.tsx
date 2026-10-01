import Link from "next/link";
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
    {(admin?.canCreate || admin?.canManage) && <Link className="inline-block rounded-lg border px-4 py-2 text-sm font-medium" href={`/dashboard/${workspaceId}/learning/admin`}>Gestisci formazione</Link>}
    {!home.enabled ? <LearningUnavailable message="La formazione non è ancora attiva in questo ambiente. Le altre sezioni del workspace restano disponibili." /> : home.programs.length === 0 ? <LearningUnavailable message="Non hai ancora un percorso assegnato in questo workspace. Rivolgiti al responsabile della formazione." /> : <div className="grid gap-4 sm:grid-cols-2">{home.programs.map((program) => <Card key={program.id}><CardHeader><CardTitle>{program.title}</CardTitle></CardHeader><CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">Versione {program.version}{program.cohortId ? ` · Turno ${program.cohortId}` : ""}</p>
      <Link className="inline-block rounded-lg bg-primary px-4 py-2 text-primary-foreground" href={`/dashboard/${workspaceId}/learning/${program.id}`}>Apri percorso</Link>
    </CardContent></Card>)}</div>}
  </LearningShell>;
}

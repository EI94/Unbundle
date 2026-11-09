import { notFound } from "next/navigation";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadProgramPage } from "@/lib/db/queries/use-case-program";
import { PROGRAM_TEXT } from "@/lib/programma/text";
import { ProgramPage } from "@/components/programma/program-page";

export const metadata = { title: "Programma" };

/**
 * `/programma` (rilascio 7, docs/programma/RILASCIO-7-PROGETTO.md): la trasformazione AI-native del
 * workspace a colpo d'occhio, solo per i revisori (decisione 4), solo con l'area «Use case» accesa. Agli
 * altri «non trovata», come una pagina che non c'è. Senza la 0029 una riga: si sta preparando.
 */
export default async function ProgramRoute({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const read = await loadProgramPage({ workspace: access.workspace, user: session.user, role: access.role });
  if (read.status === "nessuno") notFound();
  if (read.status === "non_pronto") {
    return (
      <div className="flex-1 space-y-2 p-4 sm:p-6 lg:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{PROGRAM_TEXT.title}</h1>
        <p className="text-sm text-muted-foreground">{PROGRAM_TEXT.notReady}</p>
      </div>
    );
  }
  const apri = (await searchParams).apri;
  return <ProgramPage view={read.view} initialPanel={typeof apri === "string" ? apri : null} />;
}

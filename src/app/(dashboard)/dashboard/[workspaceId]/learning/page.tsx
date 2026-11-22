import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings2 } from "lucide-react";
import { getLearningHome, getLearningProgram } from "@/lib/learning/server";
import { getLearningAdminCatalog } from "@/lib/learning/admin";
import { nextLessonOf } from "@/lib/learning/course-view";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { LearningShell, LearningUnavailable } from "@/components/learning/learning-shell";
import { Button } from "@/components/ui/button";
import { Row, RowList } from "@/components/ui-10/row";

/**
 * L'ingresso della Formazione (rilascio 10, ondata 7a, docs/ui-10/PROPOSTA-10.md §3.9): chi segue un corso solo entra
 * diretto nel corso; con più corsi, una riga per corso, cliccabile per intero, con «Prossima lezione: lun 24 nov,
 * 14:30». Chi gestisce la formazione ha un solo «Gestisci», bordato: il registro si apre da lì. Niente codici del turno.
 */
export default async function LearningHome({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const T = LEARNING_TEXT.home;
  const home = await getLearningHome(workspaceId);
  if (!home.enabled) return <LearningShell workspaceId={workspaceId} title={T.title}><LearningUnavailable message={T.off} /></LearningShell>;
  const admin = await getLearningAdminCatalog(workspaceId);
  const manages = admin.canCreate || admin.canManage;
  const base = `/dashboard/${workspaceId}/learning`;
  // Un corso solo, e niente da gestire: si entra diretti nel corso (un 307: dipende dai corsi di chi guarda). È un 307
  // vero anche a pagina intera: l'attesa (`loading.tsx`) sta nelle cartelle sotto, non sopra questa pagina.
  if (!manages && home.programs.length === 1) redirect(`${base}/${home.programs[0].id}`);

  // La prossima lezione di ogni corso. Un corso che non si legge resta in elenco, senza la riga.
  const lessons = await Promise.all(home.programs.map(async (program) => {
    try {
      const detail = await getLearningProgram(workspaceId, program.id);
      return nextLessonOf({ ownSession: detail.ownSession, sessions: detail.sessions, canParticipate: detail.canParticipate, now: detail.now });
    } catch {
      return null;
    }
  }));

  const manage = manages && home.programs.length > 0
    ? <Button render={<Link href={`${base}/admin`} />} nativeButton={false} variant="outline" className="min-h-11 sm:min-h-9">
      <Settings2 aria-hidden data-icon="inline-start" />{T.manage}
    </Button>
    : null;

  return <LearningShell workspaceId={workspaceId} title={T.title} actions={manage}>
    {home.programs.length === 0
      ? <LearningUnavailable message={manages ? T.emptyManager : T.empty} action={manages ? { label: T.manage, href: `${base}/admin`, icon: Settings2, nextStep: true } : null} />
      : <RowList label={T.courses}>
        {home.programs.map((program, index) => <li key={program.id}>
          <Row title={program.title} fact={lessons[index] ? T.nextLesson(lessons[index]) : null} href={`${base}/${program.id}`} data-row="learning-course" />
        </li>)}
      </RowList>}
  </LearningShell>;
}

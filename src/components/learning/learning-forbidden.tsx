import { LearningError } from "@/lib/learning/server";
import { LEARNING_TEXT } from "@/lib/learning/text";
import { LearningShell, LearningUnavailable } from "./learning-shell";

/**
 * (Rilascio 10, ondata 7a) Una pagina della Formazione che questo account non può aprire: chi amministra il workspace
 * (exec_sponsor) ma non ha un permesso del corso, chi ha un permesso diverso da quello che la pagina chiede. Le letture
 * del server lanciano `forbidden` (getLearningResults, getLearningAdminDetail, getLearningReviewAttempt): prima la
 * pagina cadeva su «Questa pagina non si è caricata» con «Riprova» (in produzione l'errore 441 di React nella console), che non può
 * aiutare. Ora la spiegazione, nella cornice della Formazione, con il ritorno. I permessi non cambiano: chi non li ha
 * non vede niente del corso. Gli errori veri restano a `learning/error.tsx`.
 */
export function isLearningForbidden(error: unknown): boolean {
  return error instanceof LearningError && error.code === "forbidden";
}

export function LearningForbidden({ workspaceId, title, message }: { workspaceId: string; title: string; message: string }) {
  return <LearningShell workspaceId={workspaceId} title={title} back={{ href: `/dashboard/${workspaceId}/learning`, label: LEARNING_TEXT.backToLearning }}>
    <LearningUnavailable message={message} />
  </LearningShell>;
}

import { PageContainer } from "@/components/dashboard/page-container";
import { LEARNING_TEXT } from "@/lib/learning/text";

/**
 * (Rilascio 10, ondata 7a, PROPOSTA-10 §5.8) L'attesa di una pagina della Formazione: lo scheletro di un titolo e di due
 * blocchi, e la parola per i lettori di schermo (prima diceva «Apertura del corso…» anche per il registro, FO-21).
 *
 * Sta nelle cartelle sotto l'ingresso (`[programId]/`, `admin/`, `register/`), non in `learning/`: così l'ingresso non
 * è dentro un confine di attesa, e il suo redirect a un corso solo è un 307 vero, non un 200 con una «meta refresh».
 */
export function LearningLoading() {
  return <PageContainer className="space-y-6">
    <p role="status" className="sr-only">{LEARNING_TEXT.loading}</p>
    <div aria-hidden className="h-8 w-2/3 max-w-md animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
    <div aria-hidden className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    <div aria-hidden className="h-40 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
  </PageContainer>;
}

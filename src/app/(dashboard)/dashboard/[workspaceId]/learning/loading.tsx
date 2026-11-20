import { PageContainer } from "@/components/dashboard/page-container";
import { LEARNING_TEXT } from "@/lib/learning/text";

/**
 * (Rilascio 10, ondata 7a, PROPOSTA-10 §5.8) L'attesa di una pagina della Formazione: lo scheletro di un titolo e di due
 * blocchi, e la parola per i lettori di schermo. Vale per il corso, i risultati, Gestisci e il registro (prima diceva
 * «Apertura del corso…» anche per il registro, FO-21).
 */
export default function LoadingLearning() {
  return <PageContainer className="space-y-6">
    <p role="status" className="sr-only">{LEARNING_TEXT.loading}</p>
    <div aria-hidden className="h-8 w-2/3 max-w-md animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
    <div aria-hidden className="h-28 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    <div aria-hidden className="h-40 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
  </PageContainer>;
}

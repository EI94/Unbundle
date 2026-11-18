"use client";

import { PageLoadError } from "@/components/dashboard/page-load-error";

/** (Rilascio 10, §4) Le parole di ogni pagina che non si carica: «Questa pagina non si è caricata.» e «Riprova». */
export default function LearningErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  return <PageLoadError error={error} retry={retry} area="learning" />;
}

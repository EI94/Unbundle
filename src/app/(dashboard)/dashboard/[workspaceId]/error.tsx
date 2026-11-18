"use client";

import { PageLoadError } from "@/components/dashboard/page-load-error";

/**
 * (Ondata 0) Una pagina del workspace che non ha un `error.tsx` suo (Agent Factory, Impostazioni, Strategia, AI
 * Readiness, Panoramica…) non si è caricata: il riquadro sta dentro la cornice, barra laterale e barra in alto restano.
 * È anche la rete per le schede rimaste aperte dopo un rilascio.
 */
export default function WorkspacePageError({ error, retry }: { error: unknown; retry: () => void }) {
  return <PageLoadError error={error} retry={retry} area="workspace" />;
}

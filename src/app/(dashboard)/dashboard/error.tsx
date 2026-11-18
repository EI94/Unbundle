"use client";

import { PageLoadError } from "@/components/dashboard/page-load-error";

/**
 * (Ondata 0) «I tuoi workspace» non si è caricata, oppure la cornice di un workspace (il suo layout): il riquadro al
 * posto della pagina inglese di Next.
 */
export default function DashboardError({ error, retry }: { error: unknown; retry: () => void }) {
  return <PageLoadError error={error} retry={retry} area="dashboard" />;
}

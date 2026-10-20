import { ReferentShell } from "@/components/uc/referente/link-card";

/**
 * Caricamento della pagina del referente (DESIGN §3.14, P0-4): solo sagome
 * chiare, dentro `.survey-light`, e «Caricamento…» per i lettori di schermo.
 * Nessun dato della richiesta.
 */
export default function ReferentLinkLoading() {
  return (
    <ReferentShell>
      <div className="mt-4 space-y-4" aria-hidden>
        <div className="h-4 w-48 animate-pulse rounded bg-muted" />
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-20 w-full animate-pulse rounded-xl bg-muted" />
        <div className="h-14 w-full animate-pulse rounded-xl bg-muted" />
        <div className="h-14 w-full animate-pulse rounded-xl bg-muted" />
      </div>
      <p role="status" className="sr-only">
        Caricamento…
      </p>
    </ReferentShell>
  );
}

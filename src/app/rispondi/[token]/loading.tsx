import { PublicShell } from "@/components/use-cases/referent-public/state-card";
import { REFERENT_PUBLIC_EXTRA_TEXT } from "@/components/use-cases/referent-public/texts";

/** Caricamento della pagina del referente: solo sagome chiare e «Caricamento…» per i lettori di schermo. */
export default function ReferentAskLoading() {
  return (
    <PublicShell>
      <div className="mt-4 space-y-4" aria-hidden>
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 max-w-full animate-pulse rounded bg-muted" />
        <div className="h-24 w-full animate-pulse rounded-xl bg-muted" />
        <div className="h-40 w-full animate-pulse rounded-xl bg-muted" />
      </div>
      <p role="status" className="sr-only">
        {REFERENT_PUBLIC_EXTRA_TEXT.loading}
      </p>
    </PublicShell>
  );
}

import { loadReferentAskPage } from "@/lib/db/queries/use-case-referent-public";
import { romeDate } from "@/lib/uc/calendar";
import { ReferentAskPage } from "@/components/use-cases/referent-public/referent-ask-page";
import { stateCardKindOf } from "@/components/use-cases/referent-public/public-view-render";
import { StateScreen } from "@/components/use-cases/referent-public/state-card";

export const dynamic = "force-dynamic";

/**
 * La pagina del referente `/rispondi/[token]` (SPEC §4.1, §4.4): pubblica, senza account, pensata per
 * il telefono. Legge solo il token, mai la sessione: uguale da disconnessi e con qualsiasi ruolo, non
 * chiede di accedere e non rimanda altrove. Mai `notFound()`: un link sbagliato, revocato o scaduto e
 * la funzione spenta hanno ciascuno la sua scheda, resa qui con i metadati `noindex` del layout.
 * Solo letture: nessuna scrittura su GET, così prefetch e scanner dei link non lasciano tracce.
 */
export default async function ReferentAskRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const now = new Date();
  const page = await loadReferentAskPage(token, { env: process.env, now });
  if (page.access !== "ok") return <StateScreen kind={stateCardKindOf(page.access)} />;
  return <ReferentAskPage token={token} initialView={page.view} today={romeDate(now)} />;
}

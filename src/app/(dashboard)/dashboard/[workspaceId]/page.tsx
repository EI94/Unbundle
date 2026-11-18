import { Suspense } from "react";
import { HomeRoute } from "@/components/home/home-route";
import { HomeSkeleton } from "@/components/home/home-skeleton";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { HOME_TEXT } from "@/lib/home/text";

export const metadata = { title: HOME_TEXT.title };

/**
 * `/dashboard/<ws>`: la Home (rilascio 10, ondata 2b; docs/ui-10/PROPOSTA-10.md §2.3, §3.3). Prende il posto
 * dell'Overview: ai revisori il Programma con il prossimo passo del workspace e, in un workspace nuovo, «Per partire»
 * (il «Percorso» di prima); ai contributori «I tuoi use case». `?apri=` apre un pannello del Programma, come su
 * `/programma`, che resta come alias.
 *
 * È la pagina d'arrivo dopo il login: la Home si legge dentro un `Suspense` con il suo scheletro, così la cornice e lo
 * scheletro arrivano subito e la pagina non resta vuota mentre il Programma si legge. Lo scheletro sta qui e non in un
 * `loading.tsx` del workspace, che avvolgerebbe ogni pagina sotto `[workspaceId]`.
 */
export default async function WorkspaceHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  // Chi segue solo un corso va ai suoi corsi; chi non è nel workspace riceve «non trovata»: prima dello scheletro.
  const { session, access } = await requireWorkspacePage(workspaceId);
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeRoute session={session} access={access} searchParams={searchParams} />
    </Suspense>
  );
}

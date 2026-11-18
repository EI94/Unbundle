import { homePage } from "@/components/home/home-route";
import { HOME_TEXT } from "@/lib/home/text";

export const metadata = { title: HOME_TEXT.title };

/**
 * `/dashboard/<ws>`: la Home (rilascio 10, ondata 2b; docs/ui-10/PROPOSTA-10.md §2.3, §3.3). Prende il posto
 * dell'Overview: ai revisori il Programma con il prossimo passo del workspace e, in un workspace nuovo, «Per partire»
 * (il «Percorso» di prima); ai contributori «I tuoi use case». `?apri=` apre un pannello del Programma, come su
 * `/programma`, che resta come alias.
 */
export default async function WorkspaceHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  return homePage({ workspaceId, searchParams: await searchParams });
}

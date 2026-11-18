import { homePage } from "@/components/home/home-route";
import { HOME_TEXT } from "@/lib/home/text";

export const metadata = { title: HOME_TEXT.title };

/**
 * `/programma` (rilascio 7) è un alias della Home (rilascio 10, docs/ui-10/PROPOSTA-10.md §2.4 e §8.2): la stessa
 * pagina, con i suoi quattordici `?apri=` che aprono gli stessi pannelli (la campanella apre `?apri=rivedere`), e i
 * link, i segnalibri e le e-mail di prima continuano a funzionare. La barra laterale accende «Home».
 */
export default async function ProgramAliasPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  return homePage({ workspaceId, searchParams: await searchParams });
}

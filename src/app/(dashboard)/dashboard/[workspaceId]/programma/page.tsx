import { homePage } from "@/components/home/home-route";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { HOME_TEXT } from "@/lib/home/text";

export const metadata = { title: HOME_TEXT.title };

/**
 * `/programma` (rilascio 7) è un alias della Home (rilascio 10, docs/ui-10/PROPOSTA-10.md §2.4 e §8.2): la stessa
 * pagina, con i suoi `?apri=` che aprono gli stessi pannelli (la campanella apre `?apri=rivedere`; dall'ondata 6b i
 * quattordici pannelli sono dodici e `?apri=in-uso` e `?apri=formazione` aprono quello unito), e i link, i segnalibri e
 * le e-mail di prima continuano a funzionare. La barra laterale accende «Home».
 */
export default async function ProgramAliasPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  // Chi segue solo un corso va ai suoi corsi; chi non è nel workspace riceve «non trovata».
  const { session, access } = await requireWorkspacePage(workspaceId);
  return homePage({ session, access, searchParams: await searchParams });
}

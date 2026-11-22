import { notFound } from "next/navigation";
import { ProgramOverview } from "@/components/learning/program-overview";
import { joinArrival } from "@/lib/learning/join-arrival";
import { MODULE_PAGE_IDS } from "@/lib/learning/course-view";

/** La lezione. (Ondata 0) Arrivando da un link (`?joined=1&outcome=…`), una riga dice com'è andata l'iscrizione. */
export default async function ModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; programId: string; moduleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = await params;
  if (!MODULE_PAGE_IDS.includes(values.moduleId)) notFound();
  const sp = await searchParams;
  return <ProgramOverview {...values} arrival={joinArrival(sp.joined, sp.outcome)} />;
}

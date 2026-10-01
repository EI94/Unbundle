import { notFound } from "next/navigation";
import { ProgramOverview } from "@/components/learning/program-overview";
export default async function ModulePage({ params }: { params: Promise<{ workspaceId: string; programId: string; moduleId: string }> }) {
  const values = await params;
  if (!["m1", "m2", "m3"].includes(values.moduleId)) notFound();
  return <ProgramOverview {...values} />;
}

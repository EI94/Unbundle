import { ProgramOverview } from "@/components/learning/program-overview";
export default async function ProgramPage({ params }: { params: Promise<{ workspaceId: string; programId: string }> }) {
  return <ProgramOverview {...await params} />;
}

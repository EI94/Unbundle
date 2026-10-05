import { redirect } from "next/navigation";

/** La vista per l'aula ora vive in Risultati, sezione «Risultati di gruppo». */
export default async function LivePage({ params }: { params: Promise<{ workspaceId: string; programId: string }> }) {
  const { workspaceId, programId } = await params;
  redirect(`/dashboard/${encodeURIComponent(workspaceId)}/learning/${encodeURIComponent(programId)}/results?vista=gruppo`);
}

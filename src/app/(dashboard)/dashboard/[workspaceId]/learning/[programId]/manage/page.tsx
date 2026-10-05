import { redirect } from "next/navigation";

/** La vista nominativa ora vive in Risultati, sezione «Risultati individuali». */
export default async function ManagePage({ params }: { params: Promise<{ workspaceId: string; programId: string }> }) {
  const { workspaceId, programId } = await params;
  redirect(`/dashboard/${encodeURIComponent(workspaceId)}/learning/${encodeURIComponent(programId)}/results?vista=individuali`);
}

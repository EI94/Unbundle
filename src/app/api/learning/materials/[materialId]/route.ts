import { auth } from "@/lib/auth";
import { isPrefetchRequest } from "@/lib/http/prefetch";
import { contentDisposition } from "@/lib/learning/material-access";
import { readMaterialForDownload, recordMaterialDownload } from "@/lib/learning/materials";
import { LearningError } from "@/lib/learning/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(status: number, body: string) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * Download di un materiale del corso. Si serve solo a chi ha accesso al corso,
 * con le regole di materialAccess; "non esiste" e "non è per te" ricevono la
 * stessa risposta, così un identificativo non rivela nulla.
 */
export async function GET(request: Request, { params }: { params: Promise<{ materialId: string }> }) {
  const { materialId } = await params;
  if (!UUID.test(materialId)) return text(404, "Materiale non disponibile.");

  const session = await auth();
  if (!session?.user?.id) return text(401, "Accedi di nuovo dalla pagina del corso per scaricare il materiale.");

  let file: Awaited<ReturnType<typeof readMaterialForDownload>>;
  try {
    file = await readMaterialForDownload(materialId, session.user.id);
  } catch (error) {
    if (error instanceof LearningError && error.code === "closed") return text(403, error.message);
    return text(404, "Materiale non disponibile.");
  }

  if (!isPrefetchRequest(request)) {
    // Il conteggio non deve mai impedire il download.
    await recordMaterialDownload(materialId, session.user.id).catch((error) =>
      console.error("[learning-materials] registrazione download non riuscita", error)
    );
  }

  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.content.byteLength),
      "Content-Disposition": contentDisposition(file.fileName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

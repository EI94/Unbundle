import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadedDocuments } from "@/lib/db/schema";
import { put } from "@vercel/blob";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const workspaceId = formData.get("workspaceId") as string | null;
  const departmentId = formData.get("departmentId") as string | null;

  if (!file || !workspaceId) {
    return Response.json({ error: "File and workspaceId required" }, { status: 400 });
  }

  const maxSize = 20 * 1024 * 1024; // 20MB
  if (file.size > maxSize) {
    return Response.json({ error: "File troppo grande (max 20MB)" }, { status: 400 });
  }

  const allowedTypes = [
    "application/pdf",
    "text/plain",
    "text/csv",
    "text/markdown",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ];

  if (!allowedTypes.includes(file.type) && !file.type.startsWith("text/")) {
    return Response.json(
      { error: "Formato non supportato. Usa PDF, DOCX, XLSX, PPTX, TXT, CSV." },
      { status: 400 }
    );
  }

  try {
    const blob = await put(`documents/${workspaceId}/${file.name}`, file, {
      access: "public",
    });

    let extractedText = "";

    if (file.type === "text/plain" || file.type === "text/csv" || file.type === "text/markdown") {
      extractedText = await file.text();
    } else if (file.type === "application/pdf") {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const { text } = await generateText({
        model: anthropic("claude-sonnet-4-20250514"),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "file",
                data: base64,
                mediaType: "application/pdf",
              },
              {
                type: "text",
                text: "Estrai tutto il testo contenuto in questo documento PDF. Restituisci solo il testo estratto, senza commenti.",
              },
            ],
          },
        ],
      });
      extractedText = text;
    } else {
      extractedText = `[Documento ${file.type} — testo non estratto automaticamente]`;
    }

    let summary = "";
    if (extractedText && extractedText.length > 100) {
      const { text: summaryText } = await generateText({
        model: anthropic("claude-sonnet-4-20250514"),
        system:
          "Sei un analista organizzativo. Riassumi il documento in massimo 5 bullet point in italiano, " +
          "focalizzandoti su: struttura organizzativa, strategia, processi, metriche, obiettivi. " +
          "Se il documento non contiene informazioni rilevanti, dillo brevemente.",
        messages: [
          {
            role: "user",
            content: `Riassumi questo documento:\n\n${extractedText.slice(0, 15000)}`,
          },
        ],
      });
      summary = summaryText;
    }

    const [doc] = await db
      .insert(uploadedDocuments)
      .values({
        workspaceId,
        userId: session.user.id,
        departmentId: departmentId ?? undefined,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        blobUrl: blob.url,
        extractedText: extractedText.slice(0, 100000),
        summary,
      })
      .returning();

    return Response.json({
      id: doc.id,
      fileName: doc.fileName,
      summary: doc.summary,
      extractedText: extractedText.slice(0, 100000),
    });
  } catch (err) {
    console.error("Upload error:", err);
    return Response.json({ error: "Errore durante l'upload" }, { status: 500 });
  }
}

"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AdminDetailDTO } from "@/lib/learning/admin-contract";
import type { AdminMutate } from "./admin-program";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AdminSection, AdminSelect, ConfirmAdminAction } from "./admin-shared";

/**
 * Materiali del corso, dalla console. Tre domande per ogni file, perché sono le
 * tre che decidono se va bene in aula: a chi serve, quando, e se contiene le
 * soluzioni.
 */

const MAX_BYTES = 4_000_000;

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} byte`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

const timingLabel = (material: AdminDetailDTO["materials"][number]) =>
  material.audience === "trainers"
    ? "Solo formatori: i partecipanti non lo vedono"
    : material.downloadBefore
      ? "Da scaricare prima della lezione: in cima alla pagina del partecipante"
      : material.availableAfterSession
        ? "Si apre ai partecipanti a fine lezione"
        : "Sempre disponibile ai partecipanti";

export function AdminMaterials({ workspaceId, data, busy, mutate, onUploaded }: {
  workspaceId: string;
  data: AdminDetailDTO;
  busy: boolean;
  mutate: AdminMutate;
  onUploaded: () => Promise<void>;
}) {
  const scope = { workspaceId, programId: data.program.id };
  const modules = [...new Set(data.sessions.map((session) => session.moduleId))].sort();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [timing, setTiming] = useState<"before" | "always" | "after" | "trainers">("always");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  function choose(next: File | null) {
    setMessage(null);
    if (next && next.size > MAX_BYTES) {
      setMessage({ error: true, text: `«${next.name}» pesa ${sizeLabel(next.size)}: il limite è 4 MB. Comprimi il file o dividilo.` });
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setFile(next);
    if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !title.trim()) return;
    setUploading(true);
    setMessage(null);
    const form = new FormData();
    form.set("file", file);
    form.set("workspaceId", workspaceId);
    form.set("programId", data.program.id);
    form.set("expectedUserId", data.userId);
    form.set("title", title.trim());
    form.set("description", description.trim());
    form.set("moduleId", moduleId);
    form.set("kind", file.name.toLowerCase().endsWith(".zip") ? "exercise_files" : file.name.toLowerCase().endsWith(".pptx") ? "slides" : "document");
    form.set("audience", timing === "trainers" ? "trainers" : "learners");
    form.set("downloadBefore", String(timing === "before"));
    form.set("availableAfterSession", String(timing === "after"));
    try {
      const response = await fetch("/api/learning/materials", { method: "POST", body: form, credentials: "same-origin" });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !body?.ok) {
        setMessage({ error: true, text: body?.message ?? "Caricamento non riuscito. Riprova." });
        return;
      }
      setMessage({ error: false, text: `«${title.trim()}» caricato.` });
      setFile(null); setTitle(""); setDescription(""); setModuleId(""); setTiming("always");
      if (fileInput.current) fileInput.current.value = "";
      await onUploaded();
    } catch {
      setMessage({ error: true, text: "Connessione interrotta: il caricamento non è confermato. Controlla l'elenco prima di riprovare." });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <AdminSection title="Carica un materiale">
        <p className="text-sm">
          Cartelle di esercizi, slide, documenti. I partecipanti li scaricano dalla pagina del corso, sempre con il proprio
          accesso: i file non sono mai su un indirizzo pubblico.
        </p>
        <form onSubmit={upload}>
          <fieldset disabled={busy || uploading} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="material-file">File (fino a 4 MB)</Label>
              <Input id="material-file" ref={fileInput} type="file" accept=".zip,.pdf,.pptx,.docx,.xlsx,.csv,.txt,.md"
                onChange={(event) => choose(event.target.files?.[0] ?? null)} />
              {file && <p className="text-sm text-muted-foreground">{file.name} · {sizeLabel(file.size)}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="material-title">Nome che vedono i partecipanti</Label>
              <Input id="material-title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Es. Cartella degli esercizi" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="material-description">Istruzioni (facoltative)</Label>
              <Textarea id="material-description" value={description} maxLength={2000} rows={4}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={"Una riga per passo, es.\nScarica il file\nAprilo con un doppio clic\nTrascina la cartella sulla scrivania"} />
              <p className="text-xs text-muted-foreground">Ogni riga diventa un passo numerato sulla pagina del partecipante.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="material-module">Modulo</Label>
                <AdminSelect id="material-module" value={moduleId} onChange={(event) => setModuleId(event.target.value)}>
                  <option value="">Tutto il corso</option>
                  {modules.map((id) => <option key={id} value={id}>{id.toUpperCase()}</option>)}
                </AdminSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="material-timing">Quando e per chi</Label>
                <AdminSelect id="material-timing" value={timing} onChange={(event) => setTiming(event.target.value as typeof timing)}>
                  <option value="before">Da scaricare prima della lezione</option>
                  <option value="always">Sempre disponibile</option>
                  <option value="after">Solo a fine lezione (contiene le soluzioni)</option>
                  <option value="trainers">Solo formatori (note di regia)</option>
                </AdminSelect>
              </div>
            </div>
            <Button type="submit" disabled={!file || !title.trim()}>{uploading ? "Caricamento…" : "Carica"}</Button>
            {message && <p role={message.error ? "alert" : "status"} className={message.error ? "text-sm text-destructive" : "text-sm"}>{message.text}</p>}
          </fieldset>
        </form>
      </AdminSection>

      <AdminSection title={`Materiali del corso (${data.materials.length})`}>
        {data.materials.length === 0 && <p className="text-sm text-muted-foreground">Nessun materiale caricato.</p>}
        <ul className="space-y-3">
          {data.materials.map((material) => (
            <li key={material.id} className="space-y-2 rounded-lg border p-4">
              <div>
                <h3 className="font-medium">{material.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {material.fileName} · {sizeLabel(material.sizeBytes)} · {material.moduleId ? material.moduleId.toUpperCase() : "tutto il corso"}
                </p>
                <p className="mt-1 text-sm">{timingLabel(material)}</p>
                {material.audience === "learners" && (
                  <p className="text-sm text-muted-foreground" data-testid="material-downloads">
                    Scaricato da {material.downloads} {material.downloads === 1 ? "persona" : "persone"}
                    {material.enrolled > 0 ? ` su ${material.enrolled} iscritti` : ""}
                  </p>
                )}
              </div>
              <ConfirmAdminAction
                busy={busy}
                label="Elimina"
                description={`Eliminare «${material.title}»? I partecipanti non potranno più scaricarlo; chi l'ha già scaricato conserva la propria copia.`}
                onConfirm={() => mutate({ operation: "deleteMaterial", input: { ...scope, materialId: material.id } })}
              />
            </li>
          ))}
        </ul>
      </AdminSection>
    </div>
  );
}

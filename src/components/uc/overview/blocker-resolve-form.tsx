"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { resolveBlockerAction } from "@/lib/actions/uc-gates";
import { blockerFormFields, buildBlockerEvidence } from "@/lib/uc/views/privacy";
import { EvidenceFileSelect } from "./evidence-file-select";

/**
 * «Sciogli con le prove» nel pannello di un blocco (DESIGN §3.4, solo il
 * responsabile Lateral Space): file, data e descrizione, i campi che servono
 * a quel blocco. Le prove si controllano qui come sul server; il server
 * ricontrolla tutto. Riuscito lo scioglimento, il pannello si chiude.
 * La scheda privacy ha il suo modulo nella pagina Privacy.
 */
export function BlockerResolveForm({
  workspaceId,
  caseId,
  blockerId,
  blockerKey,
  files,
  closeHref,
}: {
  workspaceId: string;
  caseId: string;
  blockerId: string;
  blockerKey: string;
  files: readonly { id: string; name: string }[];
  closeHref: string;
}) {
  const router = useRouter();
  const { pending, run } = useUcAction();
  const fields = blockerFormFields(blockerKey);
  const [fileId, setFileId] = useState("");
  const [data, setData] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = `uc-blocker-${blockerId}`;
  return (
    <form
      className="space-y-3 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        const evidence = buildBlockerEvidence(blockerKey, { fileId, data, descrizione });
        if (!evidence.ok) {
          setError(evidence.message);
          return;
        }
        setError(null);
        run(() => resolveBlockerAction(workspaceId, caseId, { blockerId, evidence: evidence.value }), {
          success: "Blocco sciolto: le domande collegate senza altri blocchi tornano da chiedere.",
          onSuccess: () => router.push(closeHref, { scroll: false }),
        });
      }}
    >
      <h3 className="text-sm font-semibold">Sciogli con le prove</h3>
      {fields.file !== "no" && (
        <EvidenceFileSelect
          id={`${id}-file`}
          label={fields.file === "facoltativo" ? "File di prova (facoltativo)" : "File di prova"}
          files={files}
          value={fileId}
          onChange={setFileId}
          placeholder="Scegli il file"
        />
      )}
      {fields.data && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-date`}>Data della decisione o dell&apos;approvazione</Label>
          <Input id={`${id}-date`} type="date" value={data} onChange={(e) => setData(e.target.value)} className="h-11 w-48 text-base sm:h-8 sm:text-sm" />
        </div>
      )}
      {fields.descrizione !== "no" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-desc`}>Cosa è stato deciso o attivato{fields.descrizione === "facoltativa" ? " (facoltativo)" : ""}</Label>
          <Textarea id={`${id}-desc`} rows={3} maxLength={2000} value={descrizione} onChange={(e) => setDescrizione(e.target.value)} placeholder="Senza nomi di persone." />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-uc-rosso">
          {error}
        </p>
      )}
      <Button type="submit" className="h-11 sm:h-8" disabled={pending}>
        Sciogli il blocco
      </Button>
    </form>
  );
}

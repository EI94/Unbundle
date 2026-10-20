"use client";

import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { resolveBlockerAction } from "@/lib/actions/uc-gates";
import { buildA8Evidence, type A8FormInput } from "@/lib/uc/views/privacy";

const NO_FILE = "__nessuno__";

/**
 * «Registra la scheda privacy» (DESIGN §3.10; PIANO §3.5, §6.6), nel pannello
 * che apre il responsabile Lateral Space: documento, versione, data, ruoli che
 * l'hanno approvata (mai nomi), file firmato, titolo per usare i dati, regioni
 * dei dati verificate e chi di Lateral Space potrà entrare nella zona dei dati
 * personali. Registrare vale come firma del responsabile Lateral Space; poi
 * serve la firma dell'approvatore privacy sulla stessa scheda. Cambiare la
 * scheda annulla le firme date su quella di prima.
 *
 * L'etichetta del documento, «Scheda privacy (A.8)», è l'unico punto dove
 * compare la sigla: il modulo è solo per Lateral Space.
 */
export function A8Form({
  workspaceId,
  caseId,
  blockerId,
  initial,
  roles,
  files,
  lsMembers,
  correcting,
  onDone,
}: {
  workspaceId: string;
  caseId: string;
  blockerId: string;
  initial: A8FormInput;
  roles: readonly { key: string; label: string }[];
  files: readonly { id: string; name: string }[];
  lsMembers: readonly { userId: string; name: string }[];
  /** C'è già una scheda registrata: salvarne una diversa annulla le firme di prima. */
  correcting: boolean;
  onDone: () => void;
}) {
  const { pending, run } = useUcAction();
  const [f, setF] = useState<A8FormInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<A8FormInput>) => setF({ ...f, ...patch });
  const toggle = (list: readonly string[], v: string, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));
  const fileItems = [{ value: NO_FILE, label: "Scegli il file" }, ...files.map((x) => ({ value: x.id, label: x.name }))];

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const evidence = buildA8Evidence(f);
        if (!evidence.ok) {
          setError(evidence.message);
          return;
        }
        setError(null);
        run(() => resolveBlockerAction(workspaceId, caseId, { blockerId, evidence: evidence.value }), {
          success: "Scheda privacy registrata con la tua firma. Ora serve la firma dell'approvatore privacy.",
          onSuccess: onDone,
        });
      }}
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-3">
          <Label htmlFor="uc-a8-doc">Scheda privacy (A.8)</Label>
          <Input id="uc-a8-doc" value={f.documento} maxLength={500} onChange={(e) => set({ documento: e.target.value })} placeholder="Titolo del documento firmato" className="h-11 text-base sm:h-9 sm:text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="uc-a8-ver">Versione</Label>
          <Input id="uc-a8-ver" value={f.versione} maxLength={40} onChange={(e) => set({ versione: e.target.value })} placeholder="Es. 1.0" className="h-11 text-base sm:h-9 sm:text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="uc-a8-date">Approvata il</Label>
          <Input id="uc-a8-date" type="date" value={f.data} onChange={(e) => set({ data: e.target.value })} className="h-11 text-base sm:h-9 sm:text-sm" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="uc-a8-file">File della scheda firmata</Label>
          <Select items={fileItems} value={f.fileId || NO_FILE} onValueChange={(v) => set({ fileId: v && v !== NO_FILE ? String(v) : "" })}>
            <SelectTrigger id="uc-a8-file" className="min-h-11 w-full min-w-0 sm:min-h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fileItems.map((x) => (
                <SelectItem key={x.value} value={x.value}>
                  {x.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {files.length === 0 && <p className="text-xs text-muted-foreground">Carica prima la scheda firmata in Domande › Documenti.</p>}

      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-sm font-medium">Chi l&apos;ha approvata (ruoli, non nomi)</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {roles.map((r) => (
            <label key={r.key} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
              <input type="checkbox" className="size-4 shrink-0" checked={f.approvatori.includes(r.key)} onChange={(e) => set({ approvatori: toggle(f.approvatori, r.key, e.target.checked) })} />
              <span className="min-w-0 break-words">{r.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label className="flex min-h-11 items-start gap-2 text-sm sm:min-h-9">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={f.titolo} onChange={(e) => set({ titolo: e.target.checked })} />
          <span>C&apos;è il titolo scritto per usare i dati del cliente.</span>
        </label>
        <label className="flex min-h-11 items-start gap-2 text-sm sm:min-h-9">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={f.regione} onChange={(e) => set({ regione: e.target.checked })} />
          <span>La regione dei dati (database, file, funzioni) è verificata.</span>
        </label>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-sm font-medium">Chi di Lateral Space può entrare nella zona dei dati personali</legend>
        {lsMembers.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nessun membro di Lateral Space nel caso. Va bene anche nessuno.</p>
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {lsMembers.map((m) => (
              <label key={m.userId} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                <input type="checkbox" className="size-4 shrink-0" checked={f.accesso.includes(m.userId)} onChange={(e) => set({ accesso: toggle(f.accesso, m.userId, e.target.checked) })} />
                <span className="min-w-0 break-words">{m.name}</span>
              </label>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">L&apos;accesso vero si attiva dopo, persona per persona, con la firma dell&apos;approvatore privacy.</p>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-uc-rosso">
          {error}
        </p>
      )}
      {correcting && <p className="text-xs text-muted-foreground">Una scheda diversa annulla le firme date su quella di prima: servono di nuovo tutte e due.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} className="min-h-11 sm:min-h-8">
          <FileCheck2 aria-hidden />
          {correcting ? "Salva e firma di nuovo" : "Registra e firma"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-8" onClick={onDone}>
          Annulla
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshDossier } from "@/components/uc/shell/transition-retry";
import { DetailSheetFrame } from "@/components/uc/ui/detail-sheet";

/**
 * Import dei casi di prova da file («Prova sul passato», DESIGN §3.7.4, solo il
 * responsabile Lateral Space). Manda il file alla route handler
 * `…/test-cases/import` (non una server action: il file può superare 1 MB) e
 * mostra l'esito in linea.
 *
 * `importHref` lo calcola il server con `testCasesImportHref(workspaceId, caseId)`.
 * Errori e avvisi arrivano già senza il testo dei casi: riga, campo e motivo.
 */
export interface TestCasesImportProps {
  importHref: string;
  className?: string;
}

interface Issue {
  row?: number;
  field?: string;
  code: string;
  message: string;
}

type ImportState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; total: number; inserted: number; updated: number; unchanged: number; warnings: Issue[] }
  | { kind: "error"; message: string; errors: Issue[] };

const MAX_SHOWN = 10;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function IssueList({ issues, tone }: { issues: Issue[]; tone: "error" | "warning" }) {
  if (issues.length === 0) return null;
  return (
    <ul className={tone === "error" ? "list-disc space-y-1 pl-5 text-destructive" : "list-disc space-y-1 pl-5 text-muted-foreground"}>
      {issues.slice(0, MAX_SHOWN).map((issue, index) => (
        <li key={`${issue.row ?? 0}-${issue.field ?? ""}-${issue.code}-${index}`} className="break-words">
          {issue.message}
        </li>
      ))}
      {issues.length > MAX_SHOWN ? <li>E altri {issues.length - MAX_SHOWN}.</li> : null}
    </ul>
  );
}

export function TestCasesImport({ importHref, className }: TestCasesImportProps) {
  const router = useRouter();
  const inputId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ImportState>({ kind: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    if (!(file instanceof File) || file.size === 0) {
      setState({ kind: "error", message: "Scegli un file da importare.", errors: [] });
      return;
    }
    setState({ kind: "sending" });
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(importHref, { method: "POST", body, credentials: "same-origin", cache: "no-store" });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; data: { total: number; inserted: number; updated: number; unchanged: number; warnings: Issue[] } }
        | { ok: false; message?: string; errors?: Issue[] }
        | null;
      if (data && data.ok) {
        setState({ kind: "done", ...data.data });
        formRef.current?.reset();
        refreshDossier(router);
        return;
      }
      setState({ kind: "error", message: data?.message ?? "Import non riuscito. Riprova tra poco.", errors: data && !data.ok ? (data.errors ?? []) : [] });
    } catch {
      setState({ kind: "error", message: "Import non riuscito: controlla la connessione e riprova.", errors: [] });
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className={className}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={inputId} className="text-sm font-medium text-foreground">
            File dei casi di prova
          </label>
          <p className="text-xs break-words text-muted-foreground">
            File JSON o CSV in UTF-8, al massimo 2 MB. Colonne del CSV: key, kind, input, atteso, regole, covers, serve_per. Un caso con la stessa key si
            aggiorna. I casi pseudonimizzati si caricano solo dopo la scheda privacy. Niente nomi di persone né dati sanitari.
          </p>
          <input
            id={inputId}
            name="file"
            type="file"
            accept=".json,.csv,.tsv,.txt,application/json,text/csv"
            className="block w-full min-w-0 text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
          />
        </div>
        <div>
          <Button type="submit" disabled={state.kind === "sending"} className="min-h-11 sm:min-h-8">
            <FileUp aria-hidden />
            {state.kind === "sending" ? "Import in corso…" : "Importa"}
          </Button>
        </div>
        <div aria-live="polite" className="min-w-0 text-sm">
          {state.kind === "done" ? (
            <div className="flex flex-col gap-2">
              <p className="text-foreground">
                Fatto: {plural(state.inserted, "caso nuovo", "casi nuovi")}, {plural(state.updated, "aggiornato", "aggiornati")},{" "}
                {plural(state.unchanged, "uguale a prima", "uguali a prima")}.
              </p>
              {state.warnings.length > 0 ? (
                <>
                  <p className="text-muted-foreground">Da controllare:</p>
                  <IssueList issues={state.warnings} tone="warning" />
                </>
              ) : null}
            </div>
          ) : null}
          {state.kind === "error" ? (
            <div className="flex flex-col gap-2">
              <p className="break-words text-destructive">{state.message}</p>
              <IssueList issues={state.errors} tone="error" />
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
}

/**
 * «Importa» di «Prova sul passato»: un pulsante `outline` che apre il pannello
 * con il modulo, così la pagina resta una lista e il pulsante pieno sta nel
 * pannello (DESIGN §1, principio 2).
 */
export function TestCasesImportButton({ importHref }: { importHref: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="min-h-11 sm:min-h-8">
        <FileUp aria-hidden />
        Importa
      </Button>
      {open && (
        <DetailSheetFrame open onOpenChange={setOpen} title="Importa i casi di prova">
          <TestCasesImport importHref={importHref} />
        </DetailSheetFrame>
      )}
    </>
  );
}

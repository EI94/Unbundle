import { ChevronRight, Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EXPORT_FORMAT_LABELS, catalogExportHref, exportChoices, type ExportFormat } from "@/lib/uc/export/request";
import { isLsViewer } from "@/lib/uc/views/status-groups";
import type { CaseRole } from "@/lib/uc/vocab";

/**
 * «Esporta…» del dossier (DESIGN §3.13.1), nel pannello del menu «⋯»:
 * - responsabile del cliente: «Scarica in Excel», dopo il via il catalogo
 *   validato, prima la bozza di lavoro;
 * - Lateral Space: la stessa cosa, più «Per gli sviluppatori ▸» con JSON e
 *   Markdown e, dopo il via, anche la bozza;
 * - sviluppatore: solo il catalogo validato.
 * Chi può scaricare cosa lo decide `exportChoices` (dopo il via la bozza solo
 * Lateral Space); la nota «Ogni download resta in Attività» la mette il pannello.
 *
 * Sono `<a download>` nativi, mai `<Link>` di Next: la route scrive un evento di
 * attività a ogni download e un prefetch non deve farla scattare. Componente
 * server, senza stato: `roles` sono i ruoli che valgono adesso
 * (`caseAccess.roles`), `latestVersion` è `uc_cases.catalog_version` (0 =
 * nessuna versione congelata).
 */
export interface CatalogExportLinksProps {
  workspaceId: string;
  caseId: string;
  roles: readonly CaseRole[];
  latestVersion: number;
  className?: string;
}

const DEV_FORMATS: readonly ExportFormat[] = ["json", "md"];

function FormatLinks({ formats, hrefFor }: { formats: readonly ExportFormat[]; hrefFor: (format: ExportFormat) => string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {formats.map((format) => (
        <a key={format} href={hrefFor(format)} download className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 sm:min-h-8")}>
          <Download aria-hidden />
          {EXPORT_FORMAT_LABELS[format]}
        </a>
      ))}
    </div>
  );
}

export function CatalogExportLinks({ workspaceId, caseId, roles, latestVersion, className }: CatalogExportLinksProps) {
  const choices = exportChoices(roles, latestVersion);
  if (!choices.validated && !choices.draft) return null;
  const ls = isLsViewer(roles);
  const main: number | "bozza" = choices.validated ? latestVersion : "bozza";
  const href = (version: number | "bozza") => (format: ExportFormat) => catalogExportHref(workspaceId, caseId, { format, version });
  const extraDraft = choices.validated && choices.draft;

  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      {!choices.validated && <p className="text-sm break-words text-muted-foreground">Il catalogo validato si scarica dopo il via allo sviluppo.</p>}
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-sm font-medium text-foreground">{choices.validated ? `Catalogo validato v${latestVersion}` : "Bozza di lavoro"}</p>
        <p className="text-xs break-words text-muted-foreground">
          {choices.validated ? "Congelato al via allo sviluppo: è quello su cui si sviluppa." : "Tutte le domande di oggi. Quelle non ancora a posto escono segnate «non validata»."}
        </p>
        <a href={href(main)("xlsx")} download className={cn(buttonVariants(), "mt-1 min-h-11 self-start sm:min-h-8")}>
          <Download aria-hidden />
          Scarica in Excel
        </a>
      </div>

      {ls && (
        <details className="group min-w-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium select-none sm:min-h-9 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
            Per gli sviluppatori
          </summary>
          <div className="mt-2 space-y-4 pl-5.5">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{choices.validated ? `Catalogo validato v${latestVersion}` : "Bozza di lavoro"}</p>
              <FormatLinks formats={DEV_FORMATS} hrefFor={href(main)} />
            </div>
            {extraDraft && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Bozza di lavoro: tutte le domande di oggi, quelle non a posto segnate «non validata».</p>
                <FormatLinks formats={["xlsx", ...DEV_FORMATS]} hrefFor={href("bozza")} />
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

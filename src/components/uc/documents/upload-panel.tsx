import { unstable_rethrow } from "next/navigation";
import { Lock, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { findDossierAccess } from "@/components/uc/shell/case-data";
import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { loadUploadPanel, type UploadPanelData } from "@/lib/db/queries/uc-files";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import type { StorageZone } from "@/lib/uc/vocab";
import { FileManagement } from "./file-management";
import { UploadPanelClient } from "./upload-panel-client";

/**
 * Pannello di caricamento dei documenti del caso (vista Lateral Space, PIANO
 * §5.1, §6): carica un file nel caso o nella voce (quarantena, controllo del
 * contenuto e delle intestazioni, rifiuto e cancellazione dei dati sanitari),
 * rivede i PDF in attesa (mai chi li ha caricati), crea e verifica le schede
 * dataset, cancella i file non più utili (Responsabile del caso).
 *
 * Componente server: ricontrolla l'accesso (workspace e ruoli di caso che
 * valgono adesso) e legge solo metadati. La zona della voce la decide il
 * server dalla classe privacy (`zone` resta un suggerimento per chi lo usa).
 */
export interface UploadPanelProps {
  workspaceId: string;
  caseId: string;
  /** Voce a cui si collega il file; null = documento del caso. */
  itemId?: string | null;
  zone?: StorageZone;
  canUpload?: boolean;
  /** Suggerimento del template su cosa caricare. */
  hint?: string | null;
}

function Unavailable({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm">
      <Upload className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 break-words text-muted-foreground">{text}</p>
    </div>
  );
}

async function loadPanel(props: UploadPanelProps): Promise<UploadPanelData | null> {
  const { session, access } = await requireWorkspaceAccess(props.workspaceId);
  // La stessa lettura della pagina (accesso e testata), già fatta nella stessa richiesta.
  const caseAccess = await findDossierAccess({ workspaceId: props.workspaceId, caseId: props.caseId, userId: session.user.id, workspaceRole: access.role });
  if (!caseAccess) return null;
  const executor = await getAppUcExecutor();
  return loadUploadPanel(
    executor,
    {
      workspaceId: props.workspaceId,
      caseId: caseAccess.caseId,
      itemId: props.itemId ?? null,
      userId: caseAccess.user.userId,
      roles: caseAccess.roles,
      isLateralSpace: caseAccess.user.isLateralSpace,
      readOnly: caseAccess.readOnly,
    },
    process.env,
  );
}

export async function UploadPanel(props: UploadPanelProps) {
  if (props.canUpload === false) return null;
  let data: UploadPanelData | null;
  try {
    data = await loadPanel(props);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[uc-files] pannello di caricamento non disponibile", error instanceof Error ? error.name : "errore");
    return <Unavailable text="Il caricamento dei file non è disponibile in questo momento. Riprova tra poco." />;
  }
  if (!data) return null;
  const { target } = data;

  return (
    <section aria-label="Carica un file" className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-3 sm:p-4">
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <Upload className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">{target.itemId ? "Carica un file per questa domanda" : "Carica un documento del caso"}</h3>
        {target.zone === "personale" ? (
          <Badge variant="outline" className="border-uc-lucchetto/40 text-uc-lucchetto">
            <Lock aria-hidden />
            Zona personale
          </Badge>
        ) : null}
      </header>
      {props.hint ? <p className="text-sm break-words text-muted-foreground">Cosa caricare: {props.hint}</p> : null}

      {data.upload.allowed ? (
        <UploadPanelClient
          workspaceId={props.workspaceId}
          caseId={props.caseId}
          itemId={target.itemId}
          personal={target.zone === "personale"}
          clientMode={data.upload.clientMode}
        />
      ) : (
        <Unavailable text={data.upload.reason ?? "Qui non puoi caricare file."} />
      )}

      {data.canManage ? <FileManagement workspaceId={props.workspaceId} caseId={props.caseId} data={data} /> : null}
    </section>
  );
}

import Link from "next/link";
import { cn } from "@/lib/utils";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/uc/semaforo";
import type { ItemStatus } from "@/lib/uc/vocab";
import { itemPath } from "./paths";

/** Etichetta dello stato per il suggerimento e i lettori di schermo. */
function statusText(status: ItemStatus | null): string {
  return status ? STATUS_LABEL[status] : "Non è nel catalogo";
}

/**
 * Voce collegata: puntino dello stato e titolo (DESIGN §1, «titoli, mai
 * codici»). La chiave compare solo con `showKey` (per Lateral Space, dentro
 * «Dettagli tecnici»), oppure al posto di un titolo che manca. È un
 * collegamento al dettaglio solo se chi guarda lo può aprire.
 */
export function ItemLink({
  workspaceId,
  caseId,
  item,
  canOpen,
  showTitle = true,
  showKey = false,
  className,
}: {
  workspaceId: string;
  caseId: string;
  item: { id: string | null; key: string; title?: string | null; status: ItemStatus | null };
  canOpen: boolean;
  showTitle?: boolean;
  showKey?: boolean;
  className?: string;
}) {
  const tone = item.status ? SEMAFORO_TONE[STATUS_COLOR[item.status]] : null;
  const title = showTitle && item.title && item.title !== item.key ? item.title : null;
  const keyShown = showKey || !title;
  const body = (
    <>
      <span
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", tone ? tone.fill : "border border-dashed border-muted-foreground")}
        title={statusText(item.status)}
        aria-hidden
      />
      <span className="min-w-0">
        {title && <span className="block break-words">{title}</span>}
        {keyShown && <span className="block font-mono text-xs break-all text-muted-foreground">{item.key}</span>}
        <span className="sr-only">Stato: {statusText(item.status)}</span>
      </span>
    </>
  );
  const base = cn("flex min-w-0 items-start gap-2 rounded-md py-1 text-sm", className);
  if (canOpen && item.id) {
    return (
      <Link href={itemPath(workspaceId, caseId, item.id)} className={cn(base, "-mx-1 px-1 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none")}>
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}

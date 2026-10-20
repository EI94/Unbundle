import Link from "next/link";
import { itemPath } from "@/components/uc/catalog/paths";
import { SEMAFORO_TONE } from "@/components/uc/common/semaforo-tone";
import { TechDetails } from "@/components/uc/ui/tech-details";
import { cn } from "@/lib/utils";
import { MAP_NO_ITEMS, MAP_TONE_COLOR, mapLegend, mapTone, mapToneLabel, type MapItemRef, type MapTone } from "@/lib/uc/views/map";
import { statusView, type Audience } from "@/lib/uc/views/status-groups";
import type { CaseRole } from "@/lib/uc/vocab";

/**
 * Pezzi comuni della Mappa (DESIGN §3.7.2): la legenda in tre toni più
 * «nessuna domanda collegata» tratteggiato, il puntino di un passo o di una
 * domanda e le domande di un passo, con il titolo (mai la chiave).
 */

/** Il puntino di un tono; tratteggiato senza tono. */
export function ToneDot({ tone, className }: { tone: MapTone | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", tone ? SEMAFORO_TONE[MAP_TONE_COLOR[tone]].fill : "border border-dashed border-muted-foreground", className)}
    />
  );
}

/** La legenda dei colori della mappa. */
export function MapLegend({ audience, className }: { audience: Audience; className?: string }) {
  return (
    <ul aria-label="Legenda dei colori" className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {mapLegend(audience).map((l) => (
        <li key={l.label} className="inline-flex items-center gap-1.5">
          <ToneDot tone={l.tone} />
          {l.label}
        </li>
      ))}
    </ul>
  );
}

/** Testo per i lettori di schermo e il suggerimento: lo stato di una domanda, o che non è nel catalogo. */
export function itemStatusText(item: Pick<MapItemRef, "status">, audience: Audience): string {
  return item.status ? statusView(item.status, audience).label : "Non è una domanda del catalogo";
}

/** Il tono di un passo come testo (per i lettori di schermo). */
export function stepToneText(tone: MapTone | null, audience: Audience): string {
  return tone ? mapToneLabel(tone, audience) : MAP_NO_ITEMS;
}

/** Una domanda di un passo: puntino del tono e titolo; un link se chi guarda la può aprire. */
export function StepItem({ workspaceId, caseId, item, audience }: { workspaceId: string; caseId: string; item: MapItemRef; audience: Audience }) {
  const status = itemStatusText(item, audience);
  const hint = [item.title, status, audience === "ls" ? item.owner : null].filter(Boolean).join(" · ");
  const body = (
    <>
      <ToneDot tone={mapTone(item.status)} />
      <span className="min-w-0 break-words">{item.title}</span>
      <span className="sr-only">, {status}</span>
    </>
  );
  const cls = "inline-flex min-h-8 max-w-full min-w-0 items-center gap-1.5 rounded-md text-sm";
  if (item.canOpen && item.id) {
    return (
      <Link href={itemPath(workspaceId, caseId, item.id)} title={hint} className={cn(cls, "underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none")}>
        {body}
      </Link>
    );
  }
  return (
    <span title={hint} className={cls}>
      {body}
    </span>
  );
}

/**
 * Le domande di un passo e i dati citati in parole, in linea. I riferimenti
 * fuori dal catalogo sono chiavi: non stanno nella riga, per nessuno
 * (`StepKeysDetails` li mostra a Lateral Space).
 */
export function StepItems({ workspaceId, caseId, items, otherData = [], audience }: { workspaceId: string; caseId: string; items: readonly MapItemRef[]; otherData?: readonly string[]; audience: Audience }) {
  const shown = items.filter((i) => i.status !== null);
  if (shown.length === 0 && otherData.length === 0) return null;
  return (
    <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-0.5" aria-label="Domande collegate">
      {shown.map((it) => (
        <li key={it.key} className="max-w-full shrink-0">
          <StepItem workspaceId={workspaceId} caseId={caseId} item={it} audience={audience} />
        </li>
      ))}
      {otherData.map((d) => (
        <li key={`dato-${d}`} className="inline-flex min-h-8 max-w-full shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
          <ToneDot tone={null} />
          <span className="min-w-0 break-words">{d}</span>
        </li>
      ))}
    </ul>
  );
}

const TONE_BORDER: Readonly<Record<MapTone, string>> = { a_posto: "border-uc-verde", da_verificare: "border-uc-giallo", da_fare: "border-uc-grigio" };

/** Il numero del passo, con il bordo del colore del suo tono (tratteggiato se non ha domande). */
export function StepNumber({ n, tone, audience }: { n: number; tone: MapTone | null; audience: Audience }) {
  return (
    <span
      title={stepToneText(tone, audience)}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-medium tabular-nums",
        tone ? TONE_BORDER[tone] : "border-dashed border-muted-foreground/70",
      )}
    >
      {n}
      <span className="sr-only">, {stepToneText(tone, audience)}</span>
    </span>
  );
}

/**
 * Le chiavi citate dai passi senza un titolo da mostrare (`stepTechKeys`),
 * nei «Dettagli tecnici»: solo Lateral Space, chiusi; niente se non ce ne sono.
 */
export function StepKeysDetails({ roles, steps, className }: { roles: readonly CaseRole[]; steps: readonly { n: number | null; label: string; keys: readonly string[] }[]; className?: string }) {
  const shown = steps.filter((s) => s.keys.length > 0);
  if (shown.length === 0) return null;
  return (
    <TechDetails roles={roles} className={className}>
      <p className="font-sans">Chiavi citate senza un titolo da mostrare</p>
      <ul className="space-y-1">
        {shown.map((s) => (
          <li key={`${s.n ?? ""}-${s.label}`}>
            <span className="font-sans">{s.n !== null ? `Passo ${s.n} · ${s.label}` : s.label}: </span>
            {s.keys.join(", ")}
          </li>
        ))}
      </ul>
    </TechDetails>
  );
}

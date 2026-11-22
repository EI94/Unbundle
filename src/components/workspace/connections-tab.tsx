"use client";

import type { ReactNode } from "react";
import { Cable, KeyRound, MessageCircle, MessageSquare, type LucideIcon } from "lucide-react";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { SideSheet, useSheetParam } from "@/components/ui-10/side-sheet";
import { Button } from "@/components/ui/button";
import type { SemaforoColor } from "@/lib/uc/vocab";
import { SETTINGS_TEXT } from "./settings-text";

const T = SETTINGS_TEXT.links;

/** Le righe della scheda «Collegamenti», nell'ordine; ognuna apre il suo pannello (`?apri=<chiave>`). */
export const CONNECTION_KEYS = Object.freeze(["slack", "organizzazione", "accessi", "avvisi"] as const);
export type ConnectionKey = (typeof CONNECTION_KEYS)[number];

const ICON: Readonly<Record<ConnectionKey, LucideIcon>> = { slack: MessageSquare, organizzazione: Cable, accessi: KeyRound, avvisi: MessageCircle };

/** Una riga: icona · nome · stato in una parola · un pulsante bordato (o nessuno, a chi non può fare niente). */
export interface ConnectionRowView {
  key: ConnectionKey;
  name: string;
  state: { tone: SemaforoColor; label: string } | null;
  /** Una riga grigia sotto il nome, facoltativa. */
  fact?: string | null;
  /** `panel`: apre il pannello; `slack`: comincia il collegamento con Slack. */
  action: { kind: "panel" | "slack"; label: string } | null;
}

const acceptOf = (keys: readonly ConnectionKey[]) => (raw: string | null) => (raw && (keys as readonly string[]).includes(raw) ? (raw as ConnectionKey) : null);
const ACCEPT_CACHE = new Map<string, (raw: string | null) => ConnectionKey | null>();
/** La stessa funzione per le stesse chiavi: `useSheetParam` la vuole stabile. */
function acceptFor(keys: readonly ConnectionKey[]) {
  const id = keys.join("|");
  let accept = ACCEPT_CACHE.get(id);
  if (!accept) {
    accept = acceptOf(keys);
    ACCEPT_CACHE.set(id, accept);
  }
  return accept;
}

/**
 * Impostazioni › Collegamenti (rilascio 10, ondata 6b, docs/ui-10/PROPOSTA-10.md §3.10): una riga per servizio, e i
 * dettagli in un pannello con il suo indirizzo. Slack; Claude per l'organizzazione (il connettore, con configurazione e
 * limiti in «Dettagli tecnici»); gli accessi del team e delle realizzazioni con «Revoca tutti»; «Altri avvisi»
 * (WhatsApp). Solo le righe che chi guarda può usare: le monta la pagina. Gli accessi personali (Claude e il terminale)
 * e Granola stanno in «Il tuo account».
 */
export function ConnectionsTab({
  workspaceId,
  rows,
  panels,
  banner,
  initialPanel,
}: {
  workspaceId: string;
  rows: readonly ConnectionRowView[];
  /** Il contenuto dei pannelli, reso sul server. */
  panels: Partial<Record<ConnectionKey, ReactNode>>;
  /** L'esito del ritorno da Slack, sopra le righe. */
  banner?: ReactNode;
  initialPanel: string | null;
}) {
  const keys = rows.filter((r) => r.action?.kind === "panel" && panels[r.key] !== undefined).map((r) => r.key);
  const [panel, setPanel] = useSheetParam<ConnectionKey>({ initial: initialPanel, accept: acceptFor(keys) });
  const open = panel ? rows.find((r) => r.key === panel) ?? null : null;
  return (
    <div id="integrazioni" className="scroll-mt-28 space-y-4" data-slot="settings-links">
      {banner}
      <ul aria-label={T.label} className="divide-y overflow-hidden rounded-xl border bg-card">
        {rows.map((row) => {
          const Icon = ICON[row.key];
          return (
            <li key={row.key} id={row.key === "organizzazione" ? "connettore-claude" : undefined} data-connection={row.key} className="flex min-h-11 flex-wrap items-center gap-3 px-4 py-3 sm:min-h-14 sm:flex-nowrap">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium break-words">{row.name}</span>
                {row.fact ? <span className="block text-xs break-words text-muted-foreground">{row.fact}</span> : null}
              </span>
              {row.state ? <StatusDot tone={row.state.tone} label={row.state.label} size="md" className="shrink-0" /> : null}
              {row.action?.kind === "panel" && panels[row.key] !== undefined ? (
                <Button type="button" variant="outline" className="min-h-11 shrink-0 sm:min-h-9" aria-haspopup="dialog" aria-label={`${row.action.label}: ${row.name}`} onClick={() => setPanel(row.key)}>
                  {row.action.label}
                </Button>
              ) : row.action?.kind === "slack" ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0 sm:min-h-9"
                  aria-label={`${row.action.label}: ${row.name}`}
                  onClick={() => {
                    // Una rotta API, non una pagina: risponde con il redirect all'OAuth di Slack, che il router di Next non può seguire.
                    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- navigazione intera verso /api/slack/install
                    window.location.href = `/api/slack/install?workspaceId=${workspaceId}`;
                  }}
                >
                  {row.action.label}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <SideSheet open={open !== null} onClose={() => setPanel(null)} title={open?.name ?? ""}>
        {open ? panels[open.key] : null}
      </SideSheet>
    </div>
  );
}

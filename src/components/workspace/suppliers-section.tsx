"use client";

import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { StatusDot } from "@/components/uc/ui/status-dot";
import { TextAction } from "@/components/ui-10/row";
import { SideSheet, useSheetParam } from "@/components/ui-10/side-sheet";
import { Button } from "@/components/ui/button";
import { SETTINGS_TEXT } from "./settings-text";

const T = SETTINGS_TEXT.privacy;

/** Il pannello dei fornitori (`?apri=fornitori`). */
export const SUPPLIERS_PANEL = "fornitori";
const acceptSuppliers = (raw: string | null) => (raw === SUPPLIERS_PANEL || raw === "sub-responsabili" ? SUPPLIERS_PANEL : null);

/**
 * Privacy › «Fornitori dei dati» (rilascio 10, ondata 6b, docs/ui-10/PROPOSTA-10.md §3.10; prima «Sub-responsabili»):
 * una riga con lo stato (puntino più parola), e il pannello con il testo legale intero, l'elenco dei fornitori e, a chi
 * può darlo, l'ok (`children`, reso sul server). Al cliente che autorizza il pulsante è pieno: è il passo della scheda;
 * a Lateral Space, che registra l'ok per conto del cliente, è bordato; agli altri «Leggi il testo». L'ancora
 * `#sub-responsabili` resta su questa sezione.
 */
export function SuppliersSection({
  summary,
  action,
  initialPanel,
  children,
}: {
  summary: { tone: "verde" | "giallo"; label: string };
  /** Chi può dare l'ok: il verbo del pulsante e se è il passo della scheda (pieno). */
  action: { label: string; filled: boolean } | null;
  initialPanel: string | null;
  /** Il contenuto del pannello, reso sul server. */
  children?: ReactNode;
}) {
  const [panel, setPanel] = useSheetParam<string>({ initial: initialPanel, accept: acceptSuppliers });
  return (
    <section id="sub-responsabili" aria-labelledby="fornitori-titolo" className="scroll-mt-28 space-y-3" data-slot="settings-suppliers">
      <h2 id="fornitori-titolo" className="flex items-center gap-2 text-base font-semibold">
        <ShieldCheck aria-hidden className="size-4 text-muted-foreground" />
        {T.suppliers}
      </h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <StatusDot tone={summary.tone} label={summary.label} size="md" />
        {action ? (
          <Button type="button" variant={action.filled ? "default" : "outline"} className="min-h-11 sm:min-h-9" aria-haspopup="dialog" onClick={() => setPanel(SUPPLIERS_PANEL)}>
            {action.label}
          </Button>
        ) : (
          <TextAction onClick={() => setPanel(SUPPLIERS_PANEL)} opensPanel>
            {T.read}
          </TextAction>
        )}
      </div>
      <SideSheet open={panel === SUPPLIERS_PANEL} onClose={() => setPanel(null)} title={T.suppliersPanel}>
        {children}
      </SideSheet>
    </section>
  );
}

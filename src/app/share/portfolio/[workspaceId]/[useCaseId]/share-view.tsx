import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PublicShell } from "@/components/public/public-shell";
import { PublicStateCard } from "@/components/public/state-card";
import { PhasePill } from "@/components/use-cases/phase-pill";
import { SHARE_PAGE_TEXT } from "@/lib/use-cases/share-page";
import type { Phase, SubState } from "@/lib/use-cases/types";

/**
 * (Rilascio 10, §3.4, §3.11) Le viste della pagina pubblica del link di condivisione: tema chiaro (`.survey-light`),
 * il marchio piccolo in alto, una colonna; il pulsante principale a tutta larghezza, alto 48 px. Nessun dato oltre a
 * quelli che la pagina passa già ridotti (D14). Senza stato: si rendono sul server.
 *
 * (Rilascio 10, ondata 4) Dentro il guscio unico delle pagine pubbliche (`src/components/public/`): lo stesso marchio, la
 * stessa scheda del link che non vale. La radice chiara resta qui e non in un layout: la pagina si rende anche da sola
 * (le prove d'integrazione) e deve restare chiara.
 */
export function ShareShell({ children }: { children: ReactNode }) {
  return (
    <div data-slot="share-page" className="survey-light min-h-dvh w-full min-w-0 overflow-x-clip bg-background text-foreground">
      <PublicShell>
        <div className="mt-8 space-y-4">{children}</div>
      </PublicShell>
    </div>
  );
}

export interface ShareCaseProps {
  /** Il titolo del caso d'uso; null per una scheda nascosta alla ricerca, che mostra solo la fase. */
  title: string | null;
  /** La pillola: la fase, con il sotto-stato fuori da «Approvato» (che ha «Quando» a parte). */
  phaseText: string;
  phase: Phase;
  subState?: SubState | null;
  /** «T1 2027», «Più avanti»: solo per un caso d'uso approvato e non nascosto. */
  quando: string | null;
  loginHref: string;
  /** «Il link vale 30 giorni: fino al 19 dicembre.» */
  validity: string;
}

/** Il caso d'uso del link: l'H1 è il suo titolo; sotto la fase e «Quando»; «Accedi per aprire la scheda»; la scadenza. */
export function ShareCase({ title, phaseText, phase, subState = null, quando, loginHref, validity }: ShareCaseProps) {
  return (
    <ShareShell>
      <h1 className="text-2xl font-semibold tracking-tight break-words">{title ?? SHARE_PAGE_TEXT.title}</h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-2">
          <span className="sr-only">{SHARE_PAGE_TEXT.phase}</span>
          <PhasePill label={phaseText} phase={phase} subState={subState} size="md" />
        </span>
        {quando ? (
          <span>
            <span className="text-muted-foreground">{SHARE_PAGE_TEXT.when}</span> <span className="font-medium">{quando}</span>
          </span>
        ) : null}
      </div>
      <div className="space-y-3 pt-2">
        <Button render={<Link href={loginHref} />} nativeButton={false} className="h-12 w-full text-base">
          {SHARE_PAGE_TEXT.login}
        </Button>
        <p className="text-sm text-muted-foreground">{validity}</p>
      </div>
    </ShareShell>
  );
}

/**
 * Il link che non vale (disattivato, copiato in parte, scaduto): la stessa scheda per ogni motivo, una frase sola, e
 * «Accedi a Unbundle». Chi ha il link non sa se è scaduto o se il team l'ha tolto.
 */
export function ShareInvalid({ loginHref }: { loginHref: string }) {
  return (
    <div data-slot="share-page" className="survey-light min-h-dvh w-full min-w-0 overflow-x-clip bg-background text-foreground">
      <PublicShell>
        <PublicStateCard kind="link" body={SHARE_PAGE_TEXT.invalidBody}>
          <div className="mt-5">
            <Button render={<Link href={loginHref} />} nativeButton={false} className="h-12 w-full text-base">
              {SHARE_PAGE_TEXT.invalidLogin}
            </Button>
          </div>
        </PublicStateCard>
      </PublicShell>
    </div>
  );
}

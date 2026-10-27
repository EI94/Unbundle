"use client";

import { Button } from "@/components/ui/button";
import { Disclosure, Notice, PRIMARY_CLASS } from "@/components/uc/referente/screen";
import { ActionBar } from "@/components/uc/referente/step-bar";

/**
 * «Prima di iniziare» (SPEC §4.4 punto 3, §5.3): l'informativa a due livelli. Tre punti da sapere, il
 * testo completo in un riquadro chiuso e «Ho letto, iniziamo», fisso in basso al telefono. Finché non
 * lo preme, il referente non vede domande, bozze o caricamenti. Dopo, l'informativa resta nel piè di
 * pagina («Come usiamo le tue risposte»).
 */

export interface PrivacyTexts {
  title: string;
  lead: string;
  summary: string[];
  fullTextLabel: string;
  paragraphs: string[];
  button: string;
  footerLabel: string;
}

export const PRIVACY_TITLE_ID = "ucq-informativa";

export function PrivacyCard({ texts, busy, error, onAccept }: { texts: PrivacyTexts; busy: boolean; error: string | null; onAccept: () => void }) {
  return (
    <section aria-labelledby={PRIVACY_TITLE_ID} className="mt-6 space-y-5 rounded-xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
      <h2 id={PRIVACY_TITLE_ID} tabIndex={-1} className="text-xl leading-7 font-semibold break-words outline-none">
        {texts.title}
      </h2>
      <p className="text-base">{texts.lead}</p>
      <ul className="list-disc space-y-3 pl-5 text-base leading-6">
        {texts.summary.map((s) => (
          <li key={s} className="break-words">
            {s}
          </li>
        ))}
      </ul>
      <Disclosure summary={texts.fullTextLabel}>
        <div className="space-y-2 text-base leading-6 break-words text-muted-foreground">
          {texts.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </Disclosure>
      {error ? <Notice tone="errore">{error}</Notice> : null}
      <ActionBar>
        <Button type="button" className={PRIMARY_CLASS} disabled={busy} aria-busy={busy || undefined} onClick={onAccept}>
          {texts.button}
        </Button>
      </ActionBar>
    </section>
  );
}

/** Nel piè di pagina: «▸ Come usiamo le tue risposte», con l'informativa completa. */
export function PrivacyFooter({ texts }: { texts: Pick<PrivacyTexts, "footerLabel" | "paragraphs"> }) {
  return (
    <Disclosure summary={texts.footerLabel}>
      <div className="space-y-2 text-base leading-6 break-words text-muted-foreground">
        {texts.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    </Disclosure>
  );
}

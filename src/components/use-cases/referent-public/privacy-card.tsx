"use client";

import { Button } from "@/components/ui/button";
import { Disclosure, Notice, PRIMARY_CLASS } from "@/components/uc/referente/screen";
import { ActionBar } from "@/components/uc/referente/step-bar";
import { REFERENT_ERROR_MESSAGES, REFERENT_PRIVACY_NOTICE, REFERENT_PUBLIC_TEXT, fillText } from "@/lib/use-cases/referent/labels";

/**
 * «Prima di iniziare» (SPEC §4.4 punto 3, §5.3): l'informativa a due livelli. (Rilascio 5.1) Corta e
 * calma: una riga e due punti, il testo completo a un tocco («Leggi l'informativa completa») e
 * «Iniziamo», fisso in basso al telefono. Finché non lo preme, il referente non vede domande, bozze o
 * caricamenti. Dopo, l'informativa resta nel piè di pagina («Come usiamo le tue risposte»).
 *
 * (Rilascio 9b) Il testo è quello della versione da accettare, che il server manda nella vista (`noticeOf`): può
 * tornare a metà visita (`again`), se l'informativa cambia con un rilascio mentre la pagina è aperta, e allora una riga
 * dice che quello che il referente ha scritto resta. Senza quel testo (`texts` null: pagina e server di rilasci diversi,
 * niente Skew Protection) il riquadro chiede di ricaricare la pagina: mai «Iniziamo» sotto un testo diverso da quello
 * che si accetta.
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

const CARD_CLASS = "mt-6 space-y-5 rounded-xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6";
const TITLE_CLASS = "text-xl leading-7 font-semibold break-words outline-none";

export function PrivacyCard({
  texts,
  again = false,
  busy,
  error,
  onAccept,
}: {
  texts: PrivacyTexts | null;
  /** (Rilascio 9b) L'informativa torna a metà visita: la riga «Quello che hai scritto resta qui». */
  again?: boolean;
  busy: boolean;
  error: string | null;
  onAccept: () => void;
}) {
  if (!texts) {
    return (
      <section aria-labelledby={PRIVACY_TITLE_ID} className={CARD_CLASS} data-slot="referent-privacy" data-state="ricarica">
        <h2 id={PRIVACY_TITLE_ID} tabIndex={-1} className={TITLE_CLASS}>
          {REFERENT_PRIVACY_NOTICE.title}
        </h2>
        <p className="text-base break-words">{REFERENT_ERROR_MESSAGES.informativa_aggiornata}</p>
        <ActionBar>
          <Button type="button" className={PRIMARY_CLASS} onClick={() => window.location.reload()}>
            {REFERENT_PUBLIC_TEXT.error.reload}
          </Button>
        </ActionBar>
      </section>
    );
  }
  return (
    <section aria-labelledby={PRIVACY_TITLE_ID} className={CARD_CLASS} data-slot="referent-privacy">
      <h2 id={PRIVACY_TITLE_ID} tabIndex={-1} className={TITLE_CLASS}>
        {texts.title}
      </h2>
      {again ? <Notice tone="info">{fillText(REFERENT_PUBLIC_TEXT.privacyAgain, { bottone: texts.button })}</Notice> : null}
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

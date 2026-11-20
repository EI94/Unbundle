"use client";

import { Button } from "@/components/ui/button";
import { PRIVACY_UPDATED_MESSAGE, REFERENT_PRIVACY_NOTICE, type ReferentNoticeText } from "@/lib/uc/public-view";
import { R_TEXT } from "@/lib/uc/views/referente-text";
import { ActionBar } from "./step-bar";
import { Disclosure, Notice, PRIMARY_CLASS, ScreenTitle } from "./screen";

/**
 * R0 · «Prima di iniziare» (DESIGN §4.3): l'informativa a due livelli. Tre
 * punti da sapere, il testo completo in un riquadro chiuso, «Ho letto,
 * iniziamo» fisso in basso al telefono. Finché non lo preme, il referente non
 * vede le domande. Dopo, l'informativa resta nel piè di pagina della Home.
 *
 * (Ondata 0) Il testo è quello della versione da accettare (`noticeFor`), che
 * il server manda nella vista: può tornare a metà visita, se l'informativa è
 * cambiata con un rilascio. Se la pagina non ha quel testo (`notice` null,
 * pagina e server di rilasci diversi), chiede di ricaricarsi: mai «Ho letto»
 * sotto un testo diverso da quello che si accetta.
 *
 * (Rilascio 10, §3.11) La riga del cliente la mostra il guscio, in alto.
 * L'informativa è quella di `/r` (`uc-2026-11-2`, con le parole del kit): i suoi
 * fatti non sono quelli di `/rispondi`, che tiene la sua.
 */
export function PrivacyGate({
  notice,
  busy,
  error,
  disabled,
  onAcknowledge,
}: {
  notice: ReferentNoticeText | null;
  busy: boolean;
  error: string | null;
  disabled: boolean;
  onAcknowledge: () => void;
}) {
  if (!notice) {
    return (
      <section aria-labelledby="uc-r-titolo" className="mt-4 space-y-5">
        <ScreenTitle>{REFERENT_PRIVACY_NOTICE.title}</ScreenTitle>
        <p className="text-base">{PRIVACY_UPDATED_MESSAGE}</p>
        <ActionBar>
          <Button type="button" className={PRIMARY_CLASS} onClick={() => window.location.reload()}>
            {R_TEXT.privacyReload}
          </Button>
        </ActionBar>
      </section>
    );
  }
  const n = notice;
  return (
    <section aria-labelledby="uc-r-titolo" className="mt-4 space-y-5">
      <ScreenTitle>{n.title}</ScreenTitle>
      <p className="text-base">{n.lead}</p>
      <ul className="list-disc space-y-3 pl-5 text-base leading-6">
        {n.summary.map((s) => (
          <li key={s} className="break-words">
            {s}
          </li>
        ))}
      </ul>
      <Disclosure summary={n.fullTextLabel}>
        <div className="space-y-2 text-base leading-6 break-words text-muted-foreground">
          {n.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </Disclosure>
      {error ? <Notice tone="errore">{error}</Notice> : null}
      <p className="text-sm break-words text-muted-foreground">{n.contact}</p>
      <ActionBar>
        <Button type="button" className={PRIMARY_CLASS} disabled={busy || disabled} onClick={onAcknowledge}>
          {n.button}
        </Button>
      </ActionBar>
    </section>
  );
}

/** Dopo la conferma: «▸ Come usiamo le tue risposte» nel piè di pagina, con il testo accettato. */
export function PrivacyFooter({ notice = REFERENT_PRIVACY_NOTICE }: { notice?: ReferentNoticeText }) {
  const n = notice;
  return (
    <Disclosure summary={n.footerLabel}>
      <div className="space-y-2 text-base leading-6 break-words text-muted-foreground">
        {n.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <p>{n.contact}</p>
      </div>
    </Disclosure>
  );
}

import { SURVEY_TEXT, noticeUrlOf, surveyNotice } from "@/lib/public/survey";
import { PublicLink } from "./public-shell";

/**
 * L'informativa unica del questionario, «Come usiamo le tue risposte» (rilascio 10, ondata 4, PROPOSTA-10 §3.11, audit
 * Fuori §3.8 «/privacy/ai-readiness»): chi le raccoglie, perché, come sono salvate, chi le vede, su quale base, per quanto
 * tempo, a chi chiedere, fatto per fatto come l'informativa di prima (`surveyNotice`). La stessa su
 * `/privacy/ai-readiness/<token>` e, chiusa, sul link aperto `/s/<token>` e in testa al questionario `/a/<token>`.
 * L'informativa completa del cliente, se c'è, a un tocco (`noticeUrlOf`: un indirizzo che non è una pagina web si legge
 * come testo). Senza stato.
 */
export function SurveyNotice({
  privacyConfig,
  threshold,
  named,
  support,
}: {
  privacyConfig: Readonly<Record<string, unknown>> | null | undefined;
  threshold: number;
  named: boolean;
  support: { label: string; mailto: string } | null;
}) {
  const N = SURVEY_TEXT.notice;
  const rows = surveyNotice({ privacyConfig, threshold, named });
  const full = noticeUrlOf(privacyConfig?.privacyNoticeUrl);
  return (
    <div data-slot="survey-notice" className="space-y-4">
      <dl className="space-y-3">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-sm font-medium text-foreground">{row.label}</dt>
            <dd className="mt-0.5 break-words text-muted-foreground">{row.value}</dd>
          </div>
        ))}
        <div>
          <dt className="text-sm font-medium text-foreground">{N.questions}</dt>
          <dd className="break-words text-muted-foreground">
            {support ? (
              <PublicLink href={support.mailto} className="break-all">
                {support.label}
              </PublicLink>
            ) : (
              N.questionsFallback
            )}
          </dd>
        </div>
      </dl>
      {full && "href" in full ? (
        <p>
          <PublicLink href={full.href} external={!full.href.startsWith("mailto:")}>
            {N.full}
          </PublicLink>
        </p>
      ) : full ? (
        <p className="break-words text-muted-foreground">
          {N.fullText} {full.text}
        </p>
      ) : null}
    </div>
  );
}

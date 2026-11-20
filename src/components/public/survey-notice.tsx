import { SURVEY_TEXT, surveyNotice } from "@/lib/public/survey";
import { PublicLink } from "./public-shell";

/**
 * L'informativa unica del questionario, «Come usiamo le tue risposte» (rilascio 10, ondata 4, PROPOSTA-10 §3.11, audit
 * Fuori §3.8 «/privacy/ai-readiness»): chi le raccoglie, perché, chi le vede, su quale base, per quanto tempo, a chi
 * chiedere. La stessa su `/privacy/ai-readiness/<token>` e, chiusa nel piè di pagina, sul link aperto `/s/<token>` (dove
 * non c'è ancora un link personale). L'informativa completa del cliente, se c'è, a un tocco. Senza stato.
 */
export function SurveyNotice({
  privacyConfig,
  threshold,
  support,
}: {
  privacyConfig: Readonly<Record<string, unknown>> | null | undefined;
  threshold: number;
  support: { label: string; mailto: string } | null;
}) {
  const N = SURVEY_TEXT.notice;
  const rows = surveyNotice({ privacyConfig, threshold });
  const full = typeof privacyConfig?.privacyNoticeUrl === "string" && /^https?:\/\//i.test(privacyConfig.privacyNoticeUrl.trim()) ? privacyConfig.privacyNoticeUrl.trim() : null;
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
      {full ? (
        <p>
          <PublicLink href={full} external>
            {N.full}
          </PublicLink>
        </p>
      ) : null}
    </div>
  );
}

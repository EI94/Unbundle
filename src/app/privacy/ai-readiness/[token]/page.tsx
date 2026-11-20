import type { Metadata } from "next";
import { hashInviteToken } from "@/lib/ai-readiness/token";
import { parseSupportContacts } from "@/lib/ai-readiness/support-contacts";
import { getRespondentPrivacyBundleByTokenHash } from "@/lib/db/queries/ai-readiness";
import { SURVEY_TEXT, fillSurvey, surveyDay } from "@/lib/public/survey";
import { RespondentPrivacyControls } from "@/components/ai-readiness/respondent-privacy-controls";
import { PublicContact, PublicLink, PublicShell } from "@/components/public/public-shell";
import { PublicCard, PublicCardText, PublicInvalidScreen } from "@/components/public/state-card";
import { SurveyNotice } from "@/components/public/survey-notice";
import { Fold } from "@/components/ui-10/fold";

export const dynamic = "force-dynamic";

/**
 * L'informativa unica del questionario, «Come usiamo le tue risposte», dal link personale (rilascio 10, ondata 4,
 * docs/ui-10/PROPOSTA-10.md §3.11, audit Fuori §3.8 AR-18…20): chi le raccoglie, perché, chi le vede, per quanto tempo, a
 * chi chiedere. Sotto, chiusa, «I tuoi dati ▸»: il riepilogo, «Scarica una copia», «Ritira il consenso al confronto»
 * (solo se è stato dato) e «Cancella le mie risposte» con la conferma nella pagina. La piega si apre da sola quando si
 * arriva per i dati (`?dati=1`) o dopo un'azione (`?benchmark=`, `?error=`). Il guscio unico, chiaro; niente stato
 * dell'invito in inglese, «Controller», «Retention» né «JSON». Le rotte delle azioni non cambiano.
 */
export const metadata: Metadata = {
  title: SURVEY_TEXT.notice.title,
  robots: { index: false, follow: false, nocache: true },
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function AiReadinessPrivacyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const D = SURVEY_TEXT.data;

  if (first(query.anonymized) === "1") {
    return (
      <PublicShell>
        <PublicCard title={D.erasedTitle}>
          <PublicCardText>{D.erased}</PublicCardText>
        </PublicCard>
      </PublicShell>
    );
  }

  const bundle = await getRespondentPrivacyBundleByTokenHash(hashInviteToken(token));
  if (!bundle) return <PublicInvalidScreen body={SURVEY_TEXT.gone} />;

  const privacy = (bundle.assessment.privacyConfig ?? {}) as Record<string, unknown>;
  const brand = (bundle.assessment.brandConfig ?? {}) as Record<string, unknown>;
  const client = typeof brand.displayName === "string" && brand.displayName.trim() ? brand.displayName.trim() : null;
  const support = parseSupportContacts(typeof privacy.supportEmail === "string" ? privacy.supportEmail : "");
  const error = first(query.error);
  const withdrawn = first(query.benchmark) === "withdrawn";
  const openData = first(query.dati) === "1" || withdrawn || error !== "";
  const sent = surveyDay(bundle.respondent.completedAt);
  const cases = bundle.useCases.length;
  const benchmarkGiven = bundle.respondent.hasBenchmarkConsent === true;

  return (
    <PublicShell client={client} footer={support ? <PublicContact label={support.label} href={support.mailto} /> : null}>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{SURVEY_TEXT.notice.title}</h1>
      <div className="mt-6">
        <SurveyNotice privacyConfig={privacy} threshold={bundle.assessment.aggregationThreshold} support={support} />
      </div>

      <Fold id="i-tuoi-dati" title={D.title} defaultOpen={openData} className="mt-8">
        <ul className="space-y-1 text-muted-foreground" data-testid="privacy-summary">
          <li>{sent ? fillSurvey(D.sent, { data: sent }) : D.notSent}</li>
          {/* Lo zero non si vede. */}
          {cases > 0 ? <li>{fillSurvey(D.cases, { n: cases })}</li> : null}
          {benchmarkGiven ? <li>{D.benchmarkGiven}</li> : null}
        </ul>
        {withdrawn ? (
          <p role="status" className="rounded-xl bg-uc-verde-bg px-4 py-3">
            {D.withdrawn}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-destructive">
            {error === "invalid" ? SURVEY_TEXT.gone : D.eraseFailed}
          </p>
        ) : null}
        <RespondentPrivacyControls token={token} benchmarkGiven={benchmarkGiven} />
      </Fold>

      <p className="mt-6">
        <PublicLink href={`/a/${token}`}>{SURVEY_TEXT.notice.back}</PublicLink>
      </p>
    </PublicShell>
  );
}

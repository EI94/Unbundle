import type { Metadata } from "next";
import { AI_READINESS_DEFAULT_COPY, brandCopy } from "@/lib/ai-readiness/copy";
import { hashInviteToken } from "@/lib/ai-readiness/token";
import { parseSupportContacts } from "@/lib/ai-readiness/support-contacts";
import {
  getRespondentByInviteTokenHash,
  getResponseForRespondent,
  listUseCaseSubmissionsByRespondent,
  markRespondentOpened,
} from "@/lib/db/queries/ai-readiness";
import { draftPrefillFromResponse } from "@/lib/ai-readiness/draft";
import { questionScopeFromUnknown } from "@/lib/ai-readiness/template-scope";
import type { AiReadinessAnswer } from "@/lib/ai-readiness/types";
import { SURVEY_TEXT, fillSurvey, surveyFacts, surveyMinutes, surveyPrivacyLine } from "@/lib/public/survey";
import { RespondentSurveyForm } from "@/components/ai-readiness/respondent-survey-form";
import { UseCaseExpertForm } from "@/components/ai-readiness/use-case-expert-form";
import { PublicContact, PublicFooterLine, PublicLink, PublicShell } from "@/components/public/public-shell";
import { PublicCard, PublicCardText, PublicInvalidScreen } from "@/components/public/state-card";

export const dynamic = "force-dynamic";

/**
 * Il link personale del questionario AI Readiness (`/a/<token>`), con tre percorsi: il questionario per tutti, la scheda
 * dei referenti e la raccolta dei casi d'uso.
 *
 * (Rilascio 10, ondata 4, docs/ui-10/PROPOSTA-10.md §3.11, audit Fuori §3.8) Il guscio unico delle pagine pubbliche,
 * chiaro, con il nome del cliente in alto, non cliccabile. Una testata di circa 40 parole: il titolo, «10 minuti · anonimo
 * · si salva da solo», il testo d'apertura della rilevazione e la privacy in una riga. Niente etichette, metodologia
 * («Questa compilazione alimenta…»), tre card «come funziona», blocco legale, casella: la presa visione si registra
 * all'invio, con una riga e il link a «Come usiamo le tue risposte» (l'informativa unica). In fondo il contatto e «Questo
 * link è solo tuo». I testi stanno in `src/lib/public/survey.ts`.
 */
export const metadata: Metadata = {
  title: "Questionario AI Readiness",
  description: SURVEY_TEXT.preview.titleNoClient,
  robots: { index: false, follow: false, nocache: true },
  // Mai la scheda commerciale del sito nell'anteprima di una chat.
  openGraph: { title: "Questionario AI Readiness", description: SURVEY_TEXT.preview.titleNoClient, type: "website" },
  twitter: { card: "summary", title: "Questionario AI Readiness", description: SURVEY_TEXT.preview.titleNoClient },
};

function configString(config: Record<string, unknown> | null, key: string, fallback = "") {
  const value = config?.[key];
  return typeof value === "string" ? value : fallback;
}

export default async function AiReadinessRespondentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await getRespondentByInviteTokenHash(hashInviteToken(token));
  if (!found) return <PublicInvalidScreen body={SURVEY_TEXT.gone} />;
  await markRespondentOpened(found.respondent);

  const brand = found.assessment.brandConfig ?? {};
  const privacy = found.assessment.privacyConfig ?? {};
  const client = configString(brand, "displayName").trim() || null;
  const support = parseSupportContacts(configString(privacy, "supportEmail"));
  const noticeHref = `/privacy/ai-readiness/${token}`;
  const footer = (
    <>
      {support ? <PublicContact label={support.label} href={support.mailto} /> : null}
      <PublicFooterLine>{SURVEY_TEXT.personalLink}</PublicFooterLine>
    </>
  );

  if (found.respondent.inviteStatus === "completed") {
    return (
      <PublicShell client={client} footer={footer}>
        <PublicCard title={SURVEY_TEXT.completed.title}>
          <PublicCardText>
            <p>{SURVEY_TEXT.completed.body}</p>
            {support ? <p>{fillSurvey(SURVEY_TEXT.wrong, { contatto: support.label })}</p> : null}
          </PublicCardText>
          <p className="mt-4">
            <PublicLink href={`${noticeHref}?dati=1`}>{SURVEY_TEXT.data.title}</PublicLink>
          </p>
        </PublicCard>
      </PublicShell>
    );
  }

  if (found.assessment.status !== "open") {
    return (
      <PublicShell client={client} footer={footer}>
        <PublicCard title={SURVEY_TEXT.closed.title}>
          <PublicCardText>{SURVEY_TEXT.closed.body}</PublicCardText>
        </PublicCard>
      </PublicShell>
    );
  }

  if (found.respondent.surveyTrack === "use_case_expert") {
    const cases = await listUseCaseSubmissionsByRespondent(found.respondent.id);
    return (
      <PublicShell client={client} footer={footer}>
        <div data-survey-track="use_case_expert">
          <h1 className="mt-6 text-2xl font-semibold tracking-tight break-words">{SURVEY_TEXT.expert.title}</h1>
          <p className="mt-2 text-muted-foreground">{SURVEY_TEXT.expert.intro}</p>
          <UseCaseExpertForm
            token={token}
            initialCount={cases.length}
            noticeHref={noticeHref}
            fieldIds={questionScopeFromUnknown(found.respondent.questionScope)?.useCaseFieldIds ?? null}
          />
        </div>
      </PublicShell>
    );
  }

  const isInternalTrack = found.respondent.surveyTrack === "internal";
  const named = found.assessment.anonymousMode === false;
  const scoredQuestions = found.templateDefinition.questions.filter((question) => question.answerType !== "text").length;

  const existingResponse = await getResponseForRespondent(
    found.respondent.assessmentId,
    found.respondent.id
  );
  const draft =
    existingResponse?.status === "draft"
      ? draftPrefillFromResponse({
          answers: existingResponse.answers as AiReadinessAnswer[] | null,
          metadata: existingResponse.metadata as Record<string, unknown> | null,
        })
      : null;
  const draftSavedAt =
    draft &&
    typeof (existingResponse?.metadata as Record<string, unknown> | null)
      ?.draftSavedAt === "string"
      ? ((existingResponse!.metadata as Record<string, unknown>)
          .draftSavedAt as string)
      : null;

  return (
    <PublicShell client={client} footer={footer}>
      <div data-survey-track={found.respondent.surveyTrack}>
        <header data-testid="survey-header">
          <h1 className="mt-6 text-2xl font-semibold tracking-tight break-words">{isInternalTrack ? SURVEY_TEXT.internalTitle : SURVEY_TEXT.title}</h1>
          <p className="mt-2 text-muted-foreground">{surveyFacts(surveyMinutes(scoredQuestions), named)}</p>
          <div className="mt-4 space-y-2">
            {isInternalTrack ? <p>{SURVEY_TEXT.internalIntro}</p> : null}
            <p>{brandCopy(brand, "introCopy", AI_READINESS_DEFAULT_COPY.intro)}</p>
            <p className="text-muted-foreground">{surveyPrivacyLine(named, found.assessment.aggregationThreshold)}</p>
          </div>
        </header>

        <RespondentSurveyForm
          token={token}
          template={found.templateDefinition}
          brandConfig={brand}
          privacyConfig={privacy}
          initialDraft={draft}
          draftSavedAt={draftSavedAt}
          anonymousMode={!named}
          useCaseModule={!isInternalTrack}
          noticeHref={noticeHref}
          initialIdentity={{
            firstName:
              draft?.identity.firstName || found.respondent.name || "",
            lastName:
              draft?.identity.lastName || found.respondent.surname || "",
          }}
        />
      </div>
    </PublicShell>
  );
}

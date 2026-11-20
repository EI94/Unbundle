import type { Metadata } from "next";
import { hashInviteToken } from "@/lib/ai-readiness/token";
import { parseSupportContacts } from "@/lib/ai-readiness/support-contacts";
import { getAssessmentByOpenLinkTokenHash, listRespondentsByAssessment } from "@/lib/db/queries/ai-readiness";
import {
  filterTemplateForQuestionScope,
  filterTemplateForTrack,
  questionScopeFromUnknown,
} from "@/lib/ai-readiness/template-scope";
import { SURVEY_TEXT, fillSurvey, surveyAreas, surveyFacts, surveyMinutes } from "@/lib/public/survey";
import { OpenSurveyStartForm } from "@/components/ai-readiness/open-survey-start-form";
import { PublicContact, PublicShell } from "@/components/public/public-shell";
import { PublicCard, PublicCardText, PublicInvalidScreen } from "@/components/public/state-card";
import { SurveyNotice } from "@/components/public/survey-notice";
import { Fold } from "@/components/ui-10/fold";

export const dynamic = "force-dynamic";

/**
 * Il link aperto del questionario AI Readiness (`/s/<token>`): chi lo apre sceglie la sua area (e, se il questionario è
 * nominativo, scrive nome e cognome), poi va al suo link personale `/a/…`.
 *
 * (Rilascio 10, ondata 4, docs/ui-10/PROPOSTA-10.md §3.11, audit Fuori §3.8) Il guscio unico delle pagine pubbliche,
 * chiaro: il nome del cliente in alto, non cliccabile; H1 «Com'è l'AI nel tuo lavoro?»; «10 minuti · risposte pseudonime ·
 * si salva da solo»; «La tua area» dall'elenco delle aree che la rilevazione conosce già, più «Un'altra area» (senza aree,
 * il campo da scrivere); «Inizia» a tutta larghezza. Niente metodologia interna, nome della rilevazione,
 * interruttore del tema, email facoltativa (D12). In fondo «Come usiamo le tue risposte» (l'informativa unica, chiusa) e
 * il contatto. Un link sbagliato ha la scheda unica; una raccolta chiusa lo dice. I testi stanno in
 * `src/lib/public/survey.ts`.
 */

/** Le domande del questionario per tutti di questo link: quelle con le risposte pronte decidono i minuti. */
function scoredQuestions(found: NonNullable<Awaited<ReturnType<typeof getAssessmentByOpenLinkTokenHash>>>) {
  const everyone = filterTemplateForQuestionScope(
    filterTemplateForTrack(found.templateDefinition, "everyone"),
    questionScopeFromUnknown(found.assessment.scoringConfig?.openLinkQuestionScope)
  );
  return everyone.questions.filter((q) => q.answerType !== "text").length;
}

function displayName(brand: Record<string, unknown> | null | undefined): string | null {
  return typeof brand?.displayName === "string" && brand.displayName.trim() ? brand.displayName.trim() : null;
}

/**
 * Anteprima del link quando viene incollato in WhatsApp, Teams o in una mail:
 * senza questo il primo contatto del dipendente è una card di marketing del
 * fornitore. Resta noindex: è solo la scheda condivisa nelle chat.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const found = await getAssessmentByOpenLinkTokenHash(hashInviteToken(token));
  const company = displayName(found?.assessment.brandConfig);
  const P = SURVEY_TEXT.preview;
  const title = company ? fillSurvey(P.title, { Cliente: company }) : P.titleNoClient;
  const description = fillSurvey(P.description, { N: found ? surveyMinutes(scoredQuestions(found)) : 10 });
  return {
    title,
    description,
    robots: { index: false, follow: false, nocache: true },
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

function configString(config: Record<string, unknown> | null, key: string, fallback = "") {
  const value = config?.[key];
  return typeof value === "string" ? value : fallback;
}

export default async function OpenSurveyLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await getAssessmentByOpenLinkTokenHash(hashInviteToken(token));

  if (!found) return <PublicInvalidScreen body={SURVEY_TEXT.gone} />;

  const client = displayName(found.assessment.brandConfig);
  const privacy = found.assessment.privacyConfig ?? {};
  const support = parseSupportContacts(configString(privacy, "supportEmail"));
  const contact = support ? <PublicContact label={support.label} href={support.mailto} /> : null;
  const named = found.assessment.anonymousMode === false;

  if (found.assessment.status !== "open") {
    return (
      <PublicShell client={client} footer={contact}>
        <PublicCard title={SURVEY_TEXT.closed.title}>
          <PublicCardText>{SURVEY_TEXT.closed.body}</PublicCardText>
        </PublicCard>
      </PublicShell>
    );
  }

  // «La tua area»: le aree che la rilevazione conosce già, scritte come sono (solo lettura). Senza, il campo da scrivere.
  const areas = surveyAreas((await listRespondentsByAssessment(found.assessment.id)).map((respondent) => respondent.organizationUnit));

  return (
    <PublicShell
      client={client}
      footer={
        <>
          <Fold id="come-usiamo-le-risposte" title={SURVEY_TEXT.notice.title} className="border-t-0 last:border-b-0 [&_h2]:text-sm [&_h2]:font-medium">
            <SurveyNotice privacyConfig={privacy} threshold={found.assessment.aggregationThreshold} named={named} support={support} />
          </Fold>
          {contact}
        </>
      }
    >
      <div data-survey-track="everyone">
        <h1 className="mt-6 text-2xl font-semibold tracking-tight break-words">{SURVEY_TEXT.title}</h1>
        <p className="mt-2 text-muted-foreground">{surveyFacts(surveyMinutes(scoredQuestions(found)), named)}</p>
        <OpenSurveyStartForm openToken={token} named={named} areas={areas} />
      </div>
    </PublicShell>
  );
}

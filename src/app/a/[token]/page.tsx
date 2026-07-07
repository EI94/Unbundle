import type { Metadata } from "next";
import Link from "next/link";
import { hashInviteToken } from "@/lib/ai-readiness/token";
import {
  getRespondentByInviteTokenHash,
  getResponseForRespondent,
  markRespondentOpened,
} from "@/lib/db/queries/ai-readiness";
import { draftPrefillFromResponse } from "@/lib/ai-readiness/draft";
import type { AiReadinessAnswer } from "@/lib/ai-readiness/types";
import { RespondentSurveyForm } from "@/components/ai-readiness/respondent-survey-form";
import { SurveyThemeToggle } from "@/components/ai-readiness/survey-theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI Readiness Assessment",
  robots: { index: false, follow: false, nocache: true },
};

function configString(config: Record<string, unknown> | null, key: string, fallback = "") {
  const value = config?.[key];
  return typeof value === "string" ? value : fallback;
}

function InvalidInvite() {
  return (
    <main id="survey-root" className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-sm font-semibold tracking-wide">
          Unbundle
        </Link>
        <Card className="mt-8 rounded-[32px]">
          <CardHeader>
            <CardTitle>Link non valido</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Il link dell&apos;assessment non e valido, e scaduto o e stato
            revocato. Chiedi al referente interno di generare un nuovo invito.
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default async function AiReadinessRespondentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await getRespondentByInviteTokenHash(hashInviteToken(token));
  if (!found) return <InvalidInvite />;
  await markRespondentOpened(found.respondent);

  const brand = found.assessment.brandConfig ?? {};
  const privacy = found.assessment.privacyConfig ?? {};
  const displayName = configString(brand, "displayName", "Unbundle");
  const surveyName = found.assessment.name;
  const supportEmail = configString(privacy, "supportEmail");
  const scoredQuestions = found.templateDefinition.questions.filter(
    (question) => question.answerType !== "text"
  ).length;
  const estimatedMinutes = Math.max(2, Math.round(scoredQuestions * 0.5));

  if (found.respondent.inviteStatus === "completed") {
    return (
      <main id="survey-root" className="min-h-screen bg-background px-4 py-8 text-foreground">
        <div className="mx-auto max-w-2xl">
          <Link href="/" className="text-sm font-semibold tracking-wide">
            Unbundle
          </Link>
          <Card className="mt-8 rounded-[32px]">
            <CardHeader>
              <CardTitle>Assessment gia completato</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Le tue risposte sono gia state inviate una volta e non possono
              essere modificate: cosi ogni persona conta una sola volta.
              Se pensi ci sia un errore{supportEmail ? ` scrivi a ${supportEmail}` : " contatta il referente interno"}.
              <div className="mt-4">
                <Link
                  className="font-medium text-foreground underline"
                  href={`/privacy/ai-readiness/${token}`}
                >
                  Gestisci privacy e dati personali
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (found.assessment.status !== "open") {
    return (
      <main id="survey-root" className="min-h-screen bg-background px-4 py-8 text-foreground">
        <div className="mx-auto max-w-2xl">
          <Link href="/" className="text-sm font-semibold tracking-wide">
            Unbundle
          </Link>
          <Card className="mt-8 rounded-[32px]">
            <CardHeader>
              <CardTitle>Assessment non aperto</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Il link e valido, ma il team non ha ancora aperto la raccolta o
              l&apos;ha gia chiusa. Contatta il referente interno.
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

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
    <main id="survey-root" className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="rounded-[36px] border bg-linear-to-br from-emerald-500/10 via-card to-sky-500/10 p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="text-sm font-semibold tracking-wide">
              Unbundle
            </Link>
            <SurveyThemeToggle />
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">AI Readiness OS</Badge>
            <Badge variant="outline">{displayName}</Badge>
            <Badge variant="outline">~{estimatedMinutes} minuti</Badge>
          </div>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight">
            Benvenuto nella survey «{surveyName}» 👋
          </h1>
          <p className="mt-2 max-w-3xl text-base text-muted-foreground">
            Il tuo contributo è importante: aiuta la tua organizzazione a
            capire dove l&apos;AI può dare una mano davvero.
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
            {configString(
              brand,
              "introCopy",
              "Questa diagnosi misura la readiness AI dell'organizzazione. Non e un esame: serve a capire dove aiutare meglio team, processi e tecnologia."
            )}
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-3" data-testid="survey-howto">
            {[
              { n: "1", t: "Rispondi da 0 a 5", d: "0 = non presente, 5 = AI native. Nessuna risposta è sbagliata." },
              { n: "2", t: "Tutto si salva da solo", d: "Puoi chiudere e riprendere quando vuoi da questo stesso link." },
              { n: "3", t: "Invia alla fine", d: "Controlla la barra di avanzamento e premi Invia assessment." },
            ].map((step) => (
              <div key={step.n} className="rounded-2xl border bg-background/60 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-semibold text-emerald-600">{step.n}</span>
                  {step.t}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.d}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-2xl border bg-background/60 p-4 text-xs leading-5 text-muted-foreground">
            {found.assessment.anonymousMode !== false ? (
              <>
                Le risposte sono salvate con identificativo pseudonimo e vengono
                aggregate. I risultati per area sono visibili solo se ci sono
                almeno {found.assessment.aggregationThreshold} respondent.
              </>
            ) : (
              <>
                Questa survey e nominativa: ti chiederemo nome e cognome, senza
                bisogno di creare un account. I risultati per area vengono
                comunque aggregati (minimo {found.assessment.aggregationThreshold}{" "}
                respondent).
              </>
            )}
            <div className="mt-2 flex flex-wrap gap-4">
              <Link
                className="font-medium text-foreground underline"
                href={`/privacy/ai-readiness/${token}`}
              >
                Gestisci privacy, export dati o revoca benchmark
              </Link>
              {supportEmail && (
                <a className="font-medium text-foreground underline" href={`mailto:${supportEmail}`}>
                  Serve aiuto? Scrivi a {supportEmail}
                </a>
              )}
            </div>
          </div>
        </header>

        <RespondentSurveyForm
          token={token}
          template={found.templateDefinition}
          brandConfig={brand}
          privacyConfig={privacy}
          initialDraft={draft}
          draftSavedAt={draftSavedAt}
          anonymousMode={found.assessment.anonymousMode !== false}
          initialIdentity={{
            firstName:
              draft?.identity.firstName || found.respondent.name || "",
            lastName:
              draft?.identity.lastName || found.respondent.surname || "",
          }}
        />
      </div>
    </main>
  );
}

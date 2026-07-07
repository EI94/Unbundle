import type { Metadata } from "next";
import Link from "next/link";
import { hashInviteToken } from "@/lib/ai-readiness/token";
import { getAssessmentByOpenLinkTokenHash } from "@/lib/db/queries/ai-readiness";
import { OpenSurveyStartForm } from "@/components/ai-readiness/open-survey-start-form";
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

export default async function OpenSurveyLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const found = await getAssessmentByOpenLinkTokenHash(hashInviteToken(token));

  if (!found || found.assessment.status !== "open") {
    return (
      <main id="survey-root" className="min-h-screen bg-background px-4 py-8 text-foreground">
        <div className="mx-auto max-w-2xl">
          <Link href="/" className="text-sm font-semibold tracking-wide">Unbundle</Link>
          <Card className="mt-8 rounded-[32px]">
            <CardHeader><CardTitle>Link non attivo</CardTitle></CardHeader>
            <CardContent className="text-sm leading-6 text-muted-foreground">
              Il link non è valido oppure la raccolta non è aperta in questo
              momento. Chiedi al referente interno un nuovo link.
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const brand = found.assessment.brandConfig ?? {};
  const privacy = found.assessment.privacyConfig ?? {};
  const named = found.assessment.anonymousMode === false;
  const supportEmail = configString(privacy, "supportEmail");
  const scored = found.templateDefinition.questions.filter((q) => q.answerType !== "text").length;
  const minutes = Math.max(2, Math.round(scored * 0.5));

  return (
    <main id="survey-root" className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="rounded-[36px] border bg-linear-to-br from-emerald-500/10 via-card to-sky-500/10 p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="text-sm font-semibold tracking-wide">Unbundle</Link>
            <SurveyThemeToggle />
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">AI Readiness</Badge>
            <Badge variant="outline">{configString(brand, "displayName", "Unbundle")}</Badge>
            <Badge variant="outline">~{minutes} minuti</Badge>
            <Badge variant="outline">{named ? "Nominativa" : "Anonima"}</Badge>
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">
            Benvenuto nella survey «{found.assessment.name}» 👋
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {configString(
              brand,
              "introCopy",
              "Il tuo contributo è importante: aiuta la tua organizzazione a capire dove l'AI può dare una mano davvero. Non è un esame e non ci sono risposte sbagliate."
            )}
          </p>
          <ul className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
            <li className="rounded-2xl border bg-background/60 p-3">✍️ {scored} domande, scala 0–5</li>
            <li className="rounded-2xl border bg-background/60 p-3">💾 Salvataggio automatico, riprendi quando vuoi</li>
            <li className="rounded-2xl border bg-background/60 p-3">🔒 {named ? "Risposte nominative, risultati aggregati" : "Risposte pseudonime e aggregate"}</li>
          </ul>
          {supportEmail && (
            <p className="mt-4 text-xs text-muted-foreground">
              Domande o problemi? Scrivi a{" "}
              <a className="font-medium text-foreground underline" href={`mailto:${supportEmail}`}>
                {supportEmail}
              </a>
            </p>
          )}
        </header>

        <OpenSurveyStartForm openToken={token} named={named} />
      </div>
    </main>
  );
}

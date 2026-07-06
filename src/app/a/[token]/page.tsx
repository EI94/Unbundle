import type { Metadata } from "next";
import Link from "next/link";
import { hashInviteToken } from "@/lib/ai-readiness/token";
import {
  getRespondentByInviteTokenHash,
  markRespondentOpened,
} from "@/lib/db/queries/ai-readiness";
import { RespondentSurveyForm } from "@/components/ai-readiness/respondent-survey-form";
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
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
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

  if (found.respondent.inviteStatus === "completed") {
    return (
      <main className="min-h-screen bg-background px-4 py-8 text-foreground">
        <div className="mx-auto max-w-2xl">
          <Link href="/" className="text-sm font-semibold tracking-wide">
            Unbundle
          </Link>
          <Card className="mt-8 rounded-[32px]">
            <CardHeader>
              <CardTitle>Assessment gia completato</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Le tue risposte sono gia state inviate. Grazie per il contributo.
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
      <main className="min-h-screen bg-background px-4 py-8 text-foreground">
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

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="rounded-[36px] border bg-linear-to-br from-emerald-500/10 via-card to-sky-500/10 p-7">
          <Link href="/" className="text-sm font-semibold tracking-wide">
            Unbundle
          </Link>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">AI Readiness OS</Badge>
            <Badge variant="outline">{displayName}</Badge>
          </div>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight">
            AI Readiness Assessment
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
            {configString(
              brand,
              "introCopy",
              "Questa diagnosi misura la readiness AI dell'organizzazione. Non e un esame: serve a capire dove aiutare meglio team, processi e tecnologia."
            )}
          </p>
          <div className="mt-5 rounded-2xl border bg-background/60 p-4 text-xs leading-5 text-muted-foreground">
            Le risposte sono salvate con identificativo pseudonimo e vengono
            aggregate. I risultati per area sono visibili solo se ci sono almeno{" "}
            {found.assessment.aggregationThreshold} respondent.
            <div className="mt-2">
              <Link
                className="font-medium text-foreground underline"
                href={`/privacy/ai-readiness/${token}`}
              >
                Gestisci privacy, export dati o revoca benchmark
              </Link>
            </div>
          </div>
        </header>

        <RespondentSurveyForm
          token={token}
          template={found.templateDefinition}
          brandConfig={brand}
          privacyConfig={privacy}
        />
      </div>
    </main>
  );
}

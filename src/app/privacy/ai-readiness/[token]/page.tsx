import type { Metadata } from "next";
import Link from "next/link";
import { hashInviteToken } from "@/lib/ai-readiness/token";
import { getRespondentPrivacyBundleByTokenHash } from "@/lib/db/queries/ai-readiness";
import { RespondentPrivacyControls } from "@/components/ai-readiness/respondent-privacy-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy AI Readiness",
  robots: { index: false, follow: false, nocache: true },
};

function InvalidPrivacyLink() {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-sm font-semibold tracking-wide">
          Unbundle
        </Link>
        <Card className="mt-8 rounded-[32px]">
          <CardHeader>
            <CardTitle>Link privacy non valido</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Il link non e valido o i dati sono gia stati anonimizzati. Chiedi al
            referente interno se hai bisogno di supporto.
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function AnonymizedSuccess() {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-sm font-semibold tracking-wide">
          Unbundle
        </Link>
        <Card className="mt-8 rounded-[32px]">
          <CardHeader>
            <CardTitle>Dati anonimizzati</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            I dati collegati a questo token sono stati anonimizzati. Il vecchio
            link non puo piu mostrare dati personali.
          </CardContent>
        </Card>
      </div>
    </main>
  );
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
  if (query.anonymized === "1") return <AnonymizedSuccess />;
  const bundle = await getRespondentPrivacyBundleByTokenHash(hashInviteToken(token));
  if (!bundle) return <InvalidPrivacyLink />;
  const privacy = bundle.assessment.privacyConfig ?? {};
  const error = typeof query.error === "string" ? query.error : "";
  const benchmark = typeof query.benchmark === "string" ? query.benchmark : "";

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="rounded-[36px] border bg-linear-to-br from-emerald-500/10 via-card to-sky-500/10 p-7">
          <Link href="/" className="text-sm font-semibold tracking-wide">
            Unbundle
          </Link>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">
            Privacy e dati AI Readiness
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Da qui puoi scaricare i dati collegati al tuo token, revocare il
            consenso benchmark o anonimizzare le risposte. Le azioni sono
            tracciate in audit log.
          </p>
        </header>

        <Card className="rounded-[28px]">
          <CardHeader>
            <CardTitle>Riepilogo trattamento</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div className="rounded-2xl border p-3">
              <div className="text-xs text-muted-foreground">Assessment</div>
              <div className="mt-1 font-medium">{bundle.assessment.name}</div>
            </div>
            <div className="rounded-2xl border p-3">
              <div className="text-xs text-muted-foreground">Stato invito</div>
              <div className="mt-1 font-medium">{bundle.respondent.inviteStatus}</div>
            </div>
            <div className="rounded-2xl border p-3">
              <div className="text-xs text-muted-foreground">Controller</div>
              <div className="mt-1 font-medium">
                {typeof privacy.controllerName === "string"
                  ? privacy.controllerName
                  : "azienda cliente"}
              </div>
            </div>
            <div className="rounded-2xl border p-3">
              <div className="text-xs text-muted-foreground">Retention</div>
              <div className="mt-1 font-medium">
                {String(privacy.dataRetentionDays ?? 365)} giorni
              </div>
            </div>
          </CardContent>
        </Card>

        {benchmark === "withdrawn" && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700">
            Consenso benchmark revocato correttamente.
          </div>
        )}
        {error === "confirmation" && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Per anonimizzare devi scrivere esattamente ANONIMIZZA.
          </div>
        )}
        {error === "invalid" && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Link privacy non valido o gia anonimizzato.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            render={<Link href={`/api/ai-readiness/respondents/${token}/export`} />}
            nativeButton={false}
          >
            Scarica i miei dati JSON
          </Button>
          <Button
            variant="outline"
            render={<Link href={`/a/${token}`} />}
            nativeButton={false}
          >
            Torna al survey
          </Button>
        </div>

        <RespondentPrivacyControls token={token} />
      </div>
    </main>
  );
}

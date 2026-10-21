import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getUseCaseById } from "@/lib/db/queries/use-cases";
import { dossierStateForUseCase } from "@/lib/db/queries/use-case-dossiers";
import { verifyPortfolioShareToken } from "@/lib/portfolio/share-link";
import { projectForContributor } from "@/lib/use-cases/permissions";
import { phaseOfUseCase, type PhaseInput } from "@/lib/use-cases/phase";
import { romeToday } from "@/lib/use-cases/quarter";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Use case",
  robots: { index: false, follow: false },
};

/**
 * Link di condivisione, in tutti i workspace (D14, docs/use-case/DESIGN.md §11).
 *
 * Il bot di Slack lo manda a chi propone. Chi è membro del workspace va alla scheda, dove
 * vale la sua proiezione. Chi non è membro (o segue solo un corso) vede la sola proposta
 * del link: titolo, fase e «Quando», più «Accedi per aprire la scheda». Niente codice
 * (lo manda Slack a chi ha proposto), niente matrice, punteggi, altre schede, testi o
 * note. Una scheda nascosta alla ricerca mostra solo la fase.
 *
 * La pagina legge la sola scheda del link e passa al client solo testi già ridotti.
 *
 * La scheda dei membri: con l'area «Use case» accesa per il workspace `/use-cases/<id>`, che apre
 * ogni scheda (docs/use-case/DESIGN.md §2.3, §2.5); spenta, come oggi, la pagina di revisione.
 */

/** Chi apre il link senza essere membro: nessuna proposta è sua. */
const NOT_A_MEMBER = { userId: null, email: null, emailVerified: false } as const;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** La scheda della proposta per chi è membro del workspace. */
function memberCardPath(workspaceId: string, useCaseId: string) {
  return isUseCaseHubWorkspace(workspaceId)
    ? `/dashboard/${workspaceId}/use-cases/${useCaseId}`
    : `/dashboard/${workspaceId}/portfolio/review/${useCaseId}`;
}

function loginHref(workspaceId: string, useCaseId: string) {
  return `/login?callbackUrl=${encodeURIComponent(memberCardPath(workspaceId, useCaseId))}`;
}

function InvalidShareLink({ reason, loginUrl }: { reason: "invalid" | "expired"; loginUrl: string }) {
  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto flex min-h-[70vh] max-w-xl items-center">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{reason === "expired" ? "Link scaduto" : "Link non più valido"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              {reason === "expired"
                ? "I link pubblici al portfolio valgono 30 giorni."
                : "Il link è stato disattivato dal team che gestisce il workspace, oppure è stato copiato solo in parte."}{" "}
              Se hai un account Unbundle con accesso al workspace, accedi per
              aprire la scheda. Altrimenti chiedi al team un link nuovo.
            </p>
            <Link href={loginUrl}>
              <Button className="h-10">Accedi a Unbundle</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default async function PublicPortfolioSharePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; useCaseId: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { workspaceId, useCaseId } = await params;
  const token = firstParam((await searchParams).token) ?? "";

  const session = await auth();
  if (session?.user?.id) {
    const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
    // Chi collabora apre la scheda vera; un partecipante a un corso non può,
    // e vede la stessa vista ridotta di chi non ha un account.
    if (access && access.role !== "learner") {
      redirect(memberCardPath(workspaceId, useCaseId));
    }
  }

  // Il token si verifica prima di leggere qualunque dato del portfolio. Un
  // workspace inesistente risponde come un link non valido: niente indizi.
  const workspace = /^[0-9a-f-]{36}$/i.test(workspaceId) ? await getWorkspaceById(workspaceId) : null;
  const check = workspace
    ? verifyPortfolioShareToken(workspaceId, token, { epoch: workspace.portfolioShareEpoch })
    : ({ ok: false, reason: "invalid" } as const);
  if (!workspace || !check.ok) {
    return <InvalidShareLink reason={check.ok ? "invalid" : check.reason} loginUrl={loginHref(workspaceId, useCaseId)} />;
  }

  if (!/^[0-9a-f-]{36}$/i.test(useCaseId)) notFound();
  const selected = await getUseCaseById(useCaseId);
  if (!selected || selected.workspaceId !== workspaceId) notFound();
  if (!selected.portfolioKind) notFound();

  // La fase è quella della scheda e del connettore: con il dossier, se la sezione è accesa.
  const read = await dossierStateForUseCase(workspaceId, useCaseId);
  const dossier = read.ok ? read.dossier : null;
  const row = {
    ...selected,
    intake: selected.intake as PhaseInput["intake"],
    linkedCaseCode: dossier?.code ?? null,
    dossierStatus: dossier?.status ?? null,
    duplicateOfCode: null,
    today: romeToday(),
  };
  // `null` per una scheda nascosta alla ricerca: allora solo la fase, senza titolo.
  const proposal = projectForContributor(NOT_A_MEMBER, row);
  // «Approvato» con «Quando» a parte; nelle altre fasi la pillola dice anche il sotto-stato.
  const phaseText = proposal && proposal.phase !== "approvato" ? proposal.phaseLabel : phaseOfUseCase(row).phaseName;
  const expiresOn = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "long" }).format(check.expiresAt);

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto max-w-xl space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">Use case</h1>

        <Card>
          {proposal && (
            <CardHeader>
              <CardTitle className="break-words text-xl">{proposal.title}</CardTitle>
            </CardHeader>
          )}
          <CardContent className="space-y-5 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Fase</dt>
              <dd>
                <Badge variant="outline">{phaseText}</Badge>
              </dd>
              {proposal?.quando && (
                <>
                  <dt className="text-muted-foreground">Quando</dt>
                  <dd className="font-medium">{proposal.quando}</dd>
                </>
              )}
            </dl>
            <Button render={<Link href={loginHref(workspaceId, useCaseId)} />} nativeButton={false} className="h-10">
              Accedi per aprire la scheda
            </Button>
            <p className="text-xs text-muted-foreground">Link valido fino al {expiresOn}.</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

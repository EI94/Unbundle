import type { Metadata, Viewport } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getUseCaseById } from "@/lib/db/queries/use-cases";
import { dossierStateForUseCase } from "@/lib/db/queries/use-case-dossiers";
import { PORTFOLIO_SHARE_TTL_DAYS, verifyPortfolioShareToken } from "@/lib/portfolio/share-link";
import { projectForContributor } from "@/lib/use-cases/permissions";
import { phaseOfUseCase, type PhaseInput } from "@/lib/use-cases/phase";
import { romeToday } from "@/lib/use-cases/quarter";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { SHARE_PAGE_TEXT, shareExpiryDay } from "@/lib/use-cases/share-page";
import { ShareCase, ShareInvalid } from "./share-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: SHARE_PAGE_TEXT.title,
  robots: { index: false, follow: false },
};

/** (Rilascio 10, §3.11) Una pagina pubblica: tema chiaro anche per la barra del telefono. */
export const viewport: Viewport = {
  themeColor: "#f9fafb",
  colorScheme: "light",
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
 *
 * (Rilascio 10, §3.4) Una pagina fuori dalla dashboard (`share-view.tsx`): tema chiaro, il marchio piccolo in alto;
 * l'H1 è il titolo del caso d'uso, sotto la fase e «Quando»; «Il link vale 30 giorni». Il link che non vale, scaduto o
 * tolto, ha una scheda sola con la stessa frase. I testi stanno in `src/lib/use-cases/share-page.ts`.
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
  // Scaduto o tolto, la stessa scheda: chi ha il link non sa quale dei due.
  if (!workspace || !check.ok) return <ShareInvalid loginHref={loginHref(workspaceId, useCaseId)} />;

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
  const phase = phaseOfUseCase(row);
  // «Approvato» con «Quando» a parte; nelle altre fasi la pillola dice anche il sotto-stato.
  const shown = proposal && proposal.phase !== "approvato";

  return (
    <ShareCase
      title={proposal?.title ?? null}
      phaseText={shown ? proposal.phaseLabel : phase.phaseName}
      phase={phase.phase}
      subState={shown ? proposal.subState : null}
      quando={proposal?.quando ?? null}
      loginHref={loginHref(workspaceId, useCaseId)}
      validity={SHARE_PAGE_TEXT.validity(PORTFOLIO_SHARE_TTL_DAYS, shareExpiryDay(check.expiresAt))}
    />
  );
}

import { headers } from "next/headers";
import { UcAccessError, ensureUcAvailable, isUcEnabled } from "@/lib/db/queries/uc-access";
import { loadReferentPage } from "@/lib/db/queries/uc-public";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { publicCallEnv } from "@/lib/uc/http";
import type { ReferentView } from "@/lib/uc/public-view";
import { isUcWorkspaceEnabled } from "@/lib/uc/rollout";
import { looksLikeRequestToken } from "@/lib/uc/tokens";
import { InvalidLinkCard, ReferentShell, UnavailableCard } from "@/components/uc/referente/link-card";
import { ReferentePage } from "@/components/uc/referente/referente-page";

export const dynamic = "force-dynamic";

/**
 * Pagina del referente `/r/[token]` (DESIGN §4): pubblica, senza account,
 * pensata per il telefono. Mai `notFound()`: token sbagliato, scaduto o
 * revocato, sezione spenta (anche solo per il workspace del caso,
 * `UC_WORKSPACE_IDS`) danno sempre la stessa scheda «Questo link non è più
 * valido», resa qui con i metadati `noindex` del layout.
 *
 * Solo letture: niente `first_opened_at` e nessun evento su GET (l'apertura la
 * registra la pagina con `POST …/opened` dopo l'idratazione), così prefetch e
 * scanner dei link non lasciano tracce. Il passo (domanda, riepilogo…) sta
 * nell'hash dell'indirizzo, che non arriva mai qui.
 */

type Loaded = { kind: "non_valido" } | { kind: "non_disponibile" } | { kind: "vista"; view: ReferentView };

async function load(token: string): Promise<Loaded> {
  if (!isUcEnabled() || !looksLikeRequestToken(token)) return { kind: "non_valido" };
  try {
    await ensureUcAvailable();
  } catch (error) {
    if (error instanceof UcAccessError && error.code === "disattivata") return { kind: "non_valido" };
    return { kind: "non_disponibile" };
  }
  try {
    const executor = await getAppUcExecutor();
    const env = publicCallEnv(await headers(), process.env);
    const page = await loadReferentPage(executor, token, {
      now: new Date(),
      ...env,
      workspaceEnabled: (workspaceId) => isUcWorkspaceEnabled(workspaceId, { UC_WORKSPACE_IDS: process.env.UC_WORKSPACE_IDS, VERCEL_ENV: process.env.VERCEL_ENV }),
    });
    return page.access === "non_valido" ? { kind: "non_valido" } : { kind: "vista", view: page.view };
  } catch (error) {
    // Mai il token né i dati della richiesta nel log.
    console.error("[uc] pagina del referente non riuscita", error instanceof Error ? error.name : "errore");
    return { kind: "non_disponibile" };
  }
}

export default async function ReferentLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const loaded = await load(token);
  if (loaded.kind === "non_valido") {
    return (
      <ReferentShell>
        <InvalidLinkCard />
      </ReferentShell>
    );
  }
  if (loaded.kind === "non_disponibile") {
    return (
      <ReferentShell>
        <UnavailableCard />
      </ReferentShell>
    );
  }
  return <ReferentePage token={token} initialView={loaded.view} nowIso={new Date().toISOString()} />;
}

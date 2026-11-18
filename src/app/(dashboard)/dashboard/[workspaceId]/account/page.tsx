import { redirect } from "next/navigation";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { accountHref } from "@/lib/shell/account";

/**
 * `/dashboard/<ws>/account` (rilascio 10, PROPOSTA-10 §3.10, §3.12): l'indirizzo pulito di «Il tuo account › Claude e
 * terminale», per le e-mail alla persona («CLI collegata»), che non possono avere né `?` né `#` (`checkEmailLink`).
 * Controlla l'accesso come le altre pagine del workspace (chi non è nel workspace riceve «non trovata», chi segue solo
 * un corso va ai suoi corsi), poi porta alla Home con il foglio aperto su quella parte: lo stesso indirizzo del foglio.
 */
export default async function AccountRedirect({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  await requireWorkspacePage(workspaceId);
  redirect(accountHref(workspaceId, "claude"));
}

"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Terminal } from "lucide-react";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { Button } from "@/components/ui/button";
import { revokeOwnCliTokenAction } from "@/lib/actions/cli-tokens";
import type { CliTokenView } from "@/lib/db/queries/use-case-cli-auth";

const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" }).format(new Date(iso)) : null);

/**
 * «CLI di Unbundle» in Impostazioni (rilascio 8.0b): i collegamenti della persona in questo workspace, con
 * «Revoca». Mai il token: solo il prefisso, l'etichetta, l'ultimo uso e la scadenza. Ognuno vede solo i suoi.
 */
export function CliCard({ workspaceId, tokens }: { workspaceId: string; tokens: CliTokenView[] }) {
  const [pending, start] = useTransition();
  return (
    <SettingsSection
      icon={Terminal}
      title="CLI di Unbundle"
      description="Per lavorare dai coding agent sui casi dove sei nel team. Si collega con «unbundle login» dal repository del caso; vale 90 giorni."
    >
      {tokens.length ? (
        <ul className="divide-y rounded-md border">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.label}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{t.prefix}…</span>
                  {t.caseCode ? ` · solo ${t.caseCode}` : " · tutti i tuoi casi"}
                  {t.lastUsedAt ? ` · usato il ${day(t.lastUsedAt)}` : " · mai usato"}
                  {t.expiresAt ? ` · scade il ${day(t.expiresAt)}` : ""}
                </p>
              </div>
              <Button
                variant="outline"
                className="h-11 shrink-0 sm:h-8"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await revokeOwnCliTokenAction(workspaceId, t.id);
                    if (result.ok) toast.success(result.message);
                    else toast.error(result.message);
                  })
                }
              >
                Revoca
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nessuna CLI collegata a questo workspace.</p>
      )}
    </SettingsSection>
  );
}

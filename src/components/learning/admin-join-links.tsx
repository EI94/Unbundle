"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { AdminDetailDTO, AdminJoinLinkDTO } from "@/lib/learning/admin-contract";
import { learningAdminRequest } from "@/lib/learning/admin-client";
import type { AdminMutate } from "./admin-program";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AdminSection,
  AdminSelect,
  ConfirmAdminAction,
  adminDate,
} from "./admin-shared";

/**
 * Link di iscrizione per lezione.
 *
 * Due interruttori distinti, e vanno chiamati con nomi diversi perche'
 * confonderli e' il modo piu' facile per avere venti persone dentro il corso
 * che non riescono a rispondere:
 *   «Ingresso»  — ci si puo' iscrivere  (questo pannello)
 *   «Attivita'» — si puo' rispondere    (pannello Turni)
 */

function seatsLabel(link: AdminDetailDTO["joinLinks"][number]) {
  const left = Math.max(link.maxUses - link.usedCount, 0);
  return `${link.joined} ${link.joined === 1 ? "persona entrata" : "persone entrate"} · ${left} ${left === 1 ? "posto libero" : "posti liberi"} su ${link.maxUses}`;
}

function linkState(link: AdminDetailDTO["joinLinks"][number]) {
  if (link.revokedAt) return { label: "Disattivato", tone: "text-muted-foreground" };
  if (new Date(link.expiresAt) <= new Date())
    return { label: "Scaduto", tone: "text-muted-foreground" };
  if (!link.doorOpen) return { label: "Ingresso chiuso", tone: "text-amber-700 dark:text-amber-400" };
  return { label: "Ingresso aperto", tone: "text-emerald-700 dark:text-emerald-400" };
}

export function AdminJoinLinks({
  workspaceId,
  data,
  busy,
  mutate,
}: {
  workspaceId: string;
  data: AdminDetailDTO;
  busy: boolean;
  mutate: AdminMutate;
}) {
  const sessions = data.sessions.filter((session) => session.moduleId === "m1");
  const scope = { workspaceId, programId: data.program.id };
  const [cohortId, setCohortId] = useState("");
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState(30);
  const [hours, setHours] = useState(24);
  const [created, setCreated] = useState<AdminJoinLinkDTO | null>(null);
  const [copied, setCopied] = useState(false);
  const [projecting, setProjecting] = useState(false);
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cohortId) return;
    setError("");
    // L'idempotency key nasce con il submit: un doppio tocco non crea due link.
    const result = await learningAdminRequest({
      expectedUserId: data.userId,
      operation: "joinLink",
      input: {
        ...scope,
        cohortId,
        label: label.trim() || undefined,
        maxUses,
        expiresInHours: hours,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCreated(result.data);
    setLabel("");
    // Il riepilogo si aggiorna senza toccare il token appena mostrato.
    await mutate({ operation: "joinLinkDoor", input: { ...scope, linkId: result.data.linkId, doorOpen: false } });
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Copia non riuscita: seleziona l'indirizzo e copialo a mano.");
    }
  }

  return (
    <div className="space-y-6">
      <AdminSection title="Crea un link per una lezione">
        <p className="text-sm">
          Il link si manda in chat o si proietta come QR: chi lo apre entra con
          il proprio account e si trova dentro il corso, senza che tu debba
          assegnare nessuno a mano. Chi entra vede <strong>solo questo corso</strong>.
        </p>
        <p className="text-sm text-muted-foreground">
          Un link per lezione. Puoi crearne più di uno per la stessa lezione — uno
          per canale, uno per i ritardatari — e convergono tutti sulla stessa
          iscrizione.
        </p>

        <form onSubmit={create}>
          <fieldset disabled={busy} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="join-cohort">Lezione</Label>
              <AdminSelect
                id="join-cohort"
                name="cohortId"
                value={cohortId}
                onChange={(event) => setCohortId(event.target.value)}
                required
              >
                <option value="" disabled>
                  Scegli la lezione
                </option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.cohortId}>
                    {session.cohortId} · {adminDate(session.startsAt)}
                  </option>
                ))}
              </AdminSelect>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="join-label">Nome del link (facoltativo)</Label>
                <Input
                  id="join-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Es. aula, ritardatari"
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="join-seats">Posti</Label>
                <Input
                  id="join-seats"
                  type="number"
                  min={1}
                  max={500}
                  value={maxUses}
                  onChange={(event) => setMaxUses(Number(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="join-hours">Valido per (ore)</Label>
                <Input
                  id="join-hours"
                  type="number"
                  min={1}
                  max={720}
                  value={hours}
                  onChange={(event) => setHours(Number(event.target.value))}
                />
              </div>
            </div>

            <Button type="submit" disabled={!cohortId || sessions.length === 0}>
              Crea il link
            </Button>
            {sessions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nessuna lezione disponibile: importa un pacchetto con i turni
                prima di creare i link.
              </p>
            )}
          </fieldset>
        </form>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {created && (
          <div
            className="space-y-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4"
            data-testid="join-link-created"
          >
            <div>
              <p className="font-medium">Link pronto</p>
              <p className="mt-1 text-sm text-muted-foreground">
                L&apos;ingresso è <strong>chiuso</strong>: aprilo qui sotto
                all&apos;inizio della lezione. Questo indirizzo compare una volta
                sola — se lo perdi, crea un link nuovo.
              </p>
            </div>
            <code className="block overflow-x-auto rounded-lg border bg-background p-3 text-xs">
              {created.url}
            </code>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => copy(created.url)}>
                {copied ? "Copiato" : "Copia il link"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setProjecting((value) => !value)}
              >
                {projecting ? "Nascondi il QR" : "Mostra il QR da proiettare"}
              </Button>
            </div>
            {projecting && (
              <div className="space-y-2 rounded-xl bg-white p-6 text-center">
                <div
                  className="mx-auto w-full max-w-[320px] [&_svg]:h-auto [&_svg]:w-full"
                  // Generato dal server con la libreria qrcode: nessun input
                  // della persona finisce in questo markup.
                  dangerouslySetInnerHTML={{ __html: created.qrSvg }}
                />
                <p className="text-sm font-medium text-neutral-900">
                  Inquadra il QR per entrare nel corso
                </p>
              </div>
            )}
          </div>
        )}
      </AdminSection>

      <AdminSection title={`Link attivi (${data.joinLinks.length})`}>
        {data.joinLinks.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nessun link creato per questo corso.
          </p>
        )}
        <ul className="space-y-3">
          {data.joinLinks.map((link) => {
            const state = linkState(link);
            const reopens = link.reopenRequests.reduce((n, r) => n + r.count, 0);
            const closed = Boolean(link.revokedAt) || new Date(link.expiresAt) <= new Date();
            return (
              <li key={link.id} className="space-y-3 rounded-lg border p-4">
                <div>
                  <h3 className="font-medium">
                    {link.cohortId}
                    {link.label ? ` · ${link.label}` : ""}
                  </h3>
                  <p className={`mt-1 text-sm font-medium ${state.tone}`}>
                    {state.label}
                  </p>
                  <p className="text-sm text-muted-foreground">{seatsLabel(link)}</p>
                  <p className="text-sm text-muted-foreground">
                    Valido fino al {adminDate(link.expiresAt)}
                  </p>
                </div>

                {reopens > 0 && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <p className="font-medium">
                      {reopens}{" "}
                      {reopens === 1
                        ? "persona chiede di riaprire il proprio turno"
                        : "persone chiedono di riaprire il proprio turno"}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Hanno già del lavoro salvato su{" "}
                      {link.reopenRequests.map((r) => r.cohortId).join(", ")}: per
                      farle rispondere oggi riapri quel turno dal pannello Turni.
                    </p>
                  </div>
                )}

                {!closed && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={busy}
                      variant={link.doorOpen ? "outline" : "default"}
                      onClick={() =>
                        mutate({
                          operation: "joinLinkDoor",
                          input: { ...scope, linkId: link.id, doorOpen: !link.doorOpen },
                        })
                      }
                    >
                      {link.doorOpen ? "Chiudi l'ingresso" : "Apri l'ingresso"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        mutate({
                          operation: "joinLinkSeats",
                          input: { ...scope, linkId: link.id, maxUses: link.maxUses + 20 },
                        })
                      }
                    >
                      Aggiungi 20 posti
                    </Button>
                    <ConfirmAdminAction
                      busy={busy}
                      label="Disattiva il link"
                      description={`Disattivare questo link per ${link.cohortId}? Chi è già entrato mantiene l'accesso al corso; chi riceve il link da ora non potrà più iscriversi.`}
                      onConfirm={() =>
                        mutate({
                          operation: "revokeJoinLink",
                          input: { ...scope, linkId: link.id },
                        })
                      }
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </AdminSection>
    </div>
  );
}

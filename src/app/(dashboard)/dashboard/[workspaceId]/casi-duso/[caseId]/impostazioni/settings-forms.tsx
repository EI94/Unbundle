"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { updateCaseSettingsAction } from "@/lib/actions/uc-cases";
import { revokeAllLinksAction } from "@/lib/actions/uc-people";
import { changeStartingSchemaAction } from "@/lib/actions/uc-reschema";
import { SCHEMA_CHANGE_TEXT as S, SETTINGS_TEXT as T, schemaBlockReasons, schemaBlockersShown, type SchemaBlockReason } from "@/lib/uc/views/case-settings";
import { START_TEMPLATE_TEXT, type StartTemplateOption } from "@/lib/uc/views/start-templates";

const FIELD = "h-11 text-base sm:h-9 sm:text-sm";

/**
 * «La realizzazione» (rilascio 10, §3.5; DESIGN §3.13.3): nome, frase e perimetro, con un solo «Salva». Il codice non
 * si modifica qui: lo mostra la pagina in «Dettagli tecnici». Le leve si cambiano in Valore.
 */
export function CaseIdentityForm({
  workspaceId,
  caseId,
  title,
  oneLiner,
  perimeterLabel,
}: {
  workspaceId: string;
  caseId: string;
  title: string;
  oneLiner: string | null;
  perimeterLabel: string | null;
}) {
  const { pending, run } = useUcAction();
  const [name, setName] = useState(title);
  const [line, setLine] = useState(oneLiner ?? "");
  const [perimeter, setPerimeter] = useState(perimeterLabel ?? "");
  const dirty = name.trim() !== title || line.trim() !== (oneLiner ?? "") || perimeter.trim() !== (perimeterLabel ?? "");
  return (
    <form
      className="grid max-w-2xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateCaseSettingsAction(workspaceId, caseId, { title: name.trim(), oneLiner: line.trim() || null, perimeterLabel: perimeter.trim() || null }));
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="uc-settings-title">{T.name}</Label>
        <Input id="uc-settings-title" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} className={FIELD} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="uc-settings-line">{T.oneLiner}</Label>
        <Textarea id="uc-settings-line" value={line} maxLength={500} rows={2} onChange={(e) => setLine(e.target.value)} className="text-base sm:text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="uc-settings-perimeter">{T.perimeter}</Label>
        <Input id="uc-settings-perimeter" value={perimeter} maxLength={255} placeholder={T.perimeterPlaceholder} onChange={(e) => setPerimeter(e.target.value)} className={FIELD} />
      </div>
      <div>
        <Button type="submit" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending || !dirty || name.trim().length < 3}>
          {T.save}
        </Button>
      </div>
    </form>
  );
}

/**
 * «Revoca i link» (Zona pericolosa): in un colpo solo i link dei referenti, quelli di approvazione e gli accessi di
 * Claude alla realizzazione. Resta anche in pausa: serve quando un link è finito nelle mani sbagliate.
 */
export function RevokeAllLinks({ workspaceId, caseId }: { workspaceId: string; caseId: string }) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button variant="outline" className="min-h-11 text-destructive hover:text-destructive sm:min-h-8" onClick={() => setOpen(true)}>
        {T.revoke}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{T.revokeTitle}</DialogTitle>
            <DialogDescription>{T.revokeBody}</DialogDescription>
          </DialogHeader>
          <form
            id="uc-revoke-all"
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => revokeAllLinksAction(workspaceId, caseId, { reason: reason.trim() || null }), {
                onSuccess: () => {
                  setOpen(false);
                  setReason("");
                },
              });
            }}
          >
            <Label htmlFor="uc-revoke-all-reason">{T.reasonOptional}</Label>
            <Textarea id="uc-revoke-all-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={T.reasonPlaceholder} className="text-base sm:text-sm" />
          </form>
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-8" onClick={() => setOpen(false)}>
              Annulla
            </Button>
            <Button type="submit" form="uc-revoke-all" variant="destructive" className="h-11 sm:h-8" disabled={pending}>
              {T.revokeConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Una domanda che impedisce il cambio di schema, con i suoi motivi. */
export interface SchemaBlocker {
  itemId: string;
  title: string;
  reasons: SchemaBlockReason[];
}

/**
 * «Cambia schema di partenza…» (R3 di `docs/dossier/SCHEMA-DI-PARTENZA.md`), in «La realizzazione», solo in «Bozza» e
 * per chi modifica le impostazioni. Un pulsante secondario apre il dialogo: con domande che bloccano le elenca e non
 * conferma; altrimenti si sceglie lo schema («Dal caso d'uso» per primo, gli schemi di settore che combaciano, gli
 * altri a richiesta), con quello che si rifà e quello che resta. Lo schema di adesso non ha niente da confermare.
 */
export function ChangeStartingSchema({
  workspaceId,
  caseId,
  currentId,
  proposed,
  others,
  preselectedId,
  blockers,
}: {
  workspaceId: string;
  caseId: string;
  currentId: string;
  proposed: readonly StartTemplateOption[];
  others: readonly StartTemplateOption[];
  preselectedId: string | null;
  blockers: readonly SchemaBlocker[];
}) {
  const { pending, run } = useUcAction();
  const [open, setOpen] = useState(false);
  const all = [...proposed, ...others];
  const initial = all.find((t) => t.id === preselectedId && !t.restricted) ?? null;
  const [templateId, setTemplateId] = useState<string | null>(initial?.id ?? null);
  const [showOthers, setShowOthers] = useState(proposed.length === 0 || others.some((t) => t.id === currentId));
  const chosen = all.find((t) => t.id === templateId) ?? null;
  const blocked = blockers.length > 0;
  const same = chosen !== null && chosen.id === currentId;
  const { shown, more } = schemaBlockersShown(blockers);

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setTemplateId(initial?.id ?? null);
      setShowOthers(proposed.length === 0 || others.some((t) => t.id === currentId));
    }
  }

  function toggleOthers() {
    if (showOthers && others.some((t) => t.id === templateId)) setTemplateId(initial?.id ?? null);
    setShowOthers(!showOthers);
  }

  function confirm() {
    if (!chosen || same || blocked || pending) return;
    run(() => changeStartingSchemaAction(workspaceId, caseId, chosen.fromUseCase ? { to: "dal_caso" } : { templateId: chosen.id }), { onSuccess: () => close(false) });
  }

  const option = (t: StartTemplateOption) => (
    <label
      key={t.id}
      className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted has-checked:border-uc-blu has-checked:bg-uc-blu-bg has-disabled:cursor-not-allowed has-disabled:opacity-70"
    >
      <input
        type="radio"
        name="uc-settings-schema"
        value={t.id}
        checked={templateId === t.id}
        onChange={() => setTemplateId(t.id)}
        disabled={pending}
        className="mt-0.5 size-4 shrink-0 accent-uc-blu"
      />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-sm break-words">{t.name}</span>
        <span className="text-xs text-muted-foreground">{t.line}</span>
      </span>
    </label>
  );

  return (
    <div className="min-w-0 space-y-2">
      <Button variant="outline" className="min-h-11 sm:min-h-8" onClick={() => setOpen(true)}>
        {S.open}
      </Button>
      {blocked && <p className="text-sm text-muted-foreground">{S.blockedLine(blockers.length)}</p>}
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{S.dialogTitle}</DialogTitle>
            <DialogDescription>{blocked ? S.blockedLine(blockers.length) : S.dialogBody}</DialogDescription>
          </DialogHeader>
          {blocked ? (
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium">{S.blockedTitle(blockers.length)}</p>
              <ul className="grid min-w-0 gap-1.5 text-sm">
                {shown.map((b) => (
                  <li key={b.itemId} className="min-w-0 break-words">
                    {b.title || S.untitled}
                    <span className="text-muted-foreground"> · {schemaBlockReasons(b.reasons)}</span>
                  </li>
                ))}
              </ul>
              {more > 0 && <p className="text-sm text-muted-foreground">{S.blockedMore(more)}</p>}
            </div>
          ) : (
            <div className="min-w-0 space-y-3">
              <p id="uc-settings-schema-label" className="text-sm font-medium">
                {S.choose}
              </p>
              <div role="radiogroup" aria-labelledby="uc-settings-schema-label" className="grid min-w-0 gap-2">
                {proposed.map(option)}
                {showOthers && others.length > 0 && (
                  <>
                    {proposed.length > 0 && <p className="pt-1 text-xs text-muted-foreground">{START_TEMPLATE_TEXT.othersHint}</p>}
                    {others.map(option)}
                  </>
                )}
              </div>
              {others.length > 0 && proposed.length > 0 && (
                <Button type="button" variant="ghost" className="h-11 px-2 sm:h-8" onClick={toggleOthers} disabled={pending} aria-expanded={showOthers}>
                  {showOthers ? START_TEMPLATE_TEXT.hideOthers(others.length) : START_TEMPLATE_TEXT.showOthers(others.length)}
                </Button>
              )}
              {!chosen ? (
                <p className="text-sm text-muted-foreground">{S.invalid}</p>
              ) : same ? (
                <p className="text-sm" role="status">
                  {S.same}
                </p>
              ) : (
                <div className="space-y-1 text-sm">
                  <p>{S.rebuilt}</p>
                  <p className="text-muted-foreground">{S.kept}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-8" onClick={() => close(false)}>
              {S.cancel}
            </Button>
            {blocked ? (
              <Button className="h-11 sm:h-8" disabled>
                {S.confirm}
              </Button>
            ) : chosen && !same ? (
              <Button className="h-11 sm:h-8" onClick={confirm} disabled={pending}>
                {S.confirm}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

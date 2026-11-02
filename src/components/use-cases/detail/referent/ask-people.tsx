"use client";

import type { KeyboardEvent, RefObject } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Input } from "@/components/ui/input";
import type { ReferentContactOption, ReferentGate, ReferentMemberOption, UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import { REFERENT_UI_TEXT } from "@/lib/use-cases/referent/labels";
import { cn } from "@/lib/utils";
import { NEW_CONTACT, contactRowLine, memberRowLine, memberValue, type AskDraft } from "./ask-dialog-state";
import { Field, describedBy } from "./fields";

const T = REFERENT_UI_TEXT.askDialog;

/** Le persone del workspace lette quando la finestra si apre: in arrivo, pronte, o non arrivate. */
export interface AskPeopleList {
  state: "loading" | "ready" | "failed";
  members: readonly ReferentMemberOption[];
}

export interface AskPeopleIds {
  heading: string;
  error: string;
  name: string;
  email: string;
  role: string;
}

/**
 * Il cerchio di una scelta: le classi di `DecisionChoiceGroup` (`reopen-dialog.tsx`), già provate nei
 * due temi; spento con il motivo nella riga visibile.
 */
const RADIO_CLASS =
  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/70 bg-background outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-primary data-disabled:opacity-50";

/** Invio su una scelta manda il passo (Base UI lo ferma sul cerchio). */
function submitOnEnter(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Enter" || (event.target as HTMLElement).getAttribute("role") !== "radio") return;
  event.preventDefault();
  (event.currentTarget.closest("form") as HTMLFormElement | null)?.requestSubmit();
}

function Choice({ value, name, line, disabled }: { value: string; name: string; line: string | null; disabled?: boolean }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/50 sm:min-h-9 sm:py-1.5", disabled && "cursor-not-allowed hover:bg-transparent")}>
      <Radio.Root value={value} disabled={disabled} className={RADIO_CLASS}>
        <Radio.Indicator className="size-1.5 rounded-full bg-primary-foreground" />
      </Radio.Root>
      <span className="min-w-0 break-words">
        <span className={cn("block text-sm font-medium", disabled && "text-muted-foreground")}>{name}</span>
        {line ? <span className="block text-xs text-muted-foreground">{line}</span> : null}
      </span>
    </label>
  );
}

/**
 * «A chi» (rilascio 4, §6): i referenti, le persone del workspace (membri e partecipanti ai corsi,
 * senza niente che li distingua) e «Una persona nuova», in una sola scelta. Nessun conteggio accanto a
 * una persona. Il motivo che blocca l'invio, se c'è, in una riga in cima.
 */
export function AskPeopleStep({
  ids,
  headingRef,
  notice,
  contacts,
  people,
  draft,
  errors,
  limits,
  selfHint,
  otherHint,
  onChoice,
  onField,
}: {
  ids: AskPeopleIds;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  notice: ReferentGate | null;
  contacts: readonly ReferentContactOption[];
  people: AskPeopleList;
  draft: Pick<AskDraft, "choice" | "name" | "email" | "role">;
  errors: Readonly<Record<string, string>>;
  limits: UseCaseReferentPanel["limits"];
  selfHint: string | null;
  otherHint: string | null;
  onChoice: (value: string) => void;
  onField: (key: "name" | "email" | "role", value: string) => void;
}) {
  const members = people.state === "failed" ? [] : people.members;
  // I titoli dei gruppi solo quando ci sono sia referenti sia persone del workspace (§6).
  const grouped = members.length > 0;
  const isNew = draft.choice === NEW_CONTACT;
  const contactError = errors.contact || null;
  return (
    <div data-slot="ask-people" className="space-y-3">
      <h3 id={ids.heading} ref={headingRef} tabIndex={-1} className="rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {T.whoLabel}
      </h3>
      <p className="text-sm text-muted-foreground">{T.whoLead}</p>
      {notice ? (
        <p data-slot="ask-notice" data-gate={notice.code} className="text-sm break-words text-muted-foreground">
          {notice.message}
        </p>
      ) : null}
      <RadioGroup<string | null>
        value={draft.choice}
        onValueChange={(next) => {
          if (typeof next === "string") onChoice(next);
        }}
        aria-labelledby={ids.heading}
        aria-invalid={contactError ? true : undefined}
        aria-describedby={contactError ? ids.error : undefined}
        onKeyDown={submitOnEnter}
        className="grid gap-0.5"
      >
        {contacts.length && grouped ? <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">{T.contactsGroup}</p> : null}
        {contacts.map((option) => (
          <Choice key={option.id} value={option.id} name={option.displayName} line={contactRowLine(option) || null} disabled={!option.selectable} />
        ))}
        {grouped ? <p className="px-2 pt-2 text-xs font-medium text-muted-foreground">{T.membersGroup}</p> : null}
        {people.state === "loading" && members.length === 0 ? (
          <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
            {T.peopleLoading}
          </p>
        ) : null}
        {members.map((member) => (
          <Choice key={member.userId} value={memberValue(member.userId)} name={member.displayName} line={memberRowLine(member) || null} />
        ))}
        {people.state === "failed" ? (
          <p role="status" className="px-2 py-1 text-xs break-words text-muted-foreground">
            {T.peopleFailed}
          </p>
        ) : null}
        <div className={grouped || contacts.length ? "pt-1" : undefined}>
          <Choice value={NEW_CONTACT} name={T.newPerson} line={null} />
        </div>
      </RadioGroup>
      {contactError ? (
        <p id={ids.error} role="alert" className="text-xs text-destructive">
          {contactError}
        </p>
      ) : null}
      {isNew ? (
        <div data-slot="ask-new-person" className="grid gap-3 rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">{T.newHint}</p>
          <Field id={ids.name} label={T.newName} error={errors.displayName}>
            <Input
              id={ids.name}
              value={draft.name}
              autoComplete="off"
              maxLength={limits.contactNameMax}
              aria-invalid={errors.displayName ? true : undefined}
              aria-describedby={describedBy(ids.name, null, errors.displayName)}
              className="min-h-11 sm:min-h-8"
              onChange={(event) => onField("name", event.target.value)}
            />
          </Field>
          <Field id={ids.email} label={T.newEmail} error={errors.email}>
            <Input
              id={ids.email}
              type="email"
              inputMode="email"
              autoComplete="off"
              value={draft.email}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={describedBy(ids.email, null, errors.email)}
              className="min-h-11 sm:min-h-8"
              onChange={(event) => onField("email", event.target.value)}
            />
          </Field>
          <Field id={ids.role} label={T.newRole} error={errors.roleLabel}>
            <Input id={ids.role} value={draft.role} autoComplete="off" maxLength={limits.roleLabelMax} className="min-h-11 sm:min-h-8" onChange={(event) => onField("role", event.target.value)} />
          </Field>
        </div>
      ) : null}
      {selfHint ? (
        <p role="note" className="text-xs text-muted-foreground">
          {selfHint}
        </p>
      ) : null}
      {otherHint ? <p className="text-xs break-words text-muted-foreground">{otherHint}</p> : null}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Lock, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Issue } from "@/lib/uc/answers/issues";
import type { ReferentItemView } from "@/lib/uc/public-view";
import { choiceList, fieldIssues, otherIssues, SOURCE_CHIP_TYPES, toggleSource, valueFrom, type ReferentForm, type ReferentIntent } from "@/lib/uc/views/referente-form";
import { R_TEXT } from "@/lib/uc/views/referente-text";
import { isHeavyResponseType } from "@/lib/uc/request-state";
import { AnswerInput, isFileType } from "./answer-input";
import { AttachmentField, type AttachmentRef } from "./attachment-field";
import { DeclaredValue } from "./declared-value";
import { DontKnowPanel } from "./dont-know-panel";
import { ExcelImport } from "./excel-import";
import { Field, FieldErrors, TextControl } from "./inputs/fields";
import { MoreOptions, type MoreOptionsState } from "./more-options";
import { Disclosure, Notice, PRIMARY_CLASS, SECONDARY_CLASS, ScreenTitle, TEXT_BUTTON_CLASS } from "./screen";
import { ActionBar } from "./step-bar";

/**
 * R2 · Una domanda per schermata (DESIGN §4.3):
 * - R2a, valore già dichiarato che il referente vede: «È così» (primario),
 *   «Correggi», «Non lo so» testuale; con «Valido dal» obbligatorio, «Da
 *   quando vale?» prima;
 * - R2b, valore da scrivere: l'input del tipo, «▸ Altre opzioni» (con dentro
 *   «Da dove viene?» sui numeri e sulle date) e la barra «Non lo so» · «Avanti»;
 * - R2c, tabelle e file al telefono: «È più comodo dal computer», con «Compila
 *   qui, riga per riga» (editor a schede), «Carica un Excel» (il file resta
 *   allegato e le sue righe riempiono la tabella da controllare) e il modello;
 * - R2d, dato personale: niente bozza, parte solo con «Invia»;
 * - R3, «Non lo so»: un pannello al posto della barra.
 * Sì/no e scelta singola: un tocco salva e passa avanti, come «È così».
 *
 * (Rilascio 10, §3.11) Le parole del kit del referente (`referente-text.ts`):
 * «Avanti» senza la freccia, «Non lo so», «Chiedi a un'altra persona». Tre
 * controlli per domanda: il campo, «Non lo so» e «Altre opzioni», dove ora sta
 * anche la fonte del dato. In «È più comodo dal computer» il pulsante pieno è
 * «Rispondi dopo»; senza «Rispondi dopo» (una domanda da sola) lo è «Compila
 * qui».
 */

export interface QuestionStepProps {
  item: ReferentItemView;
  token: string;
  form: ReferentForm;
  attachments: AttachmentRef[];
  issues: readonly Issue[];
  busy: boolean;
  /** Sotto i 768 px: tabelle e file propongono il computer, la tabella è a schede. */
  narrow: boolean;
  /** «Avanti», «Rivedi e invia» sull'ultima domanda, «Invia» quando parte subito. */
  primaryLabel: string;
  /** La risposta parte subito (dato personale, aggiornamento di una risposta). */
  immediate: boolean;
  /** R5 per questa domanda, oppure null se la delega non è ammessa. */
  delegateHref: string | null;
  onForm: (next: ReferentForm) => void;
  onAttachments: (next: AttachmentRef[]) => void;
  /** «Avanti» o «Invia» con la decisione presa. */
  onNext: (intent: ReferentIntent) => void;
  /** «È così» sul valore già noto. */
  onConfirm: () => void;
  /** «Rispondi dopo», se il passo lo ammette. */
  onSkip: (() => void) | null;
  /** Un tocco su sì/no o su una scelta: salva e passa avanti. */
  onPicked: () => void;
  /** (Rilascio 10) Se la schermata «È più comodo dal computer» è in vista: la barra in alto toglie il suo «Rispondi dopo». */
  onGate?: (itemId: string, shown: boolean) => void;
}

const EXTRA_FIELDS = ["note", "valid_from", "who_might_know", "reason", "source_basis"];
const MAX_INLINE = 140;

/** Il valore già dichiarato si conferma con un tocco (R2a): visibile, nel formato giusto, e non una nuova versione. */
function isConfirmable(item: ReferentItemView): boolean {
  const declared = item.toConfirm;
  return declared !== null && declared.canConfirm && declared.display !== null && !item.can.newVersionOnly;
}

/**
 * (Rilascio 10) La domanda si apre su «È più comodo dal computer»: tabella o file al telefono, senza «Non lo so» già
 * scelto, quando non c'è prima una risposta già a posto o un valore da confermare. La stessa regola del passo, con lo
 * stato di partenza (prima di «Compila qui», «Correggi» o «Non lo so»).
 */
export function opensOnComputerGate(item: ReferentItemView, form: ReferentForm | undefined, narrow: boolean): boolean {
  if (!narrow || !isHeavyResponseType(item.responseType) || form?.intent === "non_so") return false;
  if (item.can.newVersionOnly) return false;
  return !(isConfirmable(item) && form?.confirmMode !== "correzione");
}

/** Perché ed esempio: in linea se brevi, altrimenti in «▸ Esempio e dove trovarlo». */
function explanationParts(item: ReferentItemView): { inline: string | null; more: { label: string | null; text: string }[] } {
  const lead = item.why ?? item.explanation;
  const exampleText = item.example ? `${R_TEXT.question.example} ${item.example}` : null;
  const both = [lead, exampleText].filter(Boolean).join(" ");
  const more: { label: string | null; text: string }[] = [];
  let inline: string | null = null;
  if (both && both.length <= MAX_INLINE) inline = both;
  else {
    inline = lead;
    if (item.example) more.push({ label: R_TEXT.question.example, text: item.example });
  }
  if (item.why && item.explanation) more.unshift({ label: null, text: item.explanation });
  if (item.help) more.push({ label: R_TEXT.question.where, text: item.help });
  return { inline, more };
}

function ExampleDetails({ parts }: { parts: { label: string | null; text: string }[] }) {
  if (parts.length === 0) return null;
  return (
    <Disclosure summary={R_TEXT.question.exampleFold}>
      <div className="space-y-2 text-base leading-6 break-words text-muted-foreground">
        {parts.map((p, i) => (
          <p key={i}>
            {p.label ? <span className="font-medium text-foreground">{p.label} </span> : null}
            {p.text}
          </p>
        ))}
      </div>
    </Disclosure>
  );
}

/** Scelta che passa avanti con un tocco: sì/no e scelte singole con pochi pulsanti (non il menu). */
function isTapChoice(item: ReferentItemView): boolean {
  if (item.responseType === "si_no") return true;
  return item.responseType === "scelta" && choiceList(item.config).length <= 8;
}

export function QuestionStep(props: QuestionStepProps) {
  const { item, token, form, attachments, issues, busy, narrow, primaryLabel, immediate, delegateHref, onForm, onAttachments, onNext, onConfirm, onSkip, onPicked, onGate } = props;
  const id = `uc-${item.id}`;
  const [dontKnow, setDontKnow] = useState(form.intent === "non_so");
  const [correcting, setCorrecting] = useState(form.confirmMode === "correzione");
  const [heavyOpen, setHeavyOpen] = useState(false);
  const [excelOpen, setExcelOpen] = useState(false);
  /** Dopo «Carica un Excel»: quante righe ha letto e da quale file, sopra la tabella da controllare. */
  const [imported, setImported] = useState<string | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [open, setOpen] = useState<MoreOptionsState>({ note: form.note.trim() !== "", attach: false, na: form.intent === "non_si_applica" });
  const pointerAt = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<ReferentForm>) => onForm({ ...form, ...patch });

  // Errori: il focus va al primo campo sbagliato (DESIGN §4.7).
  useEffect(() => {
    if (issues.length === 0) return;
    const first = container.current?.querySelector<HTMLElement>("[aria-invalid='true']");
    first?.focus();
  }, [issues]);

  const declared = item.toConfirm;
  const confirmable = isConfirmable(item);
  const prose = declared !== null && !declared.canConfirm && declared.display !== null;
  const heavy = isHeavyResponseType(item.responseType);
  const fileType = isFileType(item.responseType);
  const attachInView = fileType || item.attachmentHint !== null || attachments.length > 0;
  const explain = explanationParts(item);
  const validIssues = fieldIssues(issues, "valid_from");
  const general = issues.filter((i) => !i.field);
  const inputIssues = otherIssues(
    issues.filter((i) => i.field),
    EXTRA_FIELDS,
  );

  // R2c: tabelle e file al telefono, se prima non c'è una risposta già a posto o un valore da confermare.
  const heavyGate = !(item.can.newVersionOnly && !updateOpen) && !(confirmable && !correcting) && narrow && heavy && !heavyOpen && !dontKnow;
  useEffect(() => {
    onGate?.(item.id, heavyGate);
  }, [heavyGate, item.id, onGate]);

  const primary = () => onNext(open.na ? "non_si_applica" : "risposta");
  const notKnownButton = item.can.notKnown ? (
    <Button type="button" variant="outline" className={SECONDARY_CLASS} disabled={busy} onClick={() => setDontKnow(true)}>
      {R_TEXT.actions.notKnown}
    </Button>
  ) : null;

  const validFromField = item.requiresValidFrom ? (
    <Field label={R_TEXT.question.validFrom} htmlFor={`${id}-valid-from`} issues={validIssues} hint={R_TEXT.question.validFromHint} className="max-w-64">
      <TextControl id={`${id}-valid-from`} type="date" value={form.validFrom} onChange={(v) => set({ validFrom: v })} disabled={busy} invalid={validIssues.length > 0} />
    </Field>
  ) : null;

  const header = (
    <div className="space-y-2">
      <ScreenTitle size="question">{item.title}</ScreenTitle>
      {explain.inline ? <p className="line-clamp-3 text-[15px] leading-6 break-words text-muted-foreground">{explain.inline}</p> : null}
    </div>
  );

  const dontKnowBlock = (
    <>
      <DontKnowPanel id={id} who={form.whoMightKnow} issues={issues} disabled={busy} delegateHref={delegateHref} onWho={(v) => set({ whoMightKnow: v })} />
      <ActionBar>
        <Button
          type="button"
          variant="outline"
          className="h-12 flex-1 text-base"
          disabled={busy}
          onClick={() => {
            // «Non lo so» non vale più: la domanda torna da rispondere, anche nella bozza.
            setDontKnow(false);
            if (form.intent === "non_so") onForm({ ...form, intent: null });
          }}
        >
          {R_TEXT.actions.cancel}
        </Button>
        <Button type="button" className="h-12 flex-1 text-base" disabled={busy} onClick={() => onNext("non_so")}>
          {immediate ? R_TEXT.actions.send : R_TEXT.actions.next}
        </Button>
      </ActionBar>
    </>
  );

  // Risposta già a posto: «La tua risposta: … · A posto» e il link per aggiornarla.
  if (item.can.newVersionOnly && !updateOpen) {
    return (
      <div ref={container} className="space-y-5">
        {header}
        <p className="text-base break-words">
          {R_TEXT.question.yourAnswer} <span className="font-medium">{item.ownAnswer?.display ?? R_TEXT.question.sentFallback}</span> · {R_TEXT.question.allSet}
        </p>
        <Button type="button" variant="ghost" className={TEXT_BUTTON_CLASS} onClick={() => setUpdateOpen(true)}>
          {R_TEXT.question.updateAnswer}
        </Button>
      </div>
    );
  }

  // R2a: il valore già dichiarato, confermabile con un tocco.
  if (confirmable && !correcting) {
    return (
      <div ref={container} className="space-y-5">
        {header}
        <DeclaredValue declared={declared!} id={id} />
        <p className="text-base font-medium">{R_TEXT.question.stillTrue}</p>
        {validFromField}
        <FieldErrors issues={general} />
        {dontKnow ? (
          dontKnowBlock
        ) : (
          <div className="space-y-2">
            <Button type="button" className={PRIMARY_CLASS} disabled={busy || (item.requiresValidFrom && !form.validFrom)} onClick={onConfirm}>
              {R_TEXT.actions.confirm}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={SECONDARY_CLASS}
              disabled={busy}
              onClick={() => {
                setCorrecting(true);
                onForm({ ...form, intent: null, confirmMode: "correzione", value: valueFrom(item.responseType, item.config, declared!.value) });
              }}
            >
              {R_TEXT.actions.correct}
            </Button>
            {item.can.notKnown ? (
              <div className="text-center sm:text-left">
                <Button type="button" variant="ghost" className={TEXT_BUTTON_CLASS} disabled={busy} onClick={() => setDontKnow(true)}>
                  {R_TEXT.actions.notKnown}
                </Button>
              </div>
            ) : null}
          </div>
        )}
        <ExampleDetails parts={explain.more} />
      </div>
    );
  }

  // R2c: tabelle e file al telefono. Il pulsante pieno è «Rispondi dopo»; senza, «Compila qui».
  if (heavyGate) {
    const table = item.responseType === "tabella";
    const later = onSkip !== null;
    return (
      <div ref={container} className="space-y-5">
        {header}
        <div className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <Monitor className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-base font-medium">{R_TEXT.heavy.title}</p>
            <p className="text-base text-muted-foreground">{R_TEXT.heavy.text}</p>
          </div>
        </div>
        <div className="space-y-2">
          <Button type="button" variant={later ? "outline" : "default"} className={later ? SECONDARY_CLASS : PRIMARY_CLASS} onClick={() => setHeavyOpen(true)}>
            {table ? R_TEXT.heavy.fillTable : fileType ? R_TEXT.heavy.uploadFile : R_TEXT.heavy.fill}
          </Button>
          {table ? (
            <Button type="button" variant="outline" className={SECONDARY_CLASS} aria-expanded={excelOpen} onClick={() => setExcelOpen((v) => !v)}>
              {R_TEXT.heavy.excel}
            </Button>
          ) : null}
          {table && excelOpen ? (
            <ExcelImport
              token={token}
              item={item}
              attachments={attachments}
              disabled={busy}
              onAttachments={onAttachments}
              onImported={({ grid, fileName, note }) => {
                // La tabella si riempie dal file: la si controlla nell'editor, poi «Avanti».
                onForm({ ...form, value: grid, intent: null });
                setImported(R_TEXT.question.imported(grid.rows.length, fileName, note));
                setHeavyOpen(true);
              }}
            />
          ) : null}
          {table ? (
            <div className="text-center sm:text-left">
              <a
                href={`/api/r/${encodeURIComponent(token)}/items/${encodeURIComponent(item.id)}/template.xlsx`}
                download
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 text-base text-primary underline-offset-4 hover:underline"
              >
                <Download className="size-4" aria-hidden />
                {R_TEXT.heavy.template}
              </a>
            </div>
          ) : null}
        </div>
        <ActionBar>
          {item.can.notKnown ? (
            <Button type="button" variant="outline" className="h-12 flex-1 text-base" onClick={() => setDontKnow(true)}>
              {R_TEXT.actions.notKnown}
            </Button>
          ) : null}
          {onSkip ? (
            <Button type="button" className="h-12 flex-1 text-base" onClick={onSkip}>
              {R_TEXT.step.later}
            </Button>
          ) : null}
        </ActionBar>
      </div>
    );
  }

  // R2b e R2d: il valore da scrivere.
  return (
    <form
      noValidate
      onSubmit={(e) => {
        // Invio equivale ad «Avanti» (DESIGN §4.7), anche nel pannello «Non lo so».
        e.preventDefault();
        if (busy) return;
        if (dontKnow) onNext("non_so");
        else primary();
      }}
    >
      <div ref={container} className="space-y-5">
        {header}
        {prose ? (
          <>
            <DeclaredValue declared={declared} id={id} />
            <p className="text-base text-muted-foreground">{R_TEXT.question.checkFormat}</p>
            {declared.missing.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-base text-muted-foreground">
                {[...new Set(declared.missing.map((m) => m.message))].map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        {correcting && confirmable ? (
          <div className="space-y-1">
            <p className="text-base break-words text-muted-foreground">
              {R_TEXT.question.alreadyToldLine} <span className="text-foreground">{declared!.display}</span>
            </p>
            <Button
              type="button"
              variant="ghost"
              className={TEXT_BUTTON_CLASS}
              onClick={() => {
                setCorrecting(false);
                onForm({ ...form, confirmMode: null, intent: null });
              }}
            >
              {R_TEXT.actions.undoCorrection}
            </Button>
          </div>
        ) : null}
        {imported ? (
          <Notice tone="ok" className="mt-0">
            {imported}
          </Notice>
        ) : null}
        {item.personal ? (
          <p className="flex items-start gap-2 rounded-xl bg-uc-lucchetto-bg px-4 py-3 text-base break-words">
            <Lock className="mt-1 size-4 shrink-0" aria-hidden />
            <span className="min-w-0">{R_TEXT.question.personal}</span>
          </p>
        ) : null}

        <div
          onPointerDown={() => {
            pointerAt.current = Date.now();
          }}
        >
          <AnswerInput
            type={item.responseType}
            id={id}
            config={item.config}
            value={form.value}
            onChange={(value) => {
              // Un valore nuovo toglie «È così», «Non lo so» e «Non si applica»: decide «Avanti».
              onForm({ ...form, value, intent: form.intent === "risposta" ? "risposta" : null });
              if (isTapChoice(item) && !item.personal && !immediate && Date.now() - pointerAt.current < 1500) {
                const option = choiceList(item.config).find((o) => value && typeof value === "object" && !Array.isArray(value) && o.value === value.option);
                if (!option?.other) onPicked();
              }
            }}
            issues={inputIssues}
            disabled={busy || dontKnow}
            label={item.title}
            token={token}
            itemId={item.id}
            attachments={attachments}
            onAttachmentsChange={onAttachments}
            attachmentHint={item.attachmentHint}
            personal={item.personal}
            tableLayout={narrow ? "cards" : "grid"}
          />
        </div>

        {!fileType && attachInView ? (
          <AttachmentField token={token} itemId={item.id} value={attachments} onChange={onAttachments} hint={item.attachmentHint} personal={item.personal} disabled={busy} />
        ) : null}

        {validFromField}

        <MoreOptions
          id={id}
          item={item}
          token={token}
          form={form}
          attachments={attachments}
          issues={issues}
          disabled={busy}
          open={open}
          delegateHref={delegateHref}
          attachInView={attachInView}
          source={SOURCE_CHIP_TYPES.includes(item.responseType ?? "testo") ? { value: form.sourceBasis, onToggle: (b) => onForm(toggleSource(form, b)) } : null}
          onForm={(patch) => set(patch)}
          onAttachments={onAttachments}
          onOpen={(patch) => setOpen((o) => ({ ...o, ...patch }))}
        />
        <ExampleDetails parts={explain.more} />
        <FieldErrors issues={general} />

        {dontKnow ? (
          dontKnowBlock
        ) : (
          <ActionBar>
            {notKnownButton ? <div className="flex-1 sm:flex-none">{notKnownButton}</div> : null}
            <Button type="submit" className="h-12 flex-1 text-base sm:flex-none sm:min-w-48" disabled={busy}>
              {open.na ? (immediate ? R_TEXT.actions.send : R_TEXT.actions.next) : primaryLabel}
            </Button>
          </ActionBar>
        )}
      </div>
    </form>
  );
}

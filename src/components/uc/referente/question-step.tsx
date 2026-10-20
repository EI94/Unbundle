"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Lock, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Issue } from "@/lib/uc/answers/issues";
import type { ReferentItemView } from "@/lib/uc/public-view";
import { choiceList, fieldIssues, otherIssues, SOURCE_CHIP_TYPES, toggleSource, valueFrom, type ReferentForm, type ReferentIntent } from "@/lib/uc/views/referente-form";
import { isHeavyResponseType } from "@/lib/uc/request-state";
import { AnswerInput, isFileType } from "./answer-input";
import { AttachmentField, type AttachmentRef } from "./attachment-field";
import { DeclaredValue } from "./declared-value";
import { DontKnowPanel } from "./dont-know-panel";
import { ExcelImport } from "./excel-import";
import { Field, FieldErrors, TextControl } from "./inputs/fields";
import { MoreOptions, type MoreOptionsState } from "./more-options";
import { Disclosure, Notice, PRIMARY_CLASS, SECONDARY_CLASS, ScreenTitle, TEXT_BUTTON_CLASS } from "./screen";
import { SourceChips } from "./source-chips";
import { ActionBar } from "./step-bar";
import { formatCountIt } from "@/lib/uc/views/format";

/**
 * R2 · Una domanda per schermata (DESIGN §4.3):
 * - R2a, valore già dichiarato che il referente vede: «È così» (primario),
 *   «Correggi», «Non lo so» testuale; con «Valido dal» obbligatorio, «Da
 *   quando vale?» prima;
 * - R2b, valore da scrivere: l'input del tipo, «Da dove viene?» sui numeri e
 *   sulle date, «▸ Altre opzioni», e la barra «Non lo so» · «Avanti»;
 * - R2c, tabelle e file al telefono: «È più comodo dal computer», con «Compila
 *   qui, riga per riga» (editor a schede), «Carica un Excel» (il file resta
 *   allegato e le sue righe riempiono la tabella da controllare) e il modello;
 * - R2d, dato personale: niente bozza, «Invia» parte subito, cifrato;
 * - R3, «Non lo so»: un pannello al posto della barra.
 * Sì/no e scelta singola: un tocco salva e passa avanti, come «È così».
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
  /** «Avanti →», «Rivedi e invia» sull'ultima domanda, «Invia» quando parte subito. */
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
}

const EXTRA_FIELDS = ["note", "valid_from", "who_might_know", "reason", "source_basis"];
const MAX_INLINE = 140;

/** Perché ed esempio: in linea se brevi, altrimenti in «▸ Esempio e dove trovarlo». */
function explanationParts(item: ReferentItemView): { inline: string | null; more: { label: string | null; text: string }[] } {
  const lead = item.why ?? item.explanation;
  const exampleText = item.example ? `Esempio: ${item.example}` : null;
  const both = [lead, exampleText].filter(Boolean).join(" ");
  const more: { label: string | null; text: string }[] = [];
  let inline: string | null = null;
  if (both && both.length <= MAX_INLINE) inline = both;
  else {
    inline = lead;
    if (item.example) more.push({ label: "Esempio:", text: item.example });
  }
  if (item.why && item.explanation) more.unshift({ label: null, text: item.explanation });
  if (item.help) more.push({ label: "Dove trovarlo:", text: item.help });
  return { inline, more };
}

function ExampleDetails({ parts }: { parts: { label: string | null; text: string }[] }) {
  if (parts.length === 0) return null;
  return (
    <Disclosure summary="Esempio e dove trovarlo">
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
  const { item, token, form, attachments, issues, busy, narrow, primaryLabel, immediate, delegateHref, onForm, onAttachments, onNext, onConfirm, onSkip, onPicked } = props;
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
  const confirmable = declared !== null && declared.canConfirm && declared.display !== null && !item.can.newVersionOnly;
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

  const primary = () => onNext(open.na ? "non_si_applica" : "risposta");
  const notKnownButton = item.can.notKnown ? (
    <Button type="button" variant="outline" className={SECONDARY_CLASS} disabled={busy} onClick={() => setDontKnow(true)}>
      Non lo so
    </Button>
  ) : null;

  const validFromField = item.requiresValidFrom ? (
    <Field label="Da quando vale?" htmlFor={`${id}-valid-from`} issues={validIssues} hint="Se non lo sai con precisione, metti una data vicina." className="max-w-64">
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
          Annulla
        </Button>
        <Button type="button" className="h-12 flex-1 text-base" disabled={busy} onClick={() => onNext("non_so")}>
          {immediate ? "Invia" : "Avanti →"}
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
          La tua risposta: <span className="font-medium">{item.ownAnswer?.display ?? "inviata"}</span> · A posto
        </p>
        <Button type="button" variant="ghost" className={TEXT_BUTTON_CLASS} onClick={() => setUpdateOpen(true)}>
          È cambiato qualcosa? Aggiorna la risposta
        </Button>
      </div>
    );
  }

  // R2a: il valore già dichiarato, confermabile con un tocco.
  if (confirmable && !correcting) {
    return (
      <div ref={container} className="space-y-5">
        {header}
        <DeclaredValue declared={declared} id={id} />
        <p className="text-base font-medium">È ancora così?</p>
        {validFromField}
        <FieldErrors issues={general} />
        {dontKnow ? (
          dontKnowBlock
        ) : (
          <div className="space-y-2">
            <Button type="button" className={PRIMARY_CLASS} disabled={busy || (item.requiresValidFrom && !form.validFrom)} onClick={onConfirm}>
              È così
            </Button>
            <Button
              type="button"
              variant="outline"
              className={SECONDARY_CLASS}
              disabled={busy}
              onClick={() => {
                setCorrecting(true);
                onForm({ ...form, intent: null, confirmMode: "correzione", value: valueFrom(item.responseType, item.config, declared.value) });
              }}
            >
              Correggi
            </Button>
            {item.can.notKnown ? (
              <div className="text-center sm:text-left">
                <Button type="button" variant="ghost" className={TEXT_BUTTON_CLASS} disabled={busy} onClick={() => setDontKnow(true)}>
                  Non lo so
                </Button>
              </div>
            ) : null}
          </div>
        )}
        <ExampleDetails parts={explain.more} />
      </div>
    );
  }

  // R2c: tabelle e file al telefono.
  const heavyGate = narrow && heavy && !heavyOpen && !dontKnow;
  if (heavyGate) {
    const table = item.responseType === "tabella";
    return (
      <div ref={container} className="space-y-5">
        {header}
        <div className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <Monitor className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-base font-medium">È più comodo dal computer</p>
            <p className="text-base text-muted-foreground">Apri questo stesso link dal computer: ritrovi tutto dove l&apos;hai lasciato.</p>
          </div>
        </div>
        <div className="space-y-2">
          <Button type="button" variant="outline" className={SECONDARY_CLASS} onClick={() => setHeavyOpen(true)}>
            {table ? "Compila qui, riga per riga" : fileType ? "Carica il file da qui" : "Compila qui"}
          </Button>
          {table ? (
            <Button type="button" variant="outline" className={SECONDARY_CLASS} aria-expanded={excelOpen} onClick={() => setExcelOpen((v) => !v)}>
              Carica un Excel
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
                const rows = grid.rows.length === 1 ? "1 riga" : `${formatCountIt(grid.rows.length)} righe`;
                setImported(`Ho letto ${rows} da «${fileName}»: controlla la tabella qui sotto.${note ? ` ${note}` : ""}`);
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
                Scarica il modello Excel
              </a>
            </div>
          ) : null}
        </div>
        <ActionBar>
          {item.can.notKnown ? (
            <Button type="button" variant="outline" className="h-12 flex-1 text-base" onClick={() => setDontKnow(true)}>
              Non lo so
            </Button>
          ) : null}
          {onSkip ? (
            <Button type="button" variant="outline" className="h-12 flex-1 text-base" onClick={onSkip}>
              Rispondi dopo
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
            <p className="text-base text-muted-foreground">Controlla il valore nel formato giusto.</p>
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
              Ci avete già detto: <span className="text-foreground">{declared.display}</span>
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
              Il valore era giusto: torna a «È così»
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
            <span className="min-w-0">Dato personale: non lo salviamo in bozza. Quando premi «Invia» parte subito, cifrato.</span>
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
        {SOURCE_CHIP_TYPES.includes(item.responseType ?? "testo") ? <SourceChips id={id} value={form.sourceBasis} disabled={busy} onToggle={(b) => onForm(toggleSource(form, b))} /> : null}

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
              {open.na ? (immediate ? "Invia" : "Avanti →") : primaryLabel}
            </Button>
          </ActionBar>
        )}
      </div>
    </form>
  );
}

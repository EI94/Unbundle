"use client";

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { createQuickUseCaseAction } from "@/lib/actions/use-case-create";
import {
  KIND_OPTIONS,
  ORIGIN_OPTIONS,
  QUICK_CREATE_MAX,
  QUICK_CREATE_TEXT,
  defaultOriginFor,
  fullFormPath,
  readQuickCreate,
} from "@/lib/use-cases/create";
import { KIND_LABEL, ORIGIN_LABEL } from "@/lib/use-cases/labels";
import { KINDS, ORIGINS, type Origin, type UseCaseKind } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";
import { ORIGIN_DOT_CLASS } from "./origin-chip";

export interface QuickCreateSheetProps {
  workspaceId: string;
  /** I valori di «AI Lab» del workspace, dal più recente (`quickCreateOptions`). */
  aiLabs?: readonly string[];
  /** L'ultimo «AI Lab» usato nel workspace: il campo parte da qui. */
  lastAiLab?: string | null;
  /** Controllato. Senza, il pannello segue il parametro `?nuovo=1` della pagina. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Controllato: «Salva» chiude e chiede di aprire la scheda. Senza, `?apri=<id>`. */
  onSaved?: (useCaseId: string) => void;
}

type SaveMode = "salva" | "altro";

/** I tre campi del pannello, nell'ordine in cui si compilano. */
type FieldName = "title" | "problem" | "aiLab";

/** Il primo campo con un errore, nell'ordine del pannello. */
function firstErrorField(fieldErrors: Record<string, string>): FieldName | null {
  if (fieldErrors.title) return "title";
  if (fieldErrors.problem) return "problem";
  if (fieldErrors.aiLab) return "aiLab";
  return null;
}

/** L'indirizzo della pagina con alcuni parametri cambiati (`null` lo toglie). */
function urlWith(pathname: string, params: URLSearchParams, change: Record<string, string | null>): string {
  const next = new URLSearchParams(params.toString());
  for (const [key, value] of Object.entries(change)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function isOrigin(value: unknown): value is Origin {
  return typeof value === "string" && (ORIGINS as readonly string[]).includes(value);
}

function isKind(value: unknown): value is UseCaseKind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

/**
 * Il pannello rapido di «Nuovo use case» (docs/use-case/DESIGN.md §5.1, §5.2, §8.1), per le
 * persone di Lateral Space con ruolo da revisore, durante un AI Lab: titolo, problema in una
 * riga e AI Lab; origine («AI Transformation») e tipo («Da costruire») come chip modificabili.
 *
 * - «Salva e aggiungi un altro» (il pulsante pieno, anche Invio nel campo del problema): salva,
 *   svuota titolo e problema, tiene AI Lab, origine e tipo, rimette il focus sul titolo e
 *   mostra il toast «XX-0031 salvato.».
 * - «Salva»: salva, chiude e apre la scheda nel pannello laterale (`?apri=<id>`).
 * - Errore: «Non riusciamo a salvare. Riprova.», i campi restano compilati.
 *
 * Lo monta la pagina «Use case» quando c'è `?nuovo=1`; il salvataggio passa da
 * `createQuickUseCaseAction` (nessuna valutazione dell'AI, nessuna notifica).
 */
export function QuickCreateSheet({ workspaceId, aiLabs = [], lastAiLab = null, open: openProp, onOpenChange, onSaved }: QuickCreateSheetProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = openProp ?? searchParams.get("nuovo") === "1";

  const baseId = `nuovo-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const titleRef = useRef<HTMLInputElement>(null);
  const problemRef = useRef<HTMLInputElement>(null);
  const aiLabRef = useRef<HTMLInputElement>(null);
  /**
   * Il campo da mettere a fuoco quando il salvataggio finisce. Mentre salva i campi sono
   * `disabled`, e `focus()` su un campo spento non fa nulla: `isPending` resta vero finché la
   * funzione della transizione non è finita. Così dopo «Salva e aggiungi un altro» il focus
   * torna davvero su «Titolo» (§5.2), e dopo un errore del server sul primo campo da correggere.
   */
  const focusAfterSave = useRef<FieldName | null>(null);

  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [aiLab, setAiLab] = useState(lastAiLab ?? "");
  const [labs, setLabs] = useState<readonly string[]>(aiLabs);
  const [origin, setOrigin] = useState<Origin>(() => defaultOriginFor("pannello_rapido", { isLateralSpace: true, isReviewer: true }));
  const [kind, setKind] = useState<UseCaseKind>("da_costruire");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (pending) return;
    const field = focusAfterSave.current;
    if (!field) return;
    focusAfterSave.current = null;
    const refs = { title: titleRef, problem: problemRef, aiLab: aiLabRef };
    refs[field].current?.focus();
  }, [pending]);

  function close(change: Record<string, string | null> = {}) {
    onOpenChange?.(false);
    if (openProp === undefined) router.replace(urlWith(pathname, new URLSearchParams(searchParams.toString()), { nuovo: null, ...change }), { scroll: false });
  }

  /** Fuori dal salvataggio i campi sono attivi: il focus si mette subito. */
  function focusFirstError(fieldErrors: Record<string, string>) {
    const field = firstErrorField(fieldErrors);
    const refs = { title: titleRef, problem: problemRef, aiLab: aiLabRef };
    if (field) refs[field].current?.focus();
  }

  function save(mode: SaveMode) {
    if (pending) return;
    setMessage(null);
    const input = { title, problem, aiLab, origin, kind };
    const checked = readQuickCreate(input);
    if (!checked.ok) {
      setErrors(checked.fieldErrors);
      focusFirstError(checked.fieldErrors);
      return;
    }
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof createQuickUseCaseAction>>;
      try {
        result = await createQuickUseCaseAction(workspaceId, input);
      } catch {
        setMessage(QUICK_CREATE_TEXT.error);
        return;
      }
      if (!result.ok) {
        setErrors(result.fieldErrors);
        if (Object.keys(result.fieldErrors).length) focusAfterSave.current = firstErrorField(result.fieldErrors);
        else setMessage(result.message);
        return;
      }
      setErrors({});
      const savedLab = aiLab.trim();
      if (savedLab && !labs.includes(savedLab)) setLabs([savedLab, ...labs]);
      setTitle("");
      setProblem("");
      if (mode === "altro") {
        toast.success(result.message);
        focusAfterSave.current = "title";
        router.refresh();
        return;
      }
      onSaved?.(result.id);
      close(onSaved ? {} : { apri: result.id });
    });
  }

  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    problemRef.current?.focus();
  }

  function onProblemKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    save("altro");
  }

  const listId = `${baseId}-ai-lab-elenco`;

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <SheetContent
        side="right"
        showCloseButton={false}
        initialFocus={titleRef}
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        data-slot="quick-create-sheet"
      >
        <SheetHeader className="flex-row items-center justify-between gap-2 border-b px-4 py-3">
          <SheetTitle className="text-base font-semibold">{QUICK_CREATE_TEXT.heading}</SheetTitle>
          <SheetClose render={<Button variant="ghost" size="icon" className="size-11 sm:size-8" aria-label={QUICK_CREATE_TEXT.close} />}>
            <X aria-hidden />
          </SheetClose>
        </SheetHeader>

        <form
          noValidate
          className="flex flex-col gap-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            save("altro");
          }}
        >
          <Field id={`${baseId}-titolo`} label={QUICK_CREATE_TEXT.titleLabel} error={errors.title}>
            <Input
              ref={titleRef}
              id={`${baseId}-titolo`}
              value={title}
              maxLength={QUICK_CREATE_MAX.title}
              autoComplete="off"
              disabled={pending}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? `${baseId}-titolo-errore` : undefined}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={onTitleKeyDown}
              className="h-10 sm:h-9"
            />
          </Field>

          <Field id={`${baseId}-problema`} label={QUICK_CREATE_TEXT.problemLabel} error={errors.problem}>
            <Input
              ref={problemRef}
              id={`${baseId}-problema`}
              value={problem}
              maxLength={QUICK_CREATE_MAX.problem}
              autoComplete="off"
              enterKeyHint="send"
              disabled={pending}
              aria-invalid={errors.problem ? true : undefined}
              aria-describedby={errors.problem ? `${baseId}-problema-errore` : undefined}
              onChange={(event) => setProblem(event.target.value)}
              onKeyDown={onProblemKeyDown}
              className="h-10 sm:h-9"
            />
          </Field>

          <Field id={`${baseId}-ai-lab`} label={QUICK_CREATE_TEXT.aiLabLabel} error={errors.aiLab}>
            <Input
              ref={aiLabRef}
              id={`${baseId}-ai-lab`}
              value={aiLab}
              list={listId}
              maxLength={QUICK_CREATE_MAX.aiLab}
              autoComplete="off"
              placeholder={QUICK_CREATE_TEXT.aiLabPlaceholder}
              disabled={pending}
              aria-invalid={errors.aiLab ? true : undefined}
              aria-describedby={errors.aiLab ? `${baseId}-ai-lab-errore` : undefined}
              onChange={(event) => setAiLab(event.target.value)}
              className="h-10 sm:h-9"
            />
            <datalist id={listId}>
              {labs.map((lab) => (
                <option key={lab} value={lab} />
              ))}
            </datalist>
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <ChoiceChip
              label={`${QUICK_CREATE_TEXT.originLabel}: ${ORIGIN_LABEL[origin].chip}. ${QUICK_CREATE_TEXT.change}`}
              value={origin}
              options={ORIGIN_OPTIONS}
              disabled={pending}
              onChange={(value) => isOrigin(value) && setOrigin(value)}
            >
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", ORIGIN_DOT_CLASS[origin])} />
              {ORIGIN_LABEL[origin].chip}
            </ChoiceChip>
            <ChoiceChip
              label={`${QUICK_CREATE_TEXT.kindLabel}: ${KIND_LABEL[kind].label}. ${QUICK_CREATE_TEXT.change}`}
              value={kind}
              options={KIND_OPTIONS}
              disabled={pending}
              onChange={(value) => isKind(value) && setKind(value)}
            >
              {KIND_LABEL[kind].label}
            </ChoiceChip>
          </div>

          <SheetDescription>{QUICK_CREATE_TEXT.hint}</SheetDescription>

          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={pending} onClick={() => save("salva")}>
              {QUICK_CREATE_TEXT.save}
            </Button>
            <Button type="button" className="min-h-11 sm:min-h-9" disabled={pending} onClick={() => save("altro")}>
              {QUICK_CREATE_TEXT.saveAndAdd}
            </Button>
          </div>

          <Link
            href={fullFormPath(workspaceId)}
            className="self-start text-sm font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:decoration-2"
          >
            {QUICK_CREATE_TEXT.fullForm}
          </Link>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-errore`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Un chip che apre una scelta a due voci (§5.2): il testo c'è sempre, la matita dice che si cambia. */
function ChoiceChip({
  label,
  value,
  options,
  disabled,
  onChange,
  children,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: unknown) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            aria-label={label}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          />
        }
      >
        {children}
        <Pencil aria-hidden className="size-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-56 max-w-[calc(100vw-2rem)]">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="min-h-10 sm:min-h-8">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

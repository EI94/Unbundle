"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addQuestionAction } from "@/lib/actions/context";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { CONTEXT_LIMITS } from "@/lib/context/vocab";
import type { AskAnswer, AskSource } from "@/lib/db/queries/context-ask";
import { ask } from "./read-client";
import { askSourceMeta } from "./view-model";

const T = CONTEXT_TEXT;

type Shown = { question: string; answer: Exclude<AskAnswer, { status: "limite" }> };

/**
 * «Chiedi al contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2, §4.4): un campo su tutta la
 * larghezza, con invio. Sotto, la risposta e le sue fonti; «Non lo sappiamo ancora.» con «Aggiungi alle domande
 * aperte»; senza l'ok ai fornitori i brani trovati e la riga con il link a Impostazioni. La risposta resta finché non si
 * chiude o non si fa un'altra domanda, e non si salva.
 */
export function AskBox({ workspaceId, today, lateralSpace }: { workspaceId: string; today: string; lateralSpace: boolean }) {
  const [question, setQuestion] = useState("");
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);
  const [adding, startAdding] = useTransition();
  const running = useRef<AbortController | null>(null);

  const submit = async () => {
    const asked = question.replace(/\s+/g, " ").trim();
    if (asked.length < CONTEXT_LIMITS.askMin) return setError(T.ask.tooShort);
    if (asked.length > CONTEXT_LIMITS.askMax) return setError(T.errors.tooLong(CONTEXT_LIMITS.askMax));
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setError(null);
    setShown(null);
    setAdded(false);
    setLoading(true);
    try {
      const result = await ask(fetch, workspaceId, asked, controller.signal);
      if (controller.signal.aborted) return;
      if (result.ok) {
        if (result.value.status === "limite") setError(T.ask.limit);
        else setShown({ question: asked, answer: result.value });
      } else if (result.status === 429) setError(result.message);
      else if (result.status === 422) setError(result.fieldErrors.question ?? result.message);
      else setError(T.ask.failed);
    } catch {
      if (!controller.signal.aborted) setError(T.ask.failed);
    } finally {
      if (running.current === controller) {
        running.current = null;
        setLoading(false);
      }
    }
  };

  const close = () => {
    running.current?.abort();
    running.current = null;
    setLoading(false);
    setShown(null);
    setError(null);
  };

  const addToQuestions = (asked: string) =>
    startAdding(async () => {
      const result = await addQuestionAction(workspaceId, { question: asked });
      if (!result.ok) {
        toast.error(result.fieldErrors?.question ?? result.message);
        return;
      }
      setAdded(true);
      toast.success(T.ask.questionAdded);
    });

  const answer = shown?.answer ?? null;
  return (
    <div className="space-y-3">
      <form
        role="search"
        aria-label={T.ask.label}
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="contesto-domanda" className="sr-only">
          {T.ask.label}
        </label>
        <Input
          id="contesto-domanda"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={lateralSpace ? T.ask.placeholderLs : T.ask.placeholderClient}
          maxLength={CONTEXT_LIMITS.askMax + 20}
          autoComplete="off"
          enterKeyHint="search"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "contesto-domanda-errore" : undefined}
          className="min-h-11 flex-1 sm:min-h-9"
        />
        <Button type="submit" variant="outline" className="min-h-11 shrink-0 px-4 sm:min-h-9" disabled={loading}>
          {T.ask.submit}
        </Button>
      </form>
      {error ? (
        <p id="contesto-domanda-errore" role="alert" className="text-sm text-muted-foreground">
          {error}
        </p>
      ) : null}
      {loading || answer ? (
        <section aria-live="polite" aria-busy={loading} className="relative space-y-3 rounded-xl border p-4 pr-14">
          {loading ? <p className="text-sm text-muted-foreground">{T.ask.loading}</p> : null}
          {answer && answer.status === "risposta" ? (
            <>
              <p className="text-sm leading-relaxed whitespace-pre-line">{answer.answer}</p>
              <Sources sources={answer.sources} today={today} />
            </>
          ) : null}
          {answer && (answer.status === "non_so" || answer.status === "niente") ? (
            <div className="space-y-3">
              <p className="text-sm">{answer.status === "non_so" ? T.ask.unknown : T.ask.nothing}</p>
              {added ? null : (
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={adding} onClick={() => addToQuestions(shown!.question)}>
                  {T.ask.addQuestion}
                </Button>
              )}
            </div>
          ) : null}
          {answer && answer.status === "solo_ricerca" ? (
            <>
              <Sources sources={answer.sources} today={today} />
              <p className="text-sm text-muted-foreground">
                {T.ask.searchOnly}{" "}
                <Link href={`/dashboard/${workspaceId}/settings#sub-responsabili`} className="inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-0">
                  {T.granola.settingsLink}
                </Link>
              </p>
            </>
          ) : null}
          <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2 size-11 sm:size-8" onClick={close}>
            <XIcon aria-hidden />
            <span className="sr-only">{T.ask.close}</span>
          </Button>
        </section>
      ) : null}
    </div>
  );
}

function Sources({ sources, today }: { sources: readonly AskSource[]; today: string }) {
  if (sources.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{T.ask.sources}</h3>
      <ol className="space-y-2.5">
        {sources.map((source) => (
          <li key={source.n} className="text-sm">
            <p className="text-xs text-muted-foreground">{askSourceMeta(source, today)}</p>
            <p className="leading-relaxed break-words">{source.excerpt}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

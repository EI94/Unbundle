"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { listGranolaFoldersAction, saveGranolaRulesAction } from "@/lib/actions/context-granola";
import { folderOptions, splitPeopleEntries, splitTitleWords } from "@/lib/context/granola/view";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { GranolaRulesView } from "@/lib/db/queries/context-granola";
import { cn } from "@/lib/utils";

const T = CONTEXT_TEXT.granola;
const SELECT_CLASS = "h-11 w-full rounded-lg border border-input bg-background px-2 text-base sm:h-8 sm:max-w-sm sm:text-sm";

function Chip({ value, onRemove, disabled }: { value: string; onRemove: () => void; disabled: boolean }) {
  return (
    <li className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-3 text-xs">
      <span className="truncate">{value}</span>
      <button
        type="button"
        className="-my-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 sm:my-0 sm:size-6"
        aria-label={`${CONTEXT_TEXT.notes.remove} ${value}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}

/**
 * Le regole delle call di questo cliente (rilascio 9a, §8.9): la cartella (di chi guarda), le persone e i domini, le
 * parole nel titolo, la trascrizione, e «Salva». (Rilascio 10, §3.7) Le usano due blocchi: Impostazioni (il blocco di
 * Granola, con l'ancora `#granola-regole`) e la vista «Fonti» di «Contesto», sotto Granola. I controlli veri stanno sul
 * server (`saveGranolaRulesAction`).
 */
export function GranolaRulesFields({ workspaceId, rules }: { workspaceId: string; rules: GranolaRulesView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [folder, setFolder] = useState<{ id: string; name: string } | null>(rules.folder);
  const [folders, setFolders] = useState<Array<{ id: string; name: string }> | null>(null);
  const [emails, setEmails] = useState<string[]>(rules.emails);
  const [domains, setDomains] = useState<string[]>(rules.domains);
  const [words, setWords] = useState<string[]>(rules.titleWords);
  const [wantTranscript, setWantTranscript] = useState(rules.wantTranscript && rules.transcriptAvailable);
  const [peopleInput, setPeopleInput] = useState("");
  const [wordsInput, setWordsInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadingFolders, setLoadingFolders] = useState(false);

  const loadFolders = () => {
    if (folders !== null || loadingFolders) return;
    setLoadingFolders(true);
    void listGranolaFoldersAction(workspaceId)
      .then((result) => {
        if (result.ok) setFolders(result.value);
        else toast.error(result.message);
      })
      .finally(() => setLoadingFolders(false));
  };

  const addPeople = () => {
    const found = splitPeopleEntries(peopleInput);
    setEmails((current) => [...current, ...found.emails.filter((e) => !current.includes(e))]);
    setDomains((current) => [...current, ...found.domains.filter((d) => !current.includes(d))]);
    setPeopleInput(found.invalid.join(" "));
    setErrors((current) => ({ ...current, people: found.invalid.length > 0 ? T.invalidEntry : "" }));
  };

  const addWords = () => {
    setWords((current) => splitTitleWords(wordsInput, current));
    setWordsInput("");
  };

  const save = () =>
    start(async () => {
      const result = await saveGranolaRulesAction(workspaceId, {
        folderId: folder?.id ?? null,
        folderName: folder?.name ?? null,
        emails,
        domains,
        titleWords: words,
        wantTranscript,
      });
      if (!result.ok) {
        const fields = result.fieldErrors ?? {};
        setErrors({ people: fields.emails ?? fields.domains ?? "", words: fields.titleWords ?? "", folder: fields.folderId ?? "" });
        toast.error(result.message);
        return;
      }
      setErrors({});
      toast.success(T.saved);
      router.refresh();
    });

  const options = folderOptions(folders, folder);
  const onEnter = (run: () => void) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      run();
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="granola-folder">{T.folder}</Label>
        <select
          id="granola-folder"
          className={SELECT_CLASS}
          value={folder?.id ?? ""}
          disabled={pending}
          aria-busy={loadingFolders}
          onFocus={loadFolders}
          onPointerDown={loadFolders}
          onChange={(event) => setFolder(options.find((f) => f.id === event.target.value) ?? null)}
        >
          <option value="">{T.folderNone}</option>
          {options.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {errors.folder && <p role="alert" className="text-xs text-destructive">{errors.folder}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="granola-people">{T.people}</Label>
        <p className="text-xs text-muted-foreground">{T.peopleKnown(rules.knownPeople)}</p>
        {emails.length + domains.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {[...emails, ...domains].map((value) => (
              <Chip
                key={value}
                value={value}
                disabled={pending}
                onRemove={() => {
                  setEmails((current) => current.filter((e) => e !== value));
                  setDomains((current) => current.filter((d) => d !== value));
                }}
              />
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id="granola-people"
            className="h-11 text-base sm:h-8 sm:max-w-sm sm:text-sm"
            placeholder={T.peoplePlaceholder}
            value={peopleInput}
            disabled={pending}
            aria-invalid={Boolean(errors.people)}
            onChange={(event) => setPeopleInput(event.target.value)}
            onKeyDown={onEnter(addPeople)}
          />
          <Button type="button" variant="outline" className="h-11 sm:h-8" disabled={pending || !peopleInput.trim()} onClick={addPeople}>
            {T.add}
          </Button>
        </div>
        {errors.people && <p role="alert" className="text-xs text-destructive">{errors.people}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="granola-words">{T.words}</Label>
        {words.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {words.map((word) => (
              <Chip key={word} value={word} disabled={pending} onRemove={() => setWords((current) => current.filter((w) => w !== word))} />
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id="granola-words"
            className="h-11 text-base sm:h-8 sm:max-w-sm sm:text-sm"
            placeholder={T.wordsPlaceholder}
            value={wordsInput}
            disabled={pending}
            aria-invalid={Boolean(errors.words)}
            onChange={(event) => setWordsInput(event.target.value)}
            onKeyDown={onEnter(addWords)}
          />
          <Button type="button" variant="outline" className="h-11 sm:h-8" disabled={pending || !wordsInput.trim()} onClick={addWords}>
            {T.add}
          </Button>
        </div>
        {errors.words && <p role="alert" className="text-xs text-destructive">{errors.words}</p>}
      </div>

      <div className="space-y-1">
        <div className="flex min-h-11 items-center gap-3">
          <Switch id="granola-transcript" checked={wantTranscript} disabled={pending || !rules.transcriptAvailable} onCheckedChange={(checked) => setWantTranscript(checked === true)} />
          <Label htmlFor="granola-transcript" className={cn("font-normal", !rules.transcriptAvailable && "text-muted-foreground")}>
            {T.transcript}
          </Label>
        </div>
        {!rules.transcriptAvailable && <p className="text-xs text-muted-foreground">{T.transcriptUnavailable}</p>}
      </div>

      <Button type="button" variant="outline" className="h-11 px-4 sm:h-8" disabled={pending} onClick={save}>
        {pending ? CONTEXT_TEXT.add.saving : T.save}
      </Button>
    </div>
  );
}

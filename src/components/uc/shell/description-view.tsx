import Link from "next/link";
import { WORDS } from "@/lib/uc/views/labels";
import { formatDateIt } from "@/lib/uc/views/format";
import { DESCRIPTION_PREVIEW, showAllLabel, type DescriptionContent, type DescriptionRecord, type DescriptionVersion } from "@/lib/uc/views/description";
import { cn } from "@/lib/utils";
import { BlockEditButton, ShowMoreList, type BlockEditorConfig } from "./description-editor";

/**
 * La Descrizione da leggere (DESIGN §3.7.1): sezioni senza cornice in una
 * colonna `max-w-3xl`, titoli `text-base font-semibold`, «Modifica» solo al
 * passaggio o al focus. Componenti server di sola presentazione; la modifica
 * sta in `description-editor.tsx`.
 */

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm">
      {items.map((t, i) => (
        <li key={i} className="pl-1 break-words">
          {t}
        </li>
      ))}
    </ul>
  );
}

/** «2026-10-01» diventa «1 ott 2026»; il resto resta com'è scritto. */
function dayText(v: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? (formatDateIt(v) ?? v) : v;
}

function Records({ blockKey, records }: { blockKey: string; records: readonly DescriptionRecord[] }) {
  if (blockKey === "rischi") {
    return (
      <ul className="space-y-3 text-sm">
        {records.map((r, i) => (
          <li key={i} className="break-words">
            {r.rischio && <p className="font-medium">{r.rischio}</p>}
            {r.mitigazione && <p className="text-muted-foreground">{r.mitigazione}</p>}
          </li>
        ))}
      </ul>
    );
  }
  if (blockKey === "decisioni") {
    return (
      <ul className="space-y-3 text-sm">
        {records.map((r, i) => (
          <li key={i} className="break-words">
            {r.decisione && <p>{r.decisione}</p>}
            {(r.data || r.chi) && <p className="text-xs text-muted-foreground">{[r.data ? dayText(r.data) : null, r.chi].filter(Boolean).join(" · ")}</p>}
          </li>
        ))}
      </ul>
    );
  }
  // «Per chi cambia qualcosa» (e ogni blocco a schede): il primo campo in grassetto, il resto sotto.
  return (
    <ul className="space-y-3 text-sm">
      {records.map((r, i) => {
        const [first, ...rest] = Object.values(r);
        return (
          <li key={i} className="break-words">
            {first && <p className="font-medium">{first}</p>}
            {rest.length > 0 && <p className="text-muted-foreground">{rest.join(" · ")}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** Il contenuto di un blocco già ripulito (`readableContent`): mai «Vuoto.», un blocco vuoto non si rende. */
export function BlockContent({ blockKey, content, perimeterLabel }: { blockKey: string; content: DescriptionContent; perimeterLabel?: string | null }) {
  switch (content.kind) {
    case "testo":
      return content.text ? <p className="text-sm leading-relaxed break-words whitespace-pre-line">{content.text}</p> : null;
    case "elenco": {
      if (content.items.length === 0) return null;
      const preview = DESCRIPTION_PREVIEW[blockKey];
      if (preview) return <ShowMoreList items={content.items} initial={preview} moreLabel={showAllLabel(blockKey, content.items.length)} ordered={blockKey === "come_funziona"} />;
      return <Bullets items={content.items} />;
    }
    case "schede":
      return content.records.length === 0 ? null : <Records blockKey={blockKey} records={content.records} />;
    case "perimetro":
      return (
        <div className="space-y-4">
          {content.inside.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                {WORDS.nelContratto}
                {perimeterLabel ? ` · ${perimeterLabel}` : ""}
              </p>
              <Bullets items={content.inside} />
            </div>
          )}
          {content.evolution.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{WORDS.fuoriContratto}: serve una decisione dell&apos;AI Board e un incarico separato.</p>
              <Bullets items={content.evolution} />
            </div>
          )}
        </div>
      );
  }
}

/**
 * Una sezione della Descrizione: titolo e contenuto, senza cornice. Per chi
 * modifica, «Modifica» al passaggio o al focus (sempre, mentre si modifica la
 * pagina). Un blocco vuoto in modifica è solo il suo «+ Aggiungi …».
 */
export function DescriptionSection({
  title,
  level = "h2",
  editor,
  editing = false,
  empty = false,
  addLabel,
  children,
}: {
  title: string;
  level?: "h2" | "h3";
  editor: BlockEditorConfig | null;
  editing?: boolean;
  empty?: boolean;
  addLabel?: string;
  children?: React.ReactNode;
}) {
  if (empty) return editor && addLabel ? <BlockEditButton editor={editor} variant="aggiungi" label={addLabel} /> : null;
  const Heading = level;
  return (
    <section className="group/blocco min-w-0 space-y-2">
      <div className="flex min-h-8 min-w-0 items-center justify-between gap-3">
        <Heading className={cn("min-w-0 font-semibold break-words", level === "h2" ? "text-base" : "text-sm")}>{title}</Heading>
        {editor && <BlockEditButton editor={editor} variant="modifica" label="Modifica" revealOnHover={!editing} />}
      </div>
      {children}
    </section>
  );
}

/** Le versioni della descrizione nel pannello «Versioni» (DESIGN §3.7.1): data, autore, cosa è cambiato, «Leggi». */
export function VersionsList({
  versions,
  shownVersion,
  authorOf,
  readHref,
  dayOf,
  changedText,
}: {
  versions: readonly DescriptionVersion[];
  shownVersion: number | null;
  authorOf: (userId: string | null) => string | null;
  readHref: (v: DescriptionVersion) => string;
  dayOf: (iso: string | null) => string | null;
  changedText: (v: DescriptionVersion) => string | null;
}) {
  return (
    <ol className="divide-y divide-border">
      {versions.map((v) => {
        const isShown = shownVersion === null ? v.current : v.version === shownVersion;
        const author = authorOf(v.createdByUserId);
        const day = dayOf(v.createdAt);
        const changed = changedText(v);
        return (
          <li key={v.version} className="flex min-w-0 items-start justify-between gap-3 py-3 text-sm first:pt-0">
            <div className="min-w-0">
              <p className="font-medium">
                Versione {v.version}
                {v.current && <span className="ml-2 text-xs font-normal text-muted-foreground">attuale</span>}
              </p>
              <p className="text-xs break-words text-muted-foreground">{[day ?? "La prima versione conservata", author].filter(Boolean).join(" · ")}</p>
              {changed && <p className="text-xs break-words text-muted-foreground">{changed}</p>}
            </div>
            {isShown ? (
              <span className="shrink-0 text-xs text-muted-foreground">La stai leggendo</span>
            ) : (
              <Link href={readHref(v)} scroll={false} className="inline-flex min-h-11 shrink-0 items-center text-sm underline underline-offset-4 sm:min-h-8">
                Leggi
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}

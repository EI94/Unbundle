"use client";

import { SYSTEM_ACCESS_MODES } from "@/lib/uc/answers/simple";
import { Field, FieldErrors, SelectControl, TextAreaControl, TextControl, issuesFor, obj, text, type InputProps } from "./fields";

/**
 * Input di testo: `testo`, `codice` (maiuscolo, con il formato atteso),
 * `collegamento_sistema` (dove sta un dato e come si legge) e `caso_prova`
 * (richiesta d'esempio ed esito atteso). Il controllo dei testi (dati sanitari,
 * nomi di persone, preferenze discriminatorie) avviene prima dell'invio.
 */

export function FreeTextInput({ id, config, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const max = typeof config.max_length === "number" ? config.max_length : null;
  const current = text(v.text);
  return (
    <div className="space-y-1.5">
      <TextAreaControl id={`${id}-text`} value={current} onChange={(x) => onChange({ text: x })} disabled={disabled} invalid={issues.length > 0} placeholder="Scrivi qui" ariaLabel={label} rows={4} />
      {max ? (
        <p className="text-right text-sm text-muted-foreground">
          {current.length} / {max}
        </p>
      ) : null}
      <FieldErrors id={`${id}-text-err`} issues={issues} />
    </div>
  );
}

const PATTERN_HINTS: Readonly<Record<string, string>> = {
  "^[A-Z]{4}$": "4 lettere, come nei codici ICAO.",
  "^[A-Z]{3}$": "3 lettere, come nei codici IATA.",
};

export function CodeInput({ id, config, value, onChange, issues, disabled, label }: InputProps) {
  const v = obj(value);
  const allowed = Array.isArray(config.allowed) ? config.allowed.filter((a): a is string => typeof a === "string") : [];
  const hint = typeof config.pattern === "string" ? PATTERN_HINTS[config.pattern] : undefined;
  const listId = `${id}-codes`;
  return (
    <div className="space-y-1.5">
      <TextControl
        id={`${id}-code`}
        value={text(v.code)}
        onChange={(x) => onChange({ code: config.preserve_case === true ? x : x.toUpperCase() })}
        disabled={disabled}
        invalid={issues.length > 0}
        autoCapitalize={config.preserve_case === true ? "none" : "characters"}
        ariaLabel={label}
        placeholder="Codice"
        list={allowed.length > 0 ? listId : undefined}
        className="max-w-64 font-mono"
      />
      {allowed.length > 0 ? (
        <datalist id={listId}>
          {allowed.slice(0, 500).map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      ) : null}
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      <FieldErrors id={`${id}-code-err`} issues={issues} />
    </div>
  );
}

const ACCESS_LABELS: Readonly<Record<(typeof SYSTEM_ACCESS_MODES)[number], string>> = {
  export: "Export (file scaricato dal sistema)",
  collegamento_diretto: "Collegamento diretto",
  inserimento_manuale: "Inserimento a mano",
};

export function SystemLinkInput({ id, config, value, onChange, issues, disabled }: InputProps) {
  const v = obj(value);
  const set = (patch: Record<string, string>) => onChange({ ...v, ...patch });
  const systems = Array.isArray(config.systems) ? config.systems.filter((s): s is string => typeof s === "string") : [];
  const field = (key: string, label: string, hint?: string) => (
    <Field label={label} htmlFor={`${id}-${key}`} issues={issuesFor(issues, key)} hint={hint}>
      <TextControl id={`${id}-${key}`} value={text(v[key])} onChange={(x) => set({ [key]: x })} disabled={disabled} invalid={issuesFor(issues, key).length > 0} />
    </Field>
  );
  return (
    <div className="space-y-3">
      {systems.length > 0 ? (
        <Field label="Sistema" htmlFor={`${id}-sistema`} issues={issuesFor(issues, "sistema")}>
          <SelectControl id={`${id}-sistema`} value={text(v.sistema)} onChange={(x) => set({ sistema: x })} disabled={disabled} options={systems.map((s) => ({ value: s, label: s }))} placeholder="Scegli il sistema" />
        </Field>
      ) : (
        field("sistema", "Sistema", "Il programma in cui sta il dato.")
      )}
      {field("oggetto", "Dove si trova", "La schermata, la tabella o il menu.")}
      {field("campo", "Campo (facoltativo)")}
      <Field label="Come si legge" htmlFor={`${id}-accesso`} issues={issuesFor(issues, "accesso")}>
        <SelectControl
          id={`${id}-accesso`}
          value={text(v.accesso)}
          onChange={(x) => set({ accesso: x })}
          disabled={disabled}
          options={SYSTEM_ACCESS_MODES.map((m) => ({ value: m, label: ACCESS_LABELS[m] }))}
          placeholder="Scegli"
        />
      </Field>
      {field("chi_ha_accesso", "Chi ha accesso (ruolo, facoltativo)", "Indica il ruolo, non il nome.")}
      {field("frequenza", "Ogni quanto si aggiorna (facoltativo)")}
    </div>
  );
}

export function TestCaseInput({ id, value, onChange, issues, disabled }: InputProps) {
  const v = obj(value);
  const set = (patch: Record<string, string>) => onChange({ ...v, ...patch });
  return (
    <div className="space-y-3">
      <Field label="Richiesta d'esempio" htmlFor={`${id}-richiesta`} issues={issuesFor(issues, "richiesta")} hint="Inventata o senza nomi di persone.">
        <TextAreaControl id={`${id}-richiesta`} value={text(v.richiesta)} onChange={(x) => set({ richiesta: x })} disabled={disabled} invalid={issuesFor(issues, "richiesta").length > 0} />
      </Field>
      <Field label="Esito atteso" htmlFor={`${id}-atteso`} issues={issuesFor(issues, "atteso")}>
        <TextAreaControl id={`${id}-atteso`} value={text(v.atteso)} onChange={(x) => set({ atteso: x })} disabled={disabled} invalid={issuesFor(issues, "atteso").length > 0} />
      </Field>
      <Field label="Regole toccate" htmlFor={`${id}-regole`} issues={issuesFor(issues, "regole")} hint="Scrivi quali regole usa questo caso, separate da virgole.">
        <TextControl id={`${id}-regole`} value={text(v.regole)} onChange={(x) => set({ regole: x })} disabled={disabled} autoCapitalize="none" invalid={issuesFor(issues, "regole").length > 0} />
      </Field>
      <Field label="Tipo" htmlFor={`${id}-tipo`} issues={issuesFor(issues, "tipo")}>
        <SelectControl
          id={`${id}-tipo`}
          value={text(v.tipo) || "sintetico"}
          onChange={(x) => set({ tipo: x })}
          disabled={disabled}
          options={[
            { value: "sintetico", label: "Inventato" },
            { value: "pseudonimizzato", label: "Reale, senza nomi (dopo l'approvazione della scheda privacy)" },
          ]}
        />
      </Field>
    </div>
  );
}

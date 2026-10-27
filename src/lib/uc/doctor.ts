/**
 * Controlli di `scripts/uc-doctor.ts` (DESIGN §7.1 P0-10): ambiente e database
 * della sezione «Casi d'uso», in sola lettura. Modulo puro: l'ambiente e i
 * fatti letti dal database arrivano come parametri; le query sono qui come
 * testo, così lo script resta corto e i test le vedono.
 *
 * Esito di ogni controllo: `ok`, `avviso` (si può andare avanti, ma va saputo)
 * o `errore` (da sistemare prima del go-live o del deploy). Nessun valore delle
 * variabili esce dai messaggi: solo «presente», conteggi e host.
 */
import { UC_TABLE_NAMES } from "./ddl.ts";
import { emailReplyTo } from "./notify/dispatch.ts";
import { parseLsDomains } from "./lateral-space.ts";
import { hubAreaOn, parseHubWorkspaceList, parsePlainUuidList, ucSelfHealEnabled, type UcPlatformEnv } from "./platform.ts";
import { parseUcWorkspaceIds } from "./rollout.ts";

export type DoctorStatus = "ok" | "avviso" | "errore";
export type DoctorEnvironment = "local" | "preview" | "production";

export interface DoctorCheck {
  key: string;
  status: DoctorStatus;
  message: string;
}

export const DOCTOR_ENVIRONMENTS: readonly DoctorEnvironment[] = ["local", "preview", "production"];

/** Indice unico tra dossier e scheda (0020 o C11b): il suo nome è fisso. */
export const UC_UNIQUE_DOSSIER_INDEX = "uc_cases_portfolio_use_case_unique_idx";

function check(key: string, status: DoctorStatus, message: string): DoctorCheck {
  return { key, status, message };
}

const has = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Origine pubblica dell'app per i link delle email (stesso ordine di `NEXT_PUBLIC_APP_URL` in AMBIENTE.md). */
function appOrigin(env: UcPlatformEnv): { name: string; value: string } | null {
  for (const name of ["NEXT_PUBLIC_APP_URL", "APP_URL", "VERCEL_PROJECT_PRODUCTION_URL"]) {
    const value = env[name]?.trim();
    if (value) return { name, value };
  }
  return null;
}

function base64Bytes(value: string): number | null {
  const v = value.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) return null;
  try {
    return Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64").length;
  } catch {
    return null;
  }
}

/** Controlli sulle variabili. `environment` dice quali regole valgono (produzione è la più severa). */
export function checkUcEnv(env: UcPlatformEnv, environment: DoctorEnvironment): DoctorCheck[] {
  const out: DoctorCheck[] = [];
  const prod = environment === "production";
  const on = env.UC_ENABLED === "true";
  const strict = (bad: boolean): DoctorStatus => (bad ? (prod ? "errore" : "avviso") : "ok");

  // Interruttore generale.
  out.push(on ? check("UC_ENABLED", "ok", "Sezione accesa (UC_ENABLED=true).") : check("UC_ENABLED", "avviso", "Sezione spenta: UC_ENABLED non è «true». Pagine, cron e MCP rispondono 404."));

  // Accensione per workspace.
  const list = parseUcWorkspaceIds(env.UC_WORKSPACE_IDS);
  if (list.wildcard && prod) {
    out.push(check("UC_WORKSPACE_IDS", "errore", "«*» non vale in produzione: scrivi gli UUID dei workspace, separati da virgole."));
  } else if (list.wildcard) {
    out.push(check("UC_WORKSPACE_IDS", "avviso", "«*»: tutti i workspace. Vale solo fuori produzione."));
  } else if (list.ids.size === 0) {
    out.push(check("UC_WORKSPACE_IDS", on ? "avviso" : "ok", "Nessun workspace acceso: la sezione è spenta ovunque."));
  } else {
    out.push(check("UC_WORKSPACE_IDS", "ok", `${list.ids.size} workspace accesi.`));
  }
  if (list.ignored.length > 0) out.push(check("UC_WORKSPACE_IDS.voci", "avviso", `${list.ignored.length} voci scartate perché non sono UUID.`));

  // Ogni workspace dei dossier sta anche nella pagina Use case (P0-1, DESIGN §2.1).
  // `USE_CASE_HUB_WORKSPACES`: `*` = ogni workspace, anche in produzione; `USE_CASE_HUB_EXCLUDE` la spegne per alcuni.
  const hub = parseHubWorkspaceList(env.USE_CASE_HUB_WORKSPACES);
  const hubExcluded = parsePlainUuidList(env.USE_CASE_HUB_EXCLUDE);
  if (hub.ignored.length > 0) out.push(check("USE_CASE_HUB_WORKSPACES.voci", "avviso", `${hub.ignored.length} voci scartate: l'elenco è «*» oppure UUID separati da virgole.`));
  if (hubExcluded.ignored.length > 0) out.push(check("USE_CASE_HUB_EXCLUDE.voci", "avviso", `${hubExcluded.ignored.length} voci scartate: gli esclusi sono UUID separati da virgole («*» qui non spegne nulla).`));
  if (list.wildcard && !prod) {
    out.push(
      hub.wildcard && hubExcluded.ids.length === 0
        ? check("USE_CASE_HUB_WORKSPACES", "ok", "«*» anche qui: ogni workspace dei dossier ha la pagina Use case accesa.")
        : check("USE_CASE_HUB_WORKSPACES", "avviso", "Con «*» non si può controllare che ogni workspace dei dossier abbia la pagina Use case."),
    );
  } else if (list.ids.size > 0) {
    const missing = [...list.ids].filter((id) => !hubAreaOn(id, hub, hubExcluded));
    out.push(
      missing.length === 0
        ? check("USE_CASE_HUB_WORKSPACES", "ok", hub.wildcard ? "«*»: ogni workspace dei dossier ha anche la pagina Use case accesa." : "Ogni workspace dei dossier ha anche la pagina Use case accesa.")
        : check(
            "USE_CASE_HUB_WORKSPACES",
            prod ? "errore" : "avviso",
            `${missing.length} workspace in UC_WORKSPACE_IDS senza la pagina Use case (fuori da USE_CASE_HUB_WORKSPACES o in USE_CASE_HUB_EXCLUDE): accendi prima la pagina Use case.`,
          ),
    );
  }

  // Domini di Lateral Space.
  const domains = parseLsDomains(env.UC_LS_EMAIL_DOMAINS);
  out.push(
    domains.length > 0
      ? check("UC_LS_EMAIL_DOMAINS", "ok", `${domains.length} domini di Lateral Space.`)
      : check("UC_LS_EMAIL_DOMAINS", on ? "errore" : "avviso", "Manca: nessuno risulta di Lateral Space e la sezione è in sola lettura («Configurazione incompleta»)."),
  );

  // Segreti.
  out.push(has(env.UC_SECRET) ? check("UC_SECRET", "ok", "Presente.") : check("UC_SECRET", on ? strict(true) : "avviso", "Manca: senza, le scritture pubbliche dei link rispondono 503 in produzione e gli IP non hanno hash."));
  out.push(has(env.CRON_SECRET) ? check("CRON_SECRET", "ok", "Presente.") : check("CRON_SECRET", on ? strict(true) : "avviso", "Manca: i cron uc-reminders e uc-freshness rispondono 401."));

  // Schema: in produzione solo la sonda (P0-2). Lì Vercel imposta VERCEL_ENV=production.
  const selfHeal = ucSelfHealEnabled(prod ? { ...env, VERCEL_ENV: "production" } : env);
  if (prod) {
    out.push(
      selfHeal
        ? check("UC_SCHEMA_SELF_HEAL", "errore", "In produzione va spento: togli la variabile o scrivi «off». Il DDL uc si applica a mano con la migrazione 0018.")
        : check("UC_SCHEMA_SELF_HEAL", "ok", "Spento: l'app esegue solo la sonda dello schema."),
    );
  } else {
    out.push(check("UC_SCHEMA_SELF_HEAL", "ok", selfHeal ? "Self-heal acceso (ammesso fuori produzione, su un ramo Neon di sviluppo)." : "off: solo la sonda dello schema."));
  }

  // Origine dei link nelle email.
  const origin = appOrigin(env);
  if (!origin) {
    out.push(check("NEXT_PUBLIC_APP_URL", on ? strict(true) : "avviso", "Manca l'indirizzo pubblico dell'app: le notifiche restano in coda («email non configurata»)."));
  } else {
    let url: URL | null = null;
    try {
      url = new URL(/^https?:\/\//.test(origin.value) ? origin.value : `https://${origin.value}`);
    } catch {
      url = null;
    }
    if (!url) out.push(check("NEXT_PUBLIC_APP_URL", "errore", `${origin.name} non è un indirizzo valido.`));
    else if (url.protocol === "https:") out.push(check("NEXT_PUBLIC_APP_URL", "ok", `${origin.name} in https (${url.host}).`));
    else if (environment === "local" && LOOPBACK.has(url.hostname)) out.push(check("NEXT_PUBLIC_APP_URL", "ok", `${origin.name} in http su loopback (solo harness).`));
    else out.push(check("NEXT_PUBLIC_APP_URL", "errore", `${origin.name} deve essere https (oggi ${url.protocol.replace(":", "")}).`));
  }

  // Email.
  const mail = has(env.RESEND_API_KEY) && has(env.UC_EMAIL_FROM);
  out.push(mail ? check("UC_EMAIL_FROM", "ok", "Resend e mittente presenti.") : check("UC_EMAIL_FROM", "avviso", "Email non configurate (RESEND_API_KEY o UC_EMAIL_FROM): le notifiche restano in coda e Lateral Space copia i link a mano."));
  // Reply-to: il mittente sta su un sottodominio che non riceve posta. Mai il valore nel rapporto.
  if (!has(env.UC_EMAIL_REPLY_TO)) {
    out.push(check("UC_EMAIL_REPLY_TO", "avviso", "Reply-to non impostato: le email partono senza reply-to e una risposta al mittente si perde (chi chiede a un referente resta il reply-to delle sue email)."));
  } else if (!emailReplyTo(env)) {
    out.push(check("UC_EMAIL_REPLY_TO", "avviso", "Reply-to non valido (serve un solo indirizzo semplice, senza nome né virgole): si ignora e le email partono senza reply-to."));
  } else {
    out.push(check("UC_EMAIL_REPLY_TO", "ok", "Reply-to presente."));
  }

  // Archivi dei file.
  const local = has(env.UC_LOCAL_STORAGE_DIR);
  if (environment === "local") {
    out.push(local || has(env.BLOB_READ_WRITE_TOKEN) ? check("BLOB_READ_WRITE_TOKEN", "ok", local ? "Archivio locale (UC_LOCAL_STORAGE_DIR)." : "Store Blob standard presente.") : check("BLOB_READ_WRITE_TOKEN", "avviso", "Nessun archivio: i caricamenti sono spenti."));
  } else {
    if (local) out.push(check("UC_LOCAL_STORAGE_DIR", "avviso", "Impostata fuori dal harness: su Vercel si ignora, toglila."));
    out.push(has(env.BLOB_READ_WRITE_TOKEN) ? check("BLOB_READ_WRITE_TOKEN", "ok", "Store Blob standard presente.") : check("BLOB_READ_WRITE_TOKEN", on ? strict(true) : "avviso", "Manca lo store Blob standard: i caricamenti dei file sono spenti."));
  }

  // Zona personale: chiave e store separato vanno insieme, e solo dopo la scheda A.8.
  const key = env.UC_PERSONAL_ZONE_KEY;
  const personalToken = env.UC_PERSONAL_BLOB_READ_WRITE_TOKEN;
  if (!has(key) && !has(personalToken)) {
    out.push(check("UC_PERSONAL_ZONE_KEY", "ok", "Zona personale chiusa (nessuna chiave né store): dati personali rifiutati."));
  } else {
    if (has(key)) {
      const bytes = base64Bytes(key!);
      out.push(bytes === 32 ? check("UC_PERSONAL_ZONE_KEY", "ok", "Chiave di 32 byte presente.") : check("UC_PERSONAL_ZONE_KEY", "errore", "La chiave deve essere di 32 byte in base64 (openssl rand -base64 32)."));
    } else {
      out.push(check("UC_PERSONAL_ZONE_KEY", "avviso", "Store personale senza chiave: la zona personale resta chiusa."));
    }
    if (environment !== "local" || !local) {
      if (!has(personalToken)) out.push(check("UC_PERSONAL_BLOB_READ_WRITE_TOKEN", "avviso", "Chiave senza store personale: la zona personale resta chiusa."));
      else if (personalToken!.trim() === env.BLOB_READ_WRITE_TOKEN?.trim()) out.push(check("UC_PERSONAL_BLOB_READ_WRITE_TOKEN", "errore", "Deve essere uno store Blob separato da quello standard."));
      else out.push(check("UC_PERSONAL_BLOB_READ_WRITE_TOKEN", "ok", "Store personale separato presente."));
    }
  }

  return out;
}

// ── Database ──────────────────────────────────────────────────────────

/**
 * Fatti letti dal database, tutti in sola lettura (`SET TRANSACTION READ ONLY`).
 * `ucTables` è il numero di tabelle uc presenti; con 0 la sezione non è mai
 * stata migrata e gli altri numeri non contano.
 */
export interface UcDbFacts {
  ucTables: number;
  probeCurrent: boolean;
  /** Gruppi di dossier sulla stessa scheda e righe coinvolte, complete e incomplete (stessa condizione della 0020). */
  duplicateGroups: number;
  duplicateRows: number;
  uniqueIndex: boolean;
  /** Dossier completi senza scheda madre (`dossier-links` della pagina Use case). */
  orphanDossiers: number;
  /** Workspace di `UC_WORKSPACE_IDS` che esistono nel database. */
  listedWorkspacesFound: number;
  listedWorkspaces: number;
}

/** Tabelle uc presenti. */
export const DOCTOR_TABLES_SQL = `SELECT count(*)::int AS n FROM unnest($1::text[]) AS t(name) WHERE to_regclass('public.' || t.name) IS NOT NULL`;

/** Doppioni: righe di `uc_cases` sulla stessa scheda, complete e incomplete (`docs/use-case/DESIGN.md` §10.4). */
export const DOCTOR_DUPLICATES_SQL = `SELECT count(*)::int AS groups, coalesce(sum(n), 0)::int AS rows FROM (
  SELECT count(*) AS n FROM uc_cases WHERE portfolio_use_case_id IS NOT NULL GROUP BY portfolio_use_case_id HAVING count(*) > 1
) d`;

export const DOCTOR_INDEX_SQL = `SELECT to_regclass('public.${UC_UNIQUE_DOSSIER_INDEX}') IS NOT NULL AS present`;

/** Dossier completi senza scheda madre. */
export const DOCTOR_ORPHANS_SQL = `SELECT count(*)::int AS n FROM uc_cases WHERE setup_completed_at IS NOT NULL AND portfolio_use_case_id IS NULL`;

export const DOCTOR_WORKSPACES_SQL = `SELECT count(*)::int AS n FROM workspaces WHERE id = ANY($1::uuid[])`;

/** Le tabelle uc attese (per `DOCTOR_TABLES_SQL`). */
export const DOCTOR_UC_TABLES: readonly string[] = UC_TABLE_NAMES;

export function checkUcDatabase(facts: UcDbFacts, o: { environment: DoctorEnvironment; ucEnabled: boolean }): DoctorCheck[] {
  const out: DoctorCheck[] = [];
  const expected = DOCTOR_UC_TABLES.length;
  if (facts.ucTables === 0) {
    out.push(check("schema", o.ucEnabled ? "errore" : "avviso", "Nessuna tabella uc: applica la migrazione 0018 (RUNBOOK §3)."));
    return out;
  }
  if (facts.ucTables < expected) out.push(check("schema", "errore", `${facts.ucTables} tabelle uc su ${expected}: la 0018 è applicata a metà.`));
  out.push(
    facts.probeCurrent
      ? check("sonda", "ok", "Schema uc aggiornato (sonda vera).")
      : check("sonda", "errore", "La sonda dello schema uc è falsa: riapplica la 0018. Con UC_SCHEMA_SELF_HEAL=off la sezione risponde 503."),
  );
  out.push(
    facts.duplicateGroups === 0
      ? check("doppioni", "ok", "Nessun dossier doppio sulla stessa scheda (righe complete e incomplete).")
      : check("doppioni", "errore", `${facts.duplicateGroups} schede con più dossier (${facts.duplicateRows} righe, complete e incomplete): esegui use-case-admin dossier-dups prima della 0020.`),
  );
  out.push(
    facts.uniqueIndex
      ? check("indice_unico", "ok", "Indice unico tra dossier e scheda presente.")
      : check("indice_unico", "avviso", "Indice unico tra dossier e scheda assente: arriva con la 0020 (o con C11b). Fino ad allora /casi-duso non reindirizza."),
  );
  if (facts.orphanDossiers > 0) out.push(check("schede_madri", "avviso", `${facts.orphanDossiers} dossier senza scheda madre: use-case-admin dossier-links dopo la 0020.`));
  if (facts.listedWorkspaces > 0 && facts.listedWorkspacesFound < facts.listedWorkspaces) {
    out.push(check("workspace", "avviso", `${facts.listedWorkspaces - facts.listedWorkspacesFound} workspace di UC_WORKSPACE_IDS non esistono in questo database.`));
  }
  return out;
}

/** 1 se c'è almeno un errore. */
export function doctorExitCode(checks: readonly DoctorCheck[]): 0 | 1 {
  return checks.some((c) => c.status === "errore") ? 1 : 0;
}

/** Testo per il terminale: una riga per controllo, poi il riepilogo. */
export function formatDoctorReport(checks: readonly DoctorCheck[]): string {
  const mark: Record<DoctorStatus, string> = { ok: "OK    ", avviso: "AVVISO", errore: "ERRORE" };
  const lines = checks.map((c) => `${mark[c.status]}  ${c.key}: ${c.message}`);
  const n = (s: DoctorStatus) => checks.filter((c) => c.status === s).length;
  lines.push("", `${n("ok")} ok, ${n("avviso")} avvisi, ${n("errore")} errori.`);
  return lines.join("\n");
}

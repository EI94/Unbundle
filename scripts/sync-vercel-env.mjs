#!/usr/bin/env node
/**
 * Legge .env.local e crea/aggiorna le variabili su Vercel (ambiente **production**).
 * Per le Preview (PR) configura le stesse chiavi dalla dashboard Vercel
 * (Environment → Preview → “All preview branches”) oppure usa `vercel env add … preview main`.
 * Uso: npm run vercel:env:sync
 * Richiede: progetto già collegato (`vercel link`) e CLI autenticata (`vercel login`).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

const root = resolve(process.cwd());
const envFile = resolve(root, ".env.local");

if (!existsSync(envFile)) {
  console.error("Manca .env.local nella root del progetto.");
  process.exit(1);
}

const PRODUCTION_APP_URL =
  process.env.VERCEL_PRODUCTION_URL ||
  "https://unbundle-flame.vercel.app";

function parseEnvFile(content) {
  const out = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function vercelEnvAdd(name, environment, value, { sensitive = false } = {}) {
  if (!value) {
    console.warn(`Salto ${name} (${environment}): valore vuoto`);
    return true;
  }
  const vercelBin = resolve(root, "node_modules", ".bin", "vercel");
  const args = ["env", "add", name, environment, "--yes", "--force"];
  if (sensitive) args.push("--sensitive");
  const cmd = existsSync(vercelBin) ? vercelBin : "npx";
  const finalArgs = cmd === "npx" ? ["vercel@latest", ...args] : args;
  const r = spawnSync(cmd, finalArgs, {
    cwd: root,
    input: value,
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.status !== 0) {
    console.error(`Errore aggiungendo ${name} → ${environment}`);
    return false;
  }
  return true;
}

const vars = parseEnvFile(readFileSync(envFile, "utf8"));

const cronSecret =
  vars.CRON_SECRET?.trim() ||
  (() => {
    const g = randomBytes(24).toString("base64url");
    console.log(
      "\nCRON_SECRET non presente in .env.local. Generato per Vercel:\n" +
        `CRON_SECRET=${g}\n` +
        "Aggiungi questa riga a .env.local per testare il cron in locale.\n",
    );
    return g;
  })();

/** @type {Array<{ name: string, sensitive: boolean, getValue: (env: string) => string | null }>} */
const definitions = [
  {
    name: "DATABASE_URL",
    sensitive: true,
    getValue: () => vars.DATABASE_URL || null,
  },
  {
    name: "NEXT_PUBLIC_FIREBASE_API_KEY",
    sensitive: false,
    getValue: () => vars.NEXT_PUBLIC_FIREBASE_API_KEY || null,
  },
  {
    name: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    sensitive: false,
    getValue: () => vars.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || null,
  },
  {
    name: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    sensitive: false,
    getValue: () => vars.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null,
  },
  {
    name: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    sensitive: false,
    getValue: () => vars.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || null,
  },
  {
    name: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    sensitive: false,
    getValue: () => vars.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || null,
  },
  {
    name: "NEXT_PUBLIC_FIREBASE_APP_ID",
    sensitive: false,
    getValue: () => vars.NEXT_PUBLIC_FIREBASE_APP_ID || null,
  },
  {
    name: "FIREBASE_ADMIN_CLIENT_EMAIL",
    sensitive: true,
    getValue: () => vars.FIREBASE_ADMIN_CLIENT_EMAIL || null,
  },
  {
    name: "FIREBASE_ADMIN_PRIVATE_KEY",
    sensitive: true,
    getValue: () => vars.FIREBASE_ADMIN_PRIVATE_KEY || null,
  },
  {
    name: "ANTHROPIC_API_KEY",
    sensitive: true,
    getValue: () => vars.ANTHROPIC_API_KEY || null,
  },
  {
    name: "BLOB_READ_WRITE_TOKEN",
    sensitive: true,
    getValue: () => vars.BLOB_READ_WRITE_TOKEN || null,
  },
  {
    name: "UPSTASH_REDIS_REST_URL",
    sensitive: true,
    getValue: () => vars.UPSTASH_REDIS_REST_URL || null,
  },
  {
    name: "UPSTASH_REDIS_REST_TOKEN",
    sensitive: true,
    getValue: () => vars.UPSTASH_REDIS_REST_TOKEN || null,
  },
  {
    name: "RESEND_API_KEY",
    sensitive: true,
    getValue: () => vars.RESEND_API_KEY || null,
  },
  {
    name: "CRON_SECRET",
    sensitive: true,
    getValue: () => cronSecret,
  },
  {
    name: "NEXT_PUBLIC_APP_URL",
    sensitive: false,
    getValue: (env) =>
      env === "production" ? PRODUCTION_APP_URL : null,
  },
  {
    name: "SLACK_DEFAULT_WORKSPACE_ID",
    sensitive: false,
    getValue: () => vars.SLACK_DEFAULT_WORKSPACE_ID?.trim() || null,
  },
  // Casi d'uso (docs/casi-duso/AMBIENTE.md). Solo i nomi: i valori arrivano da
  // .env.local e una variabile assente viene saltata. UC_ADMIN_DATABASE_URL e
  // UC_LOCAL_STORAGE_DIR non vanno mai su Vercel (script operatore e harness locale).
  // Gli interruttori e la chiave della zona personale NON si copiano da qui
  // (DESIGN §7.1 P0-1): UC_ENABLED, UC_WORKSPACE_IDS, UC_SCHEMA_SELF_HEAL e
  // UC_PERSONAL_ZONE_KEY si impostano a mano, ambiente per ambiente, nella
  // dashboard di Vercel (docs/casi-duso/RUNBOOK.md). Così un .env.local di
  // sviluppo non accende mai la sezione in produzione.
  {
    name: "UC_SECRET",
    sensitive: true,
    getValue: () => vars.UC_SECRET || null,
  },
  {
    name: "UC_LS_EMAIL_DOMAINS",
    sensitive: false,
    getValue: () => vars.UC_LS_EMAIL_DOMAINS?.trim() || null,
  },
  {
    name: "UC_PERSONAL_BLOB_READ_WRITE_TOKEN",
    sensitive: true,
    getValue: () => vars.UC_PERSONAL_BLOB_READ_WRITE_TOKEN || null,
  },
  {
    name: "UC_EMAIL_FROM",
    sensitive: false,
    getValue: () => vars.UC_EMAIL_FROM?.trim() || null,
  },
];

const targets = ["production"];

console.log(
  `Sincronizzazione env su Vercel (${targets.join(", ")})…\n` +
    `NEXT_PUBLIC_APP_URL produzione: ${PRODUCTION_APP_URL}\n`,
);

for (const env of targets) {
  for (const def of definitions) {
    const value = def.getValue(env);
    if (!value && def.name !== "CRON_SECRET") continue;
    if (!value) continue;
    vercelEnvAdd(def.name, env, value, { sensitive: def.sensitive });
  }
}

console.log(
  "\nFatto. Firebase Auth configurato su Vercel.\n" +
    `Dominio produzione: ${PRODUCTION_APP_URL}\n`,
);

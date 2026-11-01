import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { cert } from "firebase-admin/app";
import { normalizeServiceAccountKey } from "./private-key.ts";

// Chiavi usa e getta, generate qui: nessuna chiave vera entra nei test.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
const der = privateKey.export({ type: "pkcs8", format: "der" });

function parts(pem: string) {
  const lines = pem.trim().split("\n");
  return { head: lines[0], body: lines.slice(1, -1).join(""), foot: lines[lines.length - 1] };
}
const { head, body, foot } = parts(pkcs8);
const bodyLines = pkcs8.trim().split("\n").slice(1, -1);

/** Le grafie che firebase-admin 13.8 (node-forge) accettava. */
const SPELLINGS: Record<string, string> = {
  "PKCS#8 standard": pkcs8,
  "a capo CRLF": pkcs8.replace(/\n/g, "\r\n"),
  "righe vuote prima e dopo": `\n\n${pkcs8}\n\n`,
  "righe vuote dentro i marcatori": `${head}\n\n${bodyLines.join("\n")}\n\n${foot}\n`,
  "corpo su una riga tra BEGIN ed END": `${head}\n${body}\n${foot}\n`,
  "corpo sulla riga di BEGIN": `${head}${bodyLines.join("\n")}\n${foot}\n`,
  "spazi al posto degli a capo": `${head} ${bodyLines.join(" ")} ${foot}`,
  "spazi in testa alle righe": pkcs8.replace(/^/gm, "  "),
  "PKCS#1": pkcs1,
  "PKCS#1 senza a capo": pkcs1.replace(/\n/g, ""),
  "\\n letterali": pkcs8.replace(/\n/g, "\\n"),
  "tra virgolette come nel JSON": JSON.stringify(pkcs8),
  "tra virgolette con a capo veri": `"${pkcs8}"`,
  "tutti gli a capo tolti": pkcs8.replace(/\n/g, ""),
  "tutti gli a capo tolti, \\n letterale in coda": `${head}${body}${foot}\\n`,
};

for (const [name, spelling] of Object.entries(SPELLINGS)) {
  test(`cert() e createPrivateKey accettano la chiave: ${name}`, () => {
    const key = normalizeServiceAccountKey(spelling);
    const parsed = createPrivateKey(key);
    assert.deepEqual(parsed.export({ type: "pkcs8", format: "der" }), der, "la stessa chiave, non un'altra");
    assert.doesNotThrow(() =>
      cert({ projectId: "demo-test", clientEmail: "sa@demo-test.iam.gserviceaccount.com", privateKey: key }),
    );
  });
}

test("una chiave standard esce identica byte per byte, PKCS#8 e PKCS#1", () => {
  assert.equal(normalizeServiceAccountKey(pkcs8), pkcs8);
  assert.equal(normalizeServiceAccountKey(pkcs1), pkcs1);
});

test("senza a capo si ricostruisce il PEM standard: 64 caratteri per riga, a capo finale", () => {
  assert.equal(normalizeServiceAccountKey(pkcs8.replace(/\n/g, "")), pkcs8);
  assert.equal(normalizeServiceAccountKey(`${head}\n${body}\n${foot}`), pkcs8);
  assert.equal(normalizeServiceAccountKey(JSON.stringify(pkcs8.replace(/\n/g, ""))), pkcs8);
});

test("i marcatori PKCS#1 restano «RSA PRIVATE KEY»", () => {
  const key = normalizeServiceAccountKey(pkcs1.replace(/\n/g, ""));
  assert.equal(key, pkcs1);
  assert.match(key, /^-----BEGIN RSA PRIVATE KEY-----\n/);
});

test("un valore senza marcatori resta com'è e cert() dà il suo errore", () => {
  assert.equal(normalizeServiceAccountKey("non una chiave"), "non una chiave");
  assert.equal(normalizeServiceAccountKey(body), body);
  assert.throws(() =>
    cert({ projectId: "demo-test", clientEmail: "sa@demo-test.iam.gserviceaccount.com", privateKey: "non una chiave" }),
  );
});

test("admin.ts si avvia con la chiave salvata senza a capo", async () => {
  const names = ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", "FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_ADMIN_PRIVATE_KEY", "NEXT_PHASE"] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "demo-test";
  process.env.FIREBASE_ADMIN_CLIENT_EMAIL = "sa@demo-test.iam.gserviceaccount.com";
  process.env.FIREBASE_ADMIN_PRIVATE_KEY = pkcs8.replace(/\n/g, "");
  delete process.env.NEXT_PHASE;
  try {
    const { adminApp } = await import("./admin.ts");
    assert.ok(adminApp.options.credential, "l'app ha la credenziale dell'account di servizio");
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

// The Unbundle «U» mark of the use case e-mails (release 5.1): public/email/unbundle-u.png, a static
// 96×96 PNG that the e-mails show at 32×32 (`UC_EMAIL_LOGO_PATH` in src/lib/uc/notify/email-render.ts).
// Same identity as the favicon and the Apple icon (src/app/icon.tsx, src/app/apple-icon.tsx): a white
// «U» on BRAND.fg, here with rounded corners. E-mail clients do not show SVG, hence a PNG.
//
//   node scripts/render-email-logo.mjs            # writes public/email/unbundle-u.png
//   node scripts/render-email-logo.mjs --check    # exits 1 when the committed file differs
//
// Uses only the ImageResponse bundled with Next (no network, no font download).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "email", "unbundle-u.png");
const { ImageResponse } = await import(join(root, "node_modules/next/dist/compiled/@vercel/og/index.node.js"));

const SIZE = 96;
const mark = {
  type: "div",
  props: {
    style: {
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#0a0a0a",
      color: "#ffffff",
      fontSize: 70,
      letterSpacing: -3,
      borderRadius: 18,
    },
    children: "U",
  },
};

const bytes = Buffer.from(await new ImageResponse(mark, { width: SIZE, height: SIZE }).arrayBuffer());
if (process.argv.includes("--check")) {
  const same = existsSync(out) && Buffer.compare(readFileSync(out), bytes) === 0;
  console.log(same ? "public/email/unbundle-u.png is up to date" : "public/email/unbundle-u.png differs: run node scripts/render-email-logo.mjs");
  process.exit(same ? 0 : 1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(`wrote public/email/unbundle-u.png (${bytes.length} bytes, ${SIZE}×${SIZE})`);

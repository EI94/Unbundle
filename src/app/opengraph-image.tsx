import {
  OG_ALT,
  OG_CONTENT_TYPE,
  OG_SIZE,
  renderOgImage,
} from "@/lib/seo/og-image";

/**
 * OG image per la home — usata da Slack, LinkedIn, Twitter, WhatsApp,
 * Telegram, Google Discover. Render condiviso in `lib/seo/og-image.tsx`.
 */
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpenGraphImage() {
  return renderOgImage();
}

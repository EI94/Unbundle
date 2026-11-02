import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_BOOT_SCRIPT } from "@/components/theme/theme-config";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  SITE_CATEGORY,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_LOCALE,
  SITE_NAME,
  SITE_PUBLISHER,
  SITE_SOCIAL,
  SITE_TAGLINE,
  SITE_URL,
} from "@/lib/seo/site-config";
import {
  jsonLdScriptProps,
  organizationJsonLd,
  websiteJsonLd,
} from "@/lib/seo/structured-data";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_PUBLISHER, url: SITE_URL }],
  creator: SITE_PUBLISHER,
  publisher: SITE_PUBLISHER,
  category: SITE_CATEGORY,
  keywords: [...SITE_KEYWORDS],
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: "/",
    languages: {
      "it-IT": "/",
      "x-default": "/",
    },
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: SITE_LOCALE,
    url: SITE_URL,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    ...(SITE_SOCIAL.twitterSite ? { site: SITE_SOCIAL.twitterSite } : {}),
    ...(SITE_SOCIAL.twitterCreator
      ? { creator: SITE_SOCIAL.twitterCreator }
      : {}),
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Prima del corpo della pagina: sulle pagine del dashboard il tema scelto vale già al primo
            fotogramma, anche su una rete lenta (theme-config.ts). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* Il tema scelto (Scuro, Chiaro, Come il sistema): per primo, così il suo script scrive
            `data-theme` su <html> prima del resto della pagina (sul dashboard lo script del <head>
            l'ha già scritto), e lo cambia quando si sceglie dal menu. */}
        <ThemeProvider>
          {/* JSON-LD globali: Organization + WebSite. Una sola volta sito-wide. */}
          <script
            {...jsonLdScriptProps([organizationJsonLd(), websiteJsonLd()])}
          />
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}

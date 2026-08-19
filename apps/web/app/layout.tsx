import { ModeProvider } from "@/components/mode";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Usance — make tokenized assets usable as capital",
  // From the shipped kit. BRAND_LOCK.md fixes the geometry of the Capacity Cut mark, so these are
  // referenced rather than regenerated at other sizes.
  icons: {
    icon: [
      { url: "/assets/brand/favicon.ico", sizes: "any" },
      { url: "/assets/brand/svg/favicon.svg", type: "image/svg+xml" },
      { url: "/assets/brand/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/assets/brand/apple-touch-icon.png",
  },
  manifest: "/assets/brand/site.webmanifest",
  openGraph: {
    title: "Usance — make tokenized assets usable as capital",
    description:
      "Usance verifies what a tokenized asset actually is, recognises a conservative portion of it as collateral, and lets you finance against it without selling.",
    images: [{ url: "/assets/social/og-background.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: ["/assets/social/og-background.png"] },
  description:
    "Usance is a clearing and risk layer on X Layer. It verifies what a tokenized asset actually is, recognises a conservative portion of it as collateral, and lets you finance against it without selling.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f7f5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          The hero is the largest contentful paint. `priority` on the component emits this too, but
          only after React resolves the tree — this sits in the static HTML, so the browser starts
          fetching while the bundle is still parsing.
        */}
        <link rel="preload" as="image" href="/images/hero-landscape.webp" type="image/webp" fetchPriority="high" />
      </head>
      <body>
        <ModeProvider>{children}</ModeProvider>
      </body>
    </html>
  );
}

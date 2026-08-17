import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Usance — make tokenized assets usable as capital",
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
      <body>{children}</body>
    </html>
  );
}

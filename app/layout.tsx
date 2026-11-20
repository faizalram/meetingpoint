import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

// Barlow (SIL Open Font License): a grotesk drawn from road signs and licence plates
const barlow = localFont({
  src: [
    { path: "./fonts/Barlow-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Barlow-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Barlow-Bold.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-barlow",
});

export const metadata: Metadata = {
  title: "MeetingPoint",
  description: "Find a fair place to meet when everyone starts from a different part of the city.",
  appleWebApp: { capable: true, title: "MeetingPoint", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e131b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={barlow.variable}>
      <body>{children}</body>
    </html>
  );
}

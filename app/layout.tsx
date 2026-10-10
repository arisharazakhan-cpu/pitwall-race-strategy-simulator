import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PitWall | F1 Race Strategy Simulator",
  description: "Interactive race strategy simulation, telemetry analysis, and pit-window decision support.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

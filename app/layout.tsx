import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smooth Studios | Team Dashboard",
  description: "Private rental schedules, revenue, and team earnings for Smooth Studios.",
  icons: {
    icon: "/smooth-studios-logo.png",
    shortcut: "/smooth-studios-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { dashboardBasePath } from "@/lib/site-path.mjs";
import "./globals.css";

const siteBasePath = dashboardBasePath();
const studioLogoUrl = `${siteBasePath}/smooth-studios-logo.png`;

export const metadata: Metadata = {
  title: "Smooth Studios | Team Dashboard",
  description: "Private rental schedules, revenue, and team earnings for Smooth Studios.",
  manifest: `${siteBasePath}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "Smooth Studios", statusBarStyle: "default" },
  icons: {
    icon: [{ url: studioLogoUrl, type: "image/png", sizes: "2000x2000" }],
    shortcut: studioLogoUrl,
    apple: studioLogoUrl,
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

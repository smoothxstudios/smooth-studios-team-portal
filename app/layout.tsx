import { DashboardReleaseInfo } from "@/components/dashboard-release-info";
import history from "@/config/dashboard-releases.json";
import { dashboardBasePath } from "@/lib/site-path.mjs";
import type { Metadata } from "next";
import "./globals.css";

// Keep the shared visual system last: it overrides legacy page styles.
import "./design-system.css";

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
      <body className="antialiased"><DashboardReleaseInfo info={{version:history.currentVersion,date:history.releases[0].date}}>{children}</DashboardReleaseInfo></body>
    </html>
  );
}

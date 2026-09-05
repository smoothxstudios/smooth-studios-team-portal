import type { Metadata } from "next";
import "./globals.css";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "smooth-studios-team-portal";
const siteBasePath = process.env.GITHUB_ACTIONS === "true" ? `/${repositoryName}` : "";
const studioLogoUrl = `${siteBasePath}/smooth-studios-logo.png`;

export const metadata: Metadata = {
  title: "Smooth Studios | Team Dashboard",
  description: "Private rental schedules, revenue, and team earnings for Smooth Studios.",
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

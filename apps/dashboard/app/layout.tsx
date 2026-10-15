import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Smart Money Alerts", description: "Filtered wallet-position alerts to Slack" };

const NAV = [
  ["/events", "Events"],
  ["/clusters", "Clusters"],
  ["/wallets", "Wallets"],
  ["/rules", "Rules"],
  ["/health", "Health"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-zinc-800">
          <nav className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-2">
            <span className="mr-4 text-sm font-semibold tracking-tight">💸 Smart Money Alerts</span>
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="rounded px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white">
                {label}
              </Link>
            ))}
            <span className="flex-1" />
            <a href="/auth/signout" className="text-xs text-zinc-500 hover:text-zinc-300">
              Sign out
            </a>
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

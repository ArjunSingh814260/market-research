import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Accord Market Data",
  description: "Frontend for the Accord Fintech data feed API",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const mock = process.env.ACCORD_MOCK === "true";
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3">
            <Link href="/" className="whitespace-nowrap font-semibold">
              📈 Accord Market Data
            </Link>
            <Link href="/" className="whitespace-nowrap text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
              Data Explorer
            </Link>
            <Link href="/live" className="whitespace-nowrap text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">
              NSE Live
            </Link>
            {mock && (
              <span className="ml-auto rounded bg-violet-600 px-2 py-0.5 text-xs font-medium text-white">
                MOCK MODE
              </span>
            )}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

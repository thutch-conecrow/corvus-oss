import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Corvus Ledger",
  description: "A planning ledger for bootstrapping ventures",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

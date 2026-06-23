import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "mini-ro",
  description: "A tiny, educational RO-like web game for friends.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

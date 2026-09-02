import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice latency: Mercury 2 vs Haiku 4.5",
  description:
    "Time to first audio for two LLMs behind an identical voice pipeline. " +
    "Timings measured by a headless harness; this page renders them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

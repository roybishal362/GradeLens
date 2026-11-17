import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Caveat } from "next/font/google";
import "./globals.css";

// Atkinson Hyperlegible Next: built by the Braille Institute for legibility, which suits a tool for teachers.
const atkinson = Atkinson_Hyperlegible_Next({ variable: "--font-atkinson", subsets: ["latin"], display: "swap" });
// Caveat is used ONLY for marks written on or beside a script (pencil = AI suggestion, red pen = approved).
const caveat = Caveat({ variable: "--font-caveat", subsets: ["latin"], weight: ["600"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "GradeLens: mark handwritten answers with evidence", template: "%s | GradeLens" },
  description:
    "Mark a stack of handwritten answers in minutes. Every AI-suggested mark shows the student's own words as evidence, and nothing counts until a teacher approves it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${atkinson.variable} ${caveat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

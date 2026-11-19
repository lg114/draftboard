import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Draftboard",
  description: "从材料到可编辑 PPTX 的工作台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="topnav">
          <Link href="/" className="wordmark">
            Draftboard
          </Link>
        </header>
        {children}
      </body>
    </html>
  );
}
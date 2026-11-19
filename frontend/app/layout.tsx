import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { BackendStatus } from "../components/BackendStatus";

export const metadata: Metadata = {
  title: "Draftboard · AI 演示文稿工作台",
  description: "基于严密材料溯源与确定性排版引擎的 AI 演示文稿工作台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen flex flex-col bg-[#fafaf9] text-stone-800">
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-stone-200/80 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="w-7 h-7 rounded-lg bg-stone-900 flex items-center justify-center text-white text-xs font-bold tracking-tight shadow-xs hover:bg-stone-800 transition-colors"
            >
              D
            </Link>
            <Link
              href="/"
              className="font-bold tracking-tight text-stone-900 text-sm hover:text-stone-700 transition-colors"
            >
              Draftboard
            </Link>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium text-stone-500">
            <BackendStatus />
            <Link href="/" className="hover:text-stone-900 transition-colors">
              项目
            </Link>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}

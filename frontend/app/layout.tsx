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
      <body className="min-h-screen flex flex-col bg-[#f6f6f7] text-[#111827]">
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#e5e7eb] px-6 py-2.5 flex items-center justify-between gap-4 shadow-2xs">
          {/* Left: Brand Logo & Title */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="w-7 h-7 rounded-lg bg-[#111827] flex items-center justify-center text-white text-xs font-bold tracking-tight shadow-xs hover:bg-black transition-colors"
            >
              D
            </Link>
            <Link
              href="/"
              className="font-bold tracking-tight text-[#111827] text-sm hover:text-stone-700 transition-colors"
            >
              Draftboard
            </Link>
          </div>

          {/* Center: Kite-style Quick Search Bar */}
          <div className="hidden md:flex items-center gap-8 bg-[#f0f1f3] hover:bg-[#e9eaee] border border-transparent hover:border-[#d1d5db] rounded-xl px-3.5 py-1.5 text-xs text-[#6b7280] cursor-pointer transition-all">
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-[#9ca3af]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>搜索项目或材料...</span>
            </div>
            <span className="font-mono text-[10px] bg-white border border-[#e5e7eb] text-[#6b7280] px-1.5 py-0.5 rounded shadow-2xs">
              ⌘K
            </span>
          </div>

          {/* Right: Status Pill & Avatar */}
          <div className="flex items-center gap-3.5 text-xs font-medium text-[#4b5563]">
            <BackendStatus />
            <Link
              href="/"
              className="hover:text-[#111827] px-2.5 py-1 rounded-lg hover:bg-[#f0f1f3] transition-colors"
            >
              项目工坊
            </Link>
            <div
              className="w-7 h-7 rounded-full bg-[#d97706] text-white flex items-center justify-center text-[11px] font-bold shadow-2xs select-none"
              title="工作台账户"
            >
              DB
            </div>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}

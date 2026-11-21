import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Draftboard · AI 演示文稿工作台",
  description: "以原始材料为唯一依据，基于确定性排版引擎的 AI 演示文稿工作台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
        {children}
      </body>
    </html>
  );
}

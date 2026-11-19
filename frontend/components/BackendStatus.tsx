"use client";

import { useEffect, useState } from "react";

type StatusState = "checking" | "online" | "offline";

export function BackendStatus() {
  const [status, setStatus] = useState<StatusState>("checking");
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    async function checkHealth() {
      const start = performance.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const res = await fetch("/api/projects", {
          signal: controller.signal,
          cache: "no-store",
        });
        clearTimeout(timeoutId);

        if (!mounted) return;

        if (res.ok) {
          const ms = Math.round(performance.now() - start);
          setStatus("online");
          setLatency(ms);
        } else {
          setStatus("offline");
          setLatency(null);
        }
      } catch {
        if (!mounted) return;
        setStatus("offline");
        setLatency(null);
      }
    }

    // Check immediately
    void checkHealth();

    // Poll every 6 seconds
    const interval = setInterval(checkHealth, 6000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div
      title={
        status === "online"
          ? `后端服务已连接 (127.0.0.1:8000) · 延迟 ${latency ?? 0}ms`
          : status === "offline"
          ? "未检测到后端服务，请确认 draftboard serve 是否已启动"
          : "正在探测后端服务状态..."
      }
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border transition-all select-none cursor-default shadow-2xs ${
        status === "online"
          ? "bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]"
          : status === "offline"
          ? "bg-[#fdf2f8] text-[#db2777] border-[#fbcfe8]"
          : "bg-[#f1f3f5] text-[#6b7280] border-[#e2e4e8]"
      }`}
    >
      <span className="relative flex h-2 w-2">
        {status === "online" && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#34d399] opacity-75"></span>
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${
            status === "online"
              ? "bg-[#10b981]"
              : status === "offline"
              ? "bg-[#f43f5e]"
              : "bg-[#f59e0b] animate-pulse"
          }`}
        ></span>
      </span>

      <span className="font-sans font-medium">
        {status === "online"
          ? `API 在线${latency !== null ? ` · ${latency}ms` : ""}`
          : status === "offline"
          ? "API 离线"
          : "感应中..."}
      </span>
    </div>
  );
}

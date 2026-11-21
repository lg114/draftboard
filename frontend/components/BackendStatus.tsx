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
          setStatus("online");
          setLatency(Math.round(performance.now() - start));
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

    void checkHealth();
    const interval = setInterval(checkHealth, 8000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div
      title={
        status === "online"
          ? `后端已连接 · ${latency ?? 0}ms`
          : status === "offline"
          ? "未检测到后端服务，请启动 draftboard serve"
          : "检测连接中…"
      }
      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#6e6e73] select-none"
    >
      <span
        className={`w-2 h-2 rounded-full ${
          status === "online"
            ? "bg-[#34c759]"
            : status === "offline"
            ? "bg-[#ff3b30]"
            : "bg-[#ff9500] animate-pulse"
        }`}
      />
      <span>
        {status === "online"
          ? "服务就绪"
          : status === "offline"
          ? "服务离线"
          : "连接中"}
      </span>
    </div>
  );
}

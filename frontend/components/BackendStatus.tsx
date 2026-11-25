"use client";

import { useEffect, useState } from "react";

type StatusState = "checking" | "online" | "offline";

export function BackendStatus() {
  const [status, setStatus] = useState<StatusState>("checking");
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    async function checkHealth() {
      if (typeof document !== "undefined" && document.hidden) return;
      const start = performance.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch("/api/health", {
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

    const onVisibility = () => {
      if (!document.hidden) void checkHealth();
    };

    void checkHealth();
    const interval = setInterval(checkHealth, 8000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Silent when healthy or initializing — surface only when offline.
  if (status !== "offline") {
    return null;
  }

  return (
    <div
      title={
        latency !== null
          ? `连接异常 · ${latency}ms`
          : "未检测到后端服务，请启动 draftboard serve"
      }
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-danger-bg border border-danger/20 text-[13px] font-medium text-danger select-none"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-danger" />
      <span>服务离线</span>
    </div>
  );
}

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
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#fff2f2] border border-[#ff3b30]/20 text-[12px] font-medium text-[#c02620] select-none"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[#d70015]" />
      <span>服务离线</span>
    </div>
  );
}

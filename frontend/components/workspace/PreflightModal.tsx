"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, type PreflightReport } from "../../lib/api";
import { usePresence } from "../../lib/usePresence";

interface PreflightModalProps {
  open: boolean;
  pid: string;
  version: string;
  themeId: string;
  autoFit: boolean;
  onBeforeCheck?: () => Promise<string | void>;
  onJumpToSlide: (slideIndex: number) => void;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  layout: "排版安全",
  provenance: "事实溯源",
  media: "配图检查",
  notes: "演讲备注",
  rhythm: "视觉节奏",
};

/**
 * Pre-export readiness audit modal ("交付前体检") aggregating deterministic layout safety,
 * provenance coverage, media integrity, speaker notes, and rhythm diagnostics.
 */
export function PreflightModal({
  open,
  pid,
  version,
  themeId,
  autoFit,
  onBeforeCheck,
  onJumpToSlide,
  onClose,
}: PreflightModalProps) {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const onBeforeCheckRef = useRef(onBeforeCheck);
  onBeforeCheckRef.current = onBeforeCheck;

  const runCheck = useCallback(async () => {
    if (!pid || pid === "new" || !version) return;
    setLoading(true);
    setError("");
    try {
      const flushedVer = onBeforeCheckRef.current
        ? await onBeforeCheckRef.current()
        : undefined;
      const targetVer = flushedVer || version;
      const qs = new URLSearchParams({
        version: targetVer,
        theme_id: themeId,
        auto_fit: String(autoFit),
      });
      const res = await api<PreflightReport>(
        `/api/projects/${encodeURIComponent(pid)}/preflight?${qs.toString()}`
      );
      setReport(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [pid, version, themeId, autoFit]);

  useEffect(() => {
    if (!open) return;
    void runCheck();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, runCheck, onClose]);

  const { mounted, exiting } = usePresence(open, 140);
  if (!mounted) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="交付前可信度与排版体检"
      onClick={onClose}
      className={`fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4 sm:p-6 ${
        exiting ? "anim-scrim-out pointer-events-none" : "anim-scrim-in"
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-2xl max-h-[82vh] bg-surface rounded-2xl border border-black/[0.1] shadow-2xl flex flex-col overflow-hidden ${
          exiting ? "anim-modal-out" : "anim-modal-in"
        }`}
      >
        <div className="px-5 py-3.5 border-b border-black/[0.08] flex items-center justify-between gap-3 shrink-0 bg-surface-subtle">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-ink shrink-0" />
            <h2 className="text-[15px] font-semibold text-ink">
              交付体检
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={loading}
              onClick={() => void runCheck()}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[13px] font-medium text-ink-secondary hover:text-ink hover:bg-black/[0.06] cursor-pointer disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>重新检查</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭体检面板"
              className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-black/[0.06] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto clean-scroll p-5 space-y-5">
          {loading && !report && (
            <div className="py-10 text-center text-[13.5px] text-ink-secondary">
              正在逐页校验字体排版、素材溯源与配图完整性…
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-danger-bg border border-danger/20 text-[13px] text-danger">
              {error}
            </div>
          )}

          {report && (
            <>
              {/* Summary Hero */}
              <div className="p-4 rounded-2xl bg-canvas border border-black/[0.08] flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {report.ready ? (
                    <CheckCircle2 className="w-8 h-8 text-success shrink-0 anim-check-pop" />
                  ) : (
                    <AlertCircle className="w-8 h-8 text-danger shrink-0 anim-check-pop" />
                  )}
                  <div>
                    <div className="text-[15px] font-semibold text-ink">
                      {report.ready
                        ? "已通过交付门槛，可直接导出 PPTX / PDF"
                        : `发现 ${report.summary.error_count} 项阻塞问题，建议修复后导出`}
                    </div>
                    <div className="text-[13px] text-ink-secondary mt-0.5">
                      共检查 {report.total_slides} 页 · 阻塞 {report.summary.error_count} · 提醒{" "}
                      {report.summary.warning_count} · 建议 {report.summary.info_count}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[24px] font-bold tabular-nums text-ink leading-none">
                    {report.score}
                  </div>
                  <div className="text-[13px] text-ink-muted mt-0.5">
                    就绪评分
                  </div>
                </div>
              </div>

              {/* 4 Dimension Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="p-3 rounded-xl bg-surface-subtle border border-black/[0.07]">
                  <div className="text-[13px] text-ink-muted">排版安全</div>
                  <div
                    className={`text-[14px] font-semibold mt-1 ${
                      report.summary.layout_ok ? "text-success" : "text-danger"
                    }`}
                  >
                    {report.summary.layout_ok ? "全部通过" : "存在超框/冲突"}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-surface-subtle border border-black/[0.07]">
                  <div className="text-[13px] text-ink-muted">溯源完整度</div>
                  <div className="text-[14px] font-semibold text-ink mt-1 tabular-nums">
                    {report.summary.supported_slides} / {report.total_slides} 页
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-surface-subtle border border-black/[0.07]">
                  <div className="text-[13px] text-ink-muted">配图素材</div>
                  <div
                    className={`text-[14px] font-semibold mt-1 ${
                      report.summary.media_ok ? "text-success" : "text-danger"
                    }`}
                  >
                    {report.summary.media_ok ? "全部就绪" : "存在缺图"}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-surface-subtle border border-black/[0.07]">
                  <div className="text-[13px] text-ink-muted">演讲者备注</div>
                  <div className="text-[14px] font-semibold text-ink mt-1 tabular-nums">
                    {report.summary.notes_slides} / {report.total_slides} 页
                  </div>
                </div>
              </div>

              {/* Actionable Findings List */}
              {report.findings.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[13px] font-semibold text-ink-secondary">
                    问题与优化建议（点击直接定位页面）
                  </div>
                  <div className="space-y-2">
                    {report.findings.map((f, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          onJumpToSlide(f.slide_index);
                          onClose();
                        }}
                        className="w-full text-left p-3 rounded-xl bg-canvas hover:bg-surface-subtle border border-black/[0.07] hover:border-black/20 transition-all flex items-start gap-2.5 cursor-pointer"
                      >
                        {f.severity === "error" ? (
                          <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                        ) : f.severity === "warning" ? (
                          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                        ) : (
                          <Info className="w-4 h-4 text-ink-muted shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-2 text-[13px]">
                            <span className="font-semibold text-ink">
                              第 {f.slide_number} 页
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-surface border border-black/[0.08] text-ink-secondary">
                              {CATEGORY_LABELS[f.category] || f.category}
                            </span>
                          </div>
                          <p className="text-[13px] text-ink-secondary leading-relaxed">
                            {f.message}
                          </p>
                        </div>
                        <span className="text-[13px] font-medium text-ink shrink-0 self-center">
                          定位 ›
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-canvas border border-black/[0.07] text-[13.5px] text-ink-secondary text-center">
                  全稿排版安全、依据充分且视觉节奏均衡，没有发现需要修复的问题。
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

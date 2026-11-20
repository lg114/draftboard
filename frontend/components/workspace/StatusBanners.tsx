"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, X } from "lucide-react";

interface HumanizedError {
  title: string;
  desc: string;
}

interface StatusBannersProps {
  humanizedError: HumanizedError | null;
  rawError: string | null;
  canRetryOutline: boolean;
  status: string;
  statusKind: "" | "error" | "ok";
  msg: string;
  onRetryOutline: () => void;
  onDismissError: () => void;
}

export function StatusBanners({
  humanizedError,
  rawError,
  canRetryOutline,
  status,
  statusKind,
  msg,
  onRetryOutline,
  onDismissError,
}: StatusBannersProps) {
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  return (
    <>
      {humanizedError && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs text-rose-900 space-y-2 animate-in fade-in duration-200">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-semibold text-rose-950 text-sm">
                  {humanizedError.title}
                </div>
                <div className="text-rose-800 leading-relaxed font-sans">
                  {humanizedError.desc}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {canRetryOutline && (
                <button
                  type="button"
                  onClick={onRetryOutline}
                  className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
                >
                  重试
                </button>
              )}
              <button
                type="button"
                onClick={onDismissError}
                className="p-1 text-rose-500 hover:text-rose-800 rounded-lg transition-colors cursor-pointer"
                title="关闭错误提示"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {rawError && (
            <div className="pt-2 border-t border-rose-200/60 text-[11px]">
              <button
                type="button"
                onClick={() => setShowErrorDetails(!showErrorDetails)}
                className="text-rose-700 hover:text-rose-900 font-medium flex items-center gap-1 cursor-pointer"
              >
                <span>{showErrorDetails ? "收起技术日志" : "查看技术日志详情"}</span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${
                    showErrorDetails ? "rotate-180" : ""
                  }`}
                />
              </button>
              {showErrorDetails && (
                <pre className="mt-1.5 p-2 bg-rose-100/70 rounded-lg font-mono text-[10px] text-rose-900 overflow-x-auto whitespace-pre-wrap">
                  {rawError}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {status && statusKind !== "error" && (
        <div className="px-4 py-2.5 rounded-xl text-xs flex items-center justify-between bg-[#f9fafb] text-[#374151] border border-[#eaecf0] shadow-2xs">
          <div className="flex items-center gap-2 font-mono">
            {statusKind === "ok" ? (
              <CheckCircle2 className="w-4 h-4 text-[#059669]" />
            ) : (
              <Clock className="w-4 h-4 text-[#6b7280] animate-spin" />
            )}
            <span>{status}</span>
          </div>
        </div>
      )}

      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-xs bg-[#ecfdf5] text-[#059669] border border-[#a7f3d0] flex items-center gap-2 shadow-2xs">
          <CheckCircle2 className="w-4 h-4 text-[#059669]" />
          <span>{msg}</span>
        </div>
      )}
    </>
  );
}

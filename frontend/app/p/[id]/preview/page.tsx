"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ExportReport, Preview } from "../../../../lib/api";

export default function PreviewPage() {
  const params = useParams<{ id: string }>();
  const pid = params.id;

  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const p = await api<Preview>(`/api/projects/${pid}/preview`);
      setPreview(p);
      setSelected((s) => Math.min(s, p.pages.length - 1));
    } catch (e) {
      setPreview(null);
      setNotice((e as Error).message);
    }
    try {
      const r = await api<ExportReport>(`/api/projects/${pid}/result`);
      setReport(r);
    } catch {
      setReport(null);
    }
  }, [pid]);

  useEffect(() => {
    void load();
  }, [load]);

  async function renderNow() {
    setRendering(true);
    setNotice("正在渲染预览（LibreOffice），通常需要十几秒……");
    try {
      const p = await api<Preview>(`/api/projects/${pid}/preview/render`, {
        method: "POST",
      });
      setPreview(p);
      setNotice("");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setRendering(false);
    }
  }

  return (
    <main className="main wide">
      <h1>{pid} · 演示预览</h1>
      <div className="row meta">
        <Link href={`/p/${pid}`}>材料与大纲</Link>
        <a href={`/api/projects/${pid}/download`}>下载 PPTX</a>
        <button onClick={load}>刷新</button>
      </div>

      {report && !report.success && (
        <>
          <div className="msg error">最近一次导出未通过检查。</div>
          <ul className="issues">
            {report.issues.map((i, n) => (
              <li key={n}>
                [{i.code}]{i.slide_id ? ` ${i.slide_id}` : ""} {i.message}
              </li>
            ))}
          </ul>
          <div className="meta">
            请回到<Link href={`/p/${pid}`}>材料与大纲</Link>调整对应页的标题或摘要后重新生成。
          </div>
        </>
      )}

      {preview && (
        <div className="meta" style={{ marginTop: 8 }}>
          {preview.artifact_id} r{preview.artifact_revision} · 与下载文件同一次生成 ·
          预览由 LibreOffice 渲染，仅用于核对内容，最终效果以 PowerPoint 打开为准
        </div>
      )}

      {preview ? (
        <div className="preview-layout">
          <div className="thumbs">
            {preview.pages.map((src, idx) => (
              <button
                key={src}
                className={idx === selected ? "active" : ""}
                onClick={() => setSelected(idx)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`第 ${idx + 1} 页`} />
                <div className="num">{idx + 1}</div>
              </button>
            ))}
          </div>
          <div className="stage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.pages[selected]} alt={`第 ${selected + 1} 页大图`} />
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <div className="msg">{notice || "没有可预览的内容"}</div>
          {report?.success && (
            <button onClick={renderNow} disabled={rendering}>
              {rendering ? "渲染中……" : "渲染预览"}
            </button>
          )}
          {!report && (
            <div className="meta">
              先到<Link href={`/p/${pid}`}>材料与大纲</Link>生成一份 PPT。
            </div>
          )}
        </div>
      )}
    </main>
  );
}
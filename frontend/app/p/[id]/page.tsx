"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  jsonOptions,
  Issue,
  Material,
  Outline,
  Project,
  Task,
} from "../../../lib/api";

export default function MaterialsPage() {
  const params = useParams<{ id: string }>();
  const pid = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"" | "error" | "ok">("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState<"" | "error" | "ok">("");
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const showOutline = useCallback(
    async (v: string) => {
      const data = await api<Outline>(`/api/projects/${pid}/outlines/${v}`);
      setOutline(data);
      setVersion(v);
    },
    [pid]
  );

  const refresh = useCallback(async () => {
    const data = await api<Project>(`/api/projects/${pid}`);
    setProject(data);
    const mats = await api<{ materials: Material[] }>(`/api/projects/${pid}/materials`);
    setMaterials(mats.materials);
    const outlines = [...data.outlines].sort((a, b) => b.mtime - a.mtime);
    if (outlines.length > 0) {
      await showOutline(outlines[0].outline_version);
    } else {
      setOutline(null);
      setVersion("");
    }
    return data;
  }, [pid, showOutline]);

  const reportTask = useCallback(
    (task: Task) => {
      setStatus(
        `任务 ${task.task_id}：${task.status}${task.step ? " — " + task.step : ""}` +
          (task.status === "failed" ? `\n失败原因：${task.error ?? "未知"}` : "")
      );
      setStatusKind(task.status === "failed" ? "error" : "ok");
      if (task.status === "failed") {
        setIssues(task.result.export?.issues ?? task.result.validation?.issues ?? []);
      } else {
        setIssues([]);
      }
    },
    []
  );

  const startPolling = useCallback(
    (taskId: string) => {
      stopPolling();
      const tick = async () => {
        let task: Task;
        try {
          task = await api<Task>(`/api/projects/${pid}/tasks/${taskId}`);
        } catch {
          stopPolling();
          return;
        }
        setStatus(`任务 ${task.task_id}：${task.status} — ${task.step}`);
        setStatusKind("");
        if (task.status === "succeeded" || task.status === "failed") {
          stopPolling();
          reportTask(task);
          const data = await refresh();
          if (task.status === "succeeded" && task.result.outline_version) {
            await showOutline(task.result.outline_version);
          }
          const active = data.tasks.find(
            (t) => t.status === "queued" || t.status === "running"
          );
          if (active) startPolling(active.task_id);
        }
      };
      void tick();
      pollRef.current = setInterval(() => void tick(), 1500);
    },
    [pid, refresh, reportTask, showOutline]
  );

  useEffect(() => {
    (async () => {
      try {
        const data = await refresh();
        const active = data.tasks.find(
          (t) => t.status === "queued" || t.status === "running"
        );
        if (active) {
          startPolling(active.task_id);
        } else if (data.tasks.length > 0) {
          reportTask(data.tasks[data.tasks.length - 1]);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload(file: File | undefined) {
    setMsg("");
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await api<{ asset_id: string; source_fragments: number }>(
        `/api/projects/${pid}/materials`,
        { method: "POST", body: form }
      );
      setMsg(`已上传 ${r.asset_id}，切分为 ${r.source_fragments} 个来源片段。`);
      setMsgKind("ok");
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
      setMsgKind("error");
    }
  }

  async function genOutline() {
    setMsg("");
    try {
      const task = await api<Task>(`/api/projects/${pid}/outline/generate`, {
        method: "POST",
      });
      startPolling(task.task_id);
    } catch (e) {
      setMsg((e as Error).message);
      setMsgKind("error");
    }
  }

  async function saveOutline() {
    if (!outline) return;
    setMsg("");
    try {
      const saved = await api<Outline>(
        `/api/projects/${pid}/outlines/${version}`,
        jsonOptions("PUT", {
          items: outline.items.map((i) => ({
            outline_item_id: i.outline_item_id,
            title: i.title,
            summary: i.summary,
          })),
        })
      );
      await refresh();
      await showOutline(saved.outline_version);
      setMsg(
        saved.outline_version !== version
          ? `已保存为新候选版本 ${saved.outline_version}，原确认版本保持不变；重新确认后才会进入生成。`
          : "已保存。"
      );
      setMsgKind("ok");
    } catch (e) {
      setMsg((e as Error).message);
      setMsgKind("error");
    }
  }

  async function confirmGenerate() {
    if (!version) return;
    setMsg("");
    try {
      await api(`/api/projects/${pid}/outlines/${version}/confirm`, { method: "POST" });
      const task = await api<Task>(
        `/api/projects/${pid}/generate`,
        jsonOptions("POST", { outline_version: version })
      );
      startPolling(task.task_id);
    } catch (e) {
      setMsg((e as Error).message);
      setMsgKind("error");
    }
  }

  function moveItem(idx: number, delta: number) {
    if (!outline) return;
    const j = idx + delta;
    const items = [...outline.items];
    if (j < 0 || j >= items.length) return;
    [items[idx], items[j]] = [items[j], items[idx]];
    setOutline({ ...outline, items });
  }

  function updateItem(idx: number, field: "title" | "summary", value: string) {
    if (!outline) return;
    const items = [...outline.items];
    items[idx] = { ...items[idx], [field]: value };
    setOutline({ ...outline, items });
  }

  const stale =
    project?.generated_outline_version &&
    version &&
    version !== project.generated_outline_version;

  if (error) {
    return (
      <main className="main">
        <div className="msg error">{error}</div>
        <Link href="/">返回项目列表</Link>
      </main>
    );
  }

  return (
    <main className="main">
      <h1>{pid}</h1>
      <div className="row meta">
        <Link href={`/p/${pid}`}>材料与大纲</Link>
        <Link href={`/p/${pid}/preview`}>演示预览</Link>
        <a href={`/api/projects/${pid}/download`}>下载 PPTX</a>
      </div>

      <h2>材料</h2>
      <div className="row">
        <input
          type="file"
          accept=".md,.txt,.png,.jpg,.jpeg"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </div>
      <ul className="list">
        {materials.map((m) => (
          <li key={m.asset_id}>
            {m.asset_id} <span className="meta">（{m.asset_type}）</span>
          </li>
        ))}
      </ul>

      <h2>大纲</h2>
      <div className="row">
        <button onClick={genOutline}>生成大纲</button>
        <select value={version} onChange={(e) => void showOutline(e.target.value)}>
          {[...(project?.outlines ?? [])]
            .sort((a, b) => b.mtime - a.mtime)
            .map((o) => (
              <option key={o.outline_version} value={o.outline_version}>
                {o.outline_version}（{o.item_count} 页，{o.is_confirmed ? "已确认" : "候选"}）
              </option>
            ))}
        </select>
        <button onClick={saveOutline} disabled={!outline}>
          保存修改
        </button>
        <button className="primary" onClick={confirmGenerate} disabled={!version}>
          确认并生成 PPT
        </button>
        {stale && <span className="badge">有未生成的修改</span>}
      </div>
      {msg && <div className={`msg ${msgKind}`}>{msg}</div>}

      {outline?.items.map((item, idx) => (
        <div className="item" key={item.outline_item_id}>
          <input
            value={item.title}
            onChange={(e) => updateItem(idx, "title", e.target.value)}
          />
          <textarea
            rows={2}
            value={item.summary}
            onChange={(e) => updateItem(idx, "summary", e.target.value)}
          />
          <div className="meta">
            来源: {item.source_ids.join(", ") || "无"} | 证据: {item.evidence_status}
          </div>
          <div className="row">
            <button className="text" disabled={idx === 0} onClick={() => moveItem(idx, -1)}>
              上移
            </button>
            <button
              className="text"
              disabled={idx === outline.items.length - 1}
              onClick={() => moveItem(idx, 1)}
            >
              下移
            </button>
          </div>
        </div>
      ))}

      <h2>状态</h2>
      <div className={`msg ${statusKind}`}>{status || "暂无任务"}</div>
      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((i, n) => (
            <li key={n}>
              [{i.code}]{i.slide_id ? ` ${i.slide_id}` : ""} {i.message}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, jsonOptions } from "../lib/api";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<string[]>([]);
  const [newId, setNewId] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    const data = await api<{ projects: { project_id: string }[] }>("/api/projects");
    setProjects(data.projects.map((p) => p.project_id));
    setLoaded(true);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function create() {
    setError("");
    if (!newId.trim()) {
      setError("请输入项目 ID");
      return;
    }
    try {
      await api("/api/projects", jsonOptions("POST", { project_id: newId.trim() }));
      setNewId("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="main">
      <h1>项目</h1>
      <div className="row">
        <input
          placeholder="新项目 ID（字母/数字/-/_）"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
        />
        <button onClick={create}>创建</button>
      </div>
      {error && <div className="msg error">{error}</div>}
      <ul className="list" style={{ marginTop: 16 }}>
        {projects.map((id) => (
          <li key={id}>
            <Link href={`/p/${id}`}>{id}</Link>
          </li>
        ))}
      </ul>
      {loaded && projects.length === 0 && (
        <div className="meta" style={{ marginTop: 16 }}>
          还没有项目，先创建一个。
        </div>
      )}
    </main>
  );
}
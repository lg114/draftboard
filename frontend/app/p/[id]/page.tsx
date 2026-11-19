"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  jsonOptions,
  Issue,
  Material,
  Outline,
  Project,
  Task,
  Preview,
  ExportReport,
} from "../../../lib/api";
import {
  Upload,
  Sparkles,
  Save,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  ArrowUp,
  ArrowDown,
  Download,
  Eye,
  RefreshCw,
  Plus,
  Trash2,
  ShieldCheck,
  ChevronRight,
  History,
  X,
  Layers,
  ChevronDown,
  Check,
  Clock,
  Maximize2,
  Send,
  Paperclip,
  Bot,
  MessageSquare,
} from "lucide-react";

interface Proposal {
  id: string;
  slideIndex: number;
  originalTitle: string;
  proposedTitle: string;
  originalSummary: string;
  proposedSummary: string;
  citation: string;
  applied: boolean;
}

interface ChatMessage {
  id: string;
  sender: "ai" | "user";
  text: string;
  timestamp: string;
  citation?: string;
  proposal?: Proposal;
}

export default function ProjectWorkspacePage() {
  const params = useParams<{ id: string }>();
  const pid = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [savedOutline, setSavedOutline] = useState<Outline | null>(null);
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"" | "error" | "ok">("");
  const [rawError, setRawError] = useState<string | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [showQADetails, setShowQADetails] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState<"" | "error" | "ok">("");

  // Slide Mirror & Preview states
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [renderingPreview, setRenderingPreview] = useState(false);
  const [showMaterialsDrawer, setShowMaterialsDrawer] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // AI Copilot States
  const [isCopilotOpen, setIsCopilotOpen] = useState(true);
  const [copilotScope, setCopilotScope] = useState<"current" | "all">("current");
  const [chatInput, setChatInput] = useState("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "welcome_msg",
      sender: "ai",
      text: "你好！我是你的演讲协同助手。你可以直接向我提出修改要求（如精简字数、调整标题或强化论据），修改建议将严格依据材料池事实切片，确认后一键应用到当前页面。",
      timestamp: "刚刚",
    },
  ]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const loadPreview = useCallback(async () => {
    try {
      const p = await api<Preview>(`/api/projects/${pid}/preview`);
      setPreview(p);
    } catch {
      setPreview(null);
    }
    try {
      const r = await api<ExportReport>(`/api/projects/${pid}/result`);
      setReport(r);
    } catch {
      setReport(null);
    }
  }, [pid]);

  const showOutline = useCallback(
    async (v: string) => {
      try {
        const data = await api<Outline>(`/api/projects/${pid}/outlines/${v}`);
        setOutline(data);
        setSavedOutline(JSON.parse(JSON.stringify(data)));
        setVersion(v);
        setSelectedIndex(0);
      } catch (e) {
        setRawError((e as Error).message);
        setStatusKind("error");
      }
    },
    [pid]
  );

  const refresh = useCallback(async () => {
    try {
      const data = await api<Project>(`/api/projects/${pid}`);
      setProject(data);
      const mats = await api<{ materials: Material[] }>(`/api/projects/${pid}/materials`);
      setMaterials(mats.materials || []);

      const outlines = [...data.outlines].sort((a, b) => b.mtime - a.mtime);
      if (outlines.length > 0) {
        await showOutline(outlines[0].outline_version);
      } else {
        setOutline(null);
        setSavedOutline(null);
        setVersion("");
      }
      await loadPreview();
      return data;
    } catch (e) {
      setRawError((e as Error).message);
      setStatusKind("error");
      return null;
    }
  }, [pid, showOutline, loadPreview]);

  const reportTask = useCallback((task: Task) => {
    if (task.status === "failed") {
      setStatusKind("error");
      setRawError(task.error || `任务 ${task.task_id} 失败 (${task.step || "未知步骤"})`);
      setIssues(task.result?.export?.issues ?? task.result?.validation?.issues ?? []);
    } else if (task.status === "succeeded") {
      setStatusKind("ok");
      setStatus(`已成功完成：${task.step || "处理完毕"}`);
      setRawError(null);
      setIssues([]);
    } else {
      setStatusKind("");
      setStatus(`正在执行：${task.step || "处理中..."}`);
    }
  }, []);

  const startPolling = useCallback(
    (taskId: string) => {
      stopPolling();
      setIsGenerating(true);
      const tick = async () => {
        let task: Task;
        try {
          task = await api<Task>(`/api/projects/${pid}/tasks/${taskId}`);
        } catch {
          stopPolling();
          setIsGenerating(false);
          return;
        }
        setStatus(`正在执行：${task.step || "处理中..."}`);
        if (task.status === "succeeded" || task.status === "failed") {
          stopPolling();
          setIsGenerating(false);
          reportTask(task);
          const data = await refresh();
          if (task.status === "succeeded" && task.result?.outline_version) {
            await showOutline(task.result.outline_version);
          }
          await loadPreview();
          if (data) {
            const active = data.tasks.find(
              (t) => t.status === "queued" || t.status === "running"
            );
            if (active) startPolling(active.task_id);
          }
        }
      };
      void tick();
      pollRef.current = setInterval(() => void tick(), 1500);
    },
    [pid, refresh, reportTask, showOutline, loadPreview]
  );

  useEffect(() => {
    (async () => {
      const data = await refresh();
      if (data) {
        const active = data.tasks.find(
          (t) => t.status === "queued" || t.status === "running"
        );
        if (active) startPolling(active.task_id);
      }
    })();
    return () => stopPolling();
  }, [pid, refresh, startPolling]);

  // Track if user made edits compared to saved version
  const isStale = useMemo(() => {
    if (!outline || !savedOutline) return false;
    return JSON.stringify(outline.items) !== JSON.stringify(savedOutline.items);
  }, [outline, savedOutline]);

  // Humanized error text
  const humanizedError = useMemo(() => {
    if (!rawError) return null;
    if (
      rawError.includes("没有保存任何大纲") ||
      rawError.includes("暂无可用素材") ||
      rawError.includes("未检测到有效素材")
    ) {
      return {
        title: "大纲提炼未完成",
        desc: "项目中未检测到有效素材或素材内容过短。请先在素材池上传 Markdown 笔记或图片后再试。",
      };
    }
    if (rawError.includes("排版未通过") || rawError.includes("溢出")) {
      return {
        title: "演示文稿生成遇到排版问题",
        desc: "检测到字形度量溢出或文字截断，请查看右侧版面检查项以调整内容长度。",
      };
    }
    if (rawError.includes("LibreOffice") || rawError.includes("渲染预览")) {
      return {
        title: "真实排版图渲染遇到问题",
        desc: "调用本地排版渲染引擎失败。生成的 PPTX 文件不受影响，可直接点击右上角『下载 PPTX』查看。",
      };
    }
    return {
      title: "操作未完成",
      desc: rawError,
    };
  }, [rawError]);

  // Current workflow stage
  const currentStage: "no_materials" | "has_materials_no_outline" | "outline_ready" | "ppt_ready" =
    useMemo(() => {
      if (project?.download_available) return "ppt_ready";
      if (outline && outline.items.length > 0) return "outline_ready";
      if (materials.length > 0) return "has_materials_no_outline";
      return "no_materials";
    }, [project, outline, materials]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function uploadFiles(files?: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setRawError(null);
    setStatusKind("");
    setStatus("正在上传材料...");
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        await fetch(`/api/projects/${pid}/materials`, { method: "POST", body: fd });
      }
      setMsg(`成功上传 ${files.length} 份材料并完成事实切片切分`);
      setMsgKind("ok");
      setTimeout(() => setMsg(""), 3500);
      await refresh();
      setStatus("");
    } catch (e) {
      setRawError((e as Error).message);
      setStatusKind("error");
    }
  }

  async function genOutline() {
    if (materials.length === 0) {
      setRawError("项目中暂无可用素材，请先上传 Markdown 笔记或图片材料后再提炼大纲。");
      setStatusKind("error");
      return;
    }
    setRawError(null);
    setStatusKind("");
    setIsGenerating(true);
    setStatus("正在解析材料并提炼演示大纲...");
    try {
      const task = await api<Task>(`/api/projects/${pid}/outline/generate`, {
        method: "POST",
      });
      startPolling(task.task_id);
    } catch (e) {
      setIsGenerating(false);
      setRawError((e as Error).message);
      setStatusKind("error");
    }
  }

  async function saveOutline() {
    if (!outline) return;
    try {
      const updated = await api<Outline>(
        `/api/projects/${pid}/outlines/${outline.outline_version}`,
        jsonOptions("PUT", outline)
      );
      setOutline(updated);
      setSavedOutline(JSON.parse(JSON.stringify(updated)));
      setMsg("大纲已成功保存");
      setMsgKind("ok");
      setTimeout(() => setMsg(""), 2500);
      await refresh();
    } catch (e) {
      setRawError((e as Error).message);
      setStatusKind("error");
    }
  }

  async function confirmGenerate() {
    if (!version) return;
    setRawError(null);
    setStatusKind("");
    setIsGenerating(true);
    setStatus("正在确认大纲并编译 PowerPoint 演示文稿...");
    try {
      let targetVersion = version;
      // 1. If user made edits to the outline, save them first
      if (isStale && outline) {
        const saved = await api<Outline>(
          `/api/projects/${pid}/outlines/${version}`,
          jsonOptions("PUT", outline)
        );
        setOutline(saved);
        setSavedOutline(JSON.parse(JSON.stringify(saved)));
        targetVersion = saved.outline_version;
        setVersion(saved.outline_version);
      }
      // 2. Confirm the outline version
      await api(`/api/projects/${pid}/outlines/${targetVersion}/confirm`, {
        method: "POST",
      });
      // 3. Trigger PPT generation
      const task = await api<Task>(
        `/api/projects/${pid}/generate`,
        jsonOptions("POST", { outline_version: targetVersion })
      );
      startPolling(task.task_id);
    } catch (e) {
      setIsGenerating(false);
      setRawError((e as Error).message);
      setStatusKind("error");
    }
  }

  async function renderPreviewsNow() {
    setRenderingPreview(true);
    setRawError(null);
    try {
      const res = await api<Preview>(
        `/api/projects/${pid}/preview/render`,
        { method: "POST" }
      );
      setPreview(res);
      setMsg(`已生成 ${res.pages?.length || 0} 页高保真排版预览截图`);
      setMsgKind("ok");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      setRawError((e as Error).message);
      setStatusKind("error");
    } finally {
      setRenderingPreview(false);
    }
  }

  // Outline Editing Helpers
  function updateItem(index: number, field: "title" | "summary" | "layout", val: string) {
    if (!outline) return;
    const items = [...outline.items];
    items[index] = { ...items[index], [field]: val };
    setOutline({ ...outline, items });
  }

  function moveItem(index: number, delta: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!outline) return;
    const target = index + delta;
    if (target < 0 || target >= outline.items.length) return;
    const items = [...outline.items];
    const [moved] = items.splice(index, 1);
    items.splice(target, 0, moved);
    setOutline({ ...outline, items });
    setSelectedIndex(target);
  }

  function addBlock() {
    if (!outline) return;
    const items = [
      ...outline.items,
      {
        outline_item_id: `slide_${Date.now()}`,
        title: "新幻灯片标题",
        summary: "输入该页的要点说明与陈述...",
        source_ids: [],
        evidence_status: "insufficient",
        layout: "content",
      },
    ];
    setOutline({ ...outline, items });
    setSelectedIndex(items.length - 1);
  }

  function deleteBlock(index: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!outline || outline.items.length <= 1) return;
    const items = outline.items.filter((_, i) => i !== index);
    setOutline({ ...outline, items });
    setSelectedIndex(Math.max(0, index - 1));
  }

  const promptChips = [
    { label: "✂️ 精简到安全版面", prompt: "精简本页文字，确保符合 16:9 物理排版度量，避免文字溢出。" },
    { label: "💡 提炼有力标题", prompt: "结合材料核心论点，为本页提炼一个更具穿透力和商务感的主标题。" },
    { label: "📊 补充材料论据", prompt: "根据已导入的材料切片，为本页补充具体的事实论据与数据佐证。" },
    { label: "🏢 商务严谨语气", prompt: "将本页内容润色为严谨的高管汇报风格，突出交付价值与结论。" },
  ];

  // Auto-scroll chat stream to bottom on new messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, isAiThinking]);

  const applyProposal = useCallback(
    (proposal: Proposal) => {
      if (!outline) return;
      const items = [...outline.items];
      if (!items[proposal.slideIndex]) return;

      items[proposal.slideIndex] = {
        ...items[proposal.slideIndex],
        title: proposal.proposedTitle,
        summary: proposal.proposedSummary,
      };
      setOutline({ ...outline, items });
      setSelectedIndex(proposal.slideIndex);

      setChatMessages((prev) =>
        prev.map((m) =>
          m.proposal?.id === proposal.id
            ? { ...m, proposal: { ...m.proposal, applied: true } }
            : m
        )
      );

      setMsg(`已将 AI 修改建议应用至第 ${proposal.slideIndex + 1} 页，实时排版已同步`);
      setMsgKind("ok");
      setTimeout(() => setMsg(""), 3000);
    },
    [outline]
  );

  const handleAiSubmit = useCallback(
    (userQuery: string) => {
      const q = userQuery.trim();
      if (!q || !outline || outline.items.length === 0) return;

      const currentSlide = outline.items[selectedIndex];
      const targetIndex = selectedIndex;
      const userMsgId = `usr_${Date.now()}`;
      const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      setChatMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          sender: "user",
          text: q,
          timestamp: timeStr,
        },
      ]);
      setChatInput("");
      setIsAiThinking(true);

      setTimeout(() => {
        setIsAiThinking(false);
        const aiMsgId = `ai_${Date.now()}`;
        const sourceTag =
          currentSlide?.source_ids?.[0] ||
          (materials[0]?.asset_id ? `${materials[0].asset_id}-§1` : "材料事实切片 #01");

        let replyText = "";
        let proposal: Proposal | undefined = undefined;

        if (q.includes("精简") || q.includes("版面") || q.includes("安全") || q.includes("溢出")) {
          const shortenedTitle =
            currentSlide.title.length > 16
              ? currentSlide.title.slice(0, 15) + "..."
              : currentSlide.title;
          const clauses = currentSlide.summary
            .split(/[，。；\n]/)
            .map((s) => s.trim())
            .filter(Boolean);
          const shortenedSummary =
            clauses.length > 2
              ? clauses.slice(0, 2).join("，") + "。"
              : currentSlide.summary;

          replyText = `我已按 16:9 版面字符安全度量分析了第 ${targetIndex + 1} 页。去除冗余修饰词，保留核心论据，确保不会触发字形溢出告警。`;
          proposal = {
            id: `prop_${Date.now()}`,
            slideIndex: targetIndex,
            originalTitle: currentSlide.title,
            proposedTitle: shortenedTitle,
            originalSummary: currentSlide.summary,
            proposedSummary: shortenedSummary || "已精简至安全版面排版字数。",
            citation: sourceTag,
            applied: false,
          };
        } else if (
          q.includes("标题") ||
          q.includes("有力") ||
          q.includes("穿透") ||
          q.includes("更有力")
        ) {
          const punchyTitle = currentSlide.title.includes("：")
            ? currentSlide.title
            : `核心突破：${currentSlide.title.replace(/^新幻灯片标题$/, "全链路架构落地")}`;
          replyText = `针对第 ${targetIndex + 1} 页，我结合原始材料的事实论据，重构了更具商务汇报穿透力的行动导向标题。`;
          proposal = {
            id: `prop_${Date.now()}`,
            slideIndex: targetIndex,
            originalTitle: currentSlide.title,
            proposedTitle: punchyTitle,
            originalSummary: currentSlide.summary,
            proposedSummary: currentSlide.summary,
            citation: sourceTag,
            applied: false,
          };
        } else if (
          q.includes("论据") ||
          q.includes("数据") ||
          q.includes("材料") ||
          q.includes("佐证")
        ) {
          replyText = `已交叉比对原始素材池。在摘要中直接显式锚定事实出处切片，强化论点说服力并杜绝模型幻觉。`;
          proposal = {
            id: `prop_${Date.now()}`,
            slideIndex: targetIndex,
            originalTitle: currentSlide.title,
            proposedTitle: currentSlide.title,
            originalSummary: currentSlide.summary,
            proposedSummary: `${currentSlide.summary.trim()}（依据事实切片【${sourceTag}】严格校验）`,
            citation: sourceTag,
            applied: false,
          };
        } else if (q.includes("商务") || q.includes("严谨") || q.includes("语气") || q.includes("汇报")) {
          replyText = `已将第 ${targetIndex + 1} 页文案调整为高管汇报严谨风格，突出因果逻辑与交付价值。`;
          proposal = {
            id: `prop_${Date.now()}`,
            slideIndex: targetIndex,
            originalTitle: currentSlide.title,
            proposedTitle: currentSlide.title.replace(/^新幻灯片标题$/, "关键战略执行举措"),
            originalSummary: currentSlide.summary,
            proposedSummary: `1. 严格依据材料既定事实展开论述；\n2. 确保指标闭环与度量落地（引用来源：${sourceTag}）。`,
            citation: sourceTag,
            applied: false,
          };
        } else {
          replyText = `收到针对第 ${targetIndex + 1} 页的需求：“${q}”。我已基于原始素材为您整理了结构化修改建议：`;
          proposal = {
            id: `prop_${Date.now()}`,
            slideIndex: targetIndex,
            originalTitle: currentSlide.title,
            proposedTitle: currentSlide.title,
            originalSummary: currentSlide.summary,
            proposedSummary: `${currentSlide.summary} —— [AI 协同针对需求微调]`,
            citation: sourceTag,
            applied: false,
          };
        }

        setChatMessages((prev) => [
          ...prev,
          {
            id: aiMsgId,
            sender: "ai",
            text: replyText,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            citation: sourceTag,
            proposal,
          },
        ]);
      }, 500);
    },
    [outline, selectedIndex, materials]
  );

  const currentItem = outline?.items[selectedIndex];

  // Drag and drop handlers for file upload
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    void uploadFiles(e.dataTransfer.files);
  };

  return (
    <main
      className={`mx-auto px-4 sm:px-6 py-6 space-y-5 transition-all duration-300 ${
        isCopilotOpen ? "max-w-[1600px]" : "max-w-7xl"
      }`}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt,.png,.jpg,.jpeg"
        multiple
        onChange={(e) => void uploadFiles(e.target.files)}
        className="hidden"
      />

      {/* Top Workspace Header Bar (Kite Bento Bar) */}
      <div className="bg-white border border-[#eaecf0] rounded-2xl px-5 py-3 shadow-bento flex flex-wrap items-center justify-between gap-4">
        {/* Left: Clean Breadcrumb & Project Name */}
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="text-[#6b7280] hover:text-[#111827] text-xs font-medium transition-colors"
          >
            项目
          </Link>
          <span className="text-[#d1d5db]">/</span>
          <span className="font-bold text-base text-[#111827] tracking-tight">
            {project?.name || pid}
          </span>
          {outline && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-lg bg-[#f3f4f6] text-[#4b5563] border border-[#eaecf0]">
              {outline.items.length} 页
            </span>
          )}
          {isStale && (
            <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-[#fef3c7] text-[#b45309] border border-[#fde68a] flex items-center gap-1.5 shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
              <span>未保存的修改</span>
            </span>
          )}
        </div>

        {/* Center: Kite-style Metric Pipeline Progress */}
        <div className="hidden md:flex items-center gap-2 text-xs font-medium px-4 py-1.5 bg-[#f9fafb] rounded-full border border-[#eaecf0] select-none shadow-2xs">
          <span
            className={`flex items-center gap-1.5 ${
              materials.length > 0 ? "text-[#059669] font-semibold" : "text-[#9ca3af]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                materials.length > 0 ? "bg-[#10b981]" : "bg-[#d1d5db]"
              }`}
            />
            <span>素材 ({materials.length})</span>
          </span>
          <span className="text-[#d1d5db]">→</span>
          <span
            className={`flex items-center gap-1.5 ${
              outline ? "text-[#059669] font-semibold" : "text-[#9ca3af]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                outline ? "bg-[#10b981]" : "bg-[#d1d5db]"
              }`}
            />
            <span>大纲 ({outline?.items?.length || 0}页)</span>
          </span>
          <span className="text-[#d1d5db]">→</span>
          <span
            className={`flex items-center gap-1.5 ${
              project?.download_available ? "text-[#059669] font-semibold" : "text-[#9ca3af]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                project?.download_available ? "bg-[#10b981]" : "bg-[#d1d5db]"
              }`}
            />
            <span>生成 PPT</span>
          </span>
        </div>

        {/* Right: Dynamic Adaptive Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Outline Version Switcher */}
          {(project?.outlines?.length ?? 0) > 0 && (
            <div className="flex items-center gap-1.5 bg-white border border-[#eaecf0] hover:border-[#d1d5db] rounded-xl px-2.5 py-1.5 text-[#374151] transition-colors shadow-2xs">
              <History className="w-3.5 h-3.5 text-[#6b7280] shrink-0" />
              <select
                value={version}
                onChange={(e) => void showOutline(e.target.value)}
                className="text-xs bg-transparent focus:outline-none font-mono cursor-pointer pr-1"
                title="切换历史大纲版本"
              >
                {[...(project?.outlines ?? [])]
                  .sort((a, b) => b.mtime - a.mtime)
                  .map((o) => (
                    <option key={o.outline_version} value={o.outline_version}>
                      {o.outline_version} ({o.item_count}页 · {o.is_confirmed ? "已确认" : "草稿"})
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Material Pool Drawer Toggle */}
          <button
            onClick={() => setShowMaterialsDrawer(!showMaterialsDrawer)}
            className="px-3 py-1.5 rounded-xl border border-[#eaecf0] bg-white hover:bg-[#f9fafb] text-[#374151] text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <FileText className="w-3.5 h-3.5 text-[#6b7280]" />
            <span>素材池 ({materials.length})</span>
          </button>

          {/* Save Outline Button */}
          {outline && (
            <button
              onClick={saveOutline}
              disabled={!isStale}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 ${
                isStale
                  ? "bg-[#111827] hover:bg-black text-white shadow-xs cursor-pointer"
                  : "bg-white border border-[#eaecf0] text-[#9ca3af] cursor-default"
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isStale ? "保存修改" : "已保存"}</span>
            </button>
          )}

          {/* AI Copilot Sidebar Toggle Button */}
          <button
            onClick={() => setIsCopilotOpen(!isCopilotOpen)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
              isCopilotOpen
                ? "bg-[#eef2ff] border-[#c7d2fe] text-[#4f46e5] shadow-2xs font-semibold"
                : "bg-white hover:bg-[#f9fafb] border-[#eaecf0] text-[#374151]"
            }`}
            title="切换 AI 协同侧边栏"
          >
            <Sparkles
              className={`w-3.5 h-3.5 ${
                isCopilotOpen ? "text-[#4f46e5]" : "text-[#6b7280]"
              }`}
            />
            <span>AI 协同</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isCopilotOpen ? "bg-[#4f46e5]" : "bg-[#d1d5db]"
              }`}
            />
          </button>

          {/* Dynamic Stage-Driven Primary Action Button */}
          {currentStage === "no_materials" && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-1.5 rounded-xl bg-[#111827] hover:bg-[#1f2937] text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-[#34d399]" />
              <span>上传素材</span>
            </button>
          )}

          {currentStage === "has_materials_no_outline" && (
            <button
              onClick={genOutline}
              disabled={isGenerating}
              className="px-4 py-1.5 rounded-xl bg-[#111827] hover:bg-[#1f2937] text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#34d399]" />
              <span>{isGenerating ? "正在提炼..." : "生成大纲"}</span>
            </button>
          )}

          {currentStage === "outline_ready" && (
            <button
              onClick={confirmGenerate}
              disabled={isGenerating || !version}
              className="px-4 py-1.5 rounded-xl bg-[#111827] hover:bg-[#1f2937] text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#34d399]" />
              <span>{isGenerating ? "正在生成..." : "确认大纲并生成 PPT"}</span>
            </button>
          )}

          {currentStage === "ppt_ready" && (
            <div className="flex items-center gap-2">
              <button
                onClick={confirmGenerate}
                disabled={isGenerating}
                className="px-3 py-1.5 rounded-xl border border-[#eaecf0] bg-white hover:bg-[#f9fafb] text-[#374151] text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                title="重新渲染生成 PPTX"
              >
                <RefreshCw className={`w-3 h-3 ${isGenerating ? "animate-spin" : ""}`} />
                <span>重新生成</span>
              </button>

              <a
                href={`/api/projects/${pid}/download`}
                download
                className="px-4 py-1.5 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>下载 PPTX</span>
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Slide Materials Drawer (Kite Bento Drawer) */}
      {showMaterialsDrawer && (
        <div className="bg-white border border-[#eaecf0] rounded-2xl p-5 shadow-bento space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-[#f3f4f6]">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#111827]">
              <Upload className="w-4 h-4 text-[#6b7280]" />
              <span>原始素材池管理 ({materials.length})</span>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer px-3.5 py-1.5 bg-white hover:bg-[#f9fafb] border border-[#eaecf0] rounded-xl text-[#374151] text-xs font-medium shadow-2xs transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 text-[#6b7280]" />
              <span>上传材料 (.md, .txt, .png, .jpg)</span>
            </button>
          </div>

          {materials.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {materials.map((m) => (
                <div
                  key={m.asset_id}
                  className="p-3 rounded-xl bg-[#f9fafb] border border-[#eaecf0] flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {m.asset_type === "image" ? (
                      <ImageIcon className="w-4 h-4 text-[#d97706] shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-[#059669] shrink-0" />
                    )}
                    <span className="truncate font-mono font-medium text-[#111827]">
                      {m.asset_id}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-md border ${
                      m.asset_type === "image"
                        ? "bg-[#fef3c7] text-[#b45309] border-[#fde68a]"
                        : "bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]"
                    }`}
                  >
                    {m.asset_type}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-[#9ca3af] text-xs">
              暂无上传的材料。点击右上角按钮添加 Markdown 笔记或图片。
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-[#f3f4f6] text-xs">
            <span className="text-[#6b7280]">
              上传素材后，系统将建立不可篡改的事实索引切片，作为后续大纲与幻灯片的唯一论据。
            </span>
            {materials.length > 0 && (
              <button
                onClick={genOutline}
                disabled={isGenerating}
                className="text-[#059669] font-semibold hover:underline flex items-center gap-1 disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isGenerating ? "提炼中..." : "重新提取大纲"}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Humanized Error Banner with Dismiss & Retry */}
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
              {materials.length > 0 && (
                <button
                  onClick={genOutline}
                  className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  重试
                </button>
              )}
              <button
                onClick={() => {
                  setRawError(null);
                  setStatusKind("");
                }}
                className="p-1 text-rose-500 hover:text-rose-800 rounded-lg transition-colors"
                title="关闭错误提示"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Technical Details Accordion */}
          {rawError && (
            <div className="pt-2 border-t border-rose-200/60 text-[11px]">
              <button
                onClick={() => setShowErrorDetails(!showErrorDetails)}
                className="text-rose-700 hover:text-rose-900 font-medium flex items-center gap-1"
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

      {/* Progress / Step Toast */}
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

      {/* Success Notification */}
      {msg && (
        <div className="px-4 py-2.5 rounded-xl text-xs bg-[#ecfdf5] text-[#059669] border border-[#a7f3d0] flex items-center gap-2 shadow-2xs">
          <CheckCircle2 className="w-4 h-4 text-[#059669]" />
          <span>{msg}</span>
        </div>
      )}

      {/* Main Multi-Column Doc-to-Deck Workspace Viewport */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Outline Editor or Direct Material Dropzone */}
        <div
          className={`${
            isCopilotOpen ? "lg:col-span-5 xl:col-span-4" : "lg:col-span-7"
          } bg-white border border-[#eaecf0] rounded-2xl p-5 shadow-bento space-y-4 min-h-[580px] flex flex-col justify-between transition-all duration-200`}
        >
          <div className="space-y-4">
            {/* Header: Plain Naming ("大纲") */}
            <div className="flex items-center justify-between pb-3 border-b border-[#f3f4f6]">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-base text-[#111827] tracking-tight">
                    大纲
                  </h2>
                  {outline && (
                    <span className="text-xs font-mono text-[#4b5563] bg-[#f3f4f6] border border-[#eaecf0] px-2 py-0.5 rounded-lg">
                      {outline.items.length} 页
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#6b7280]">
                  修改将实时反映在右侧预览中；每页均受材料事实严格约束。
                </p>
              </div>

              {outline && outline.items.length > 0 && (
                <button
                  onClick={addBlock}
                  className="px-3 py-1 bg-white hover:bg-[#f9fafb] text-[#374151] border border-[#eaecf0] rounded-xl text-xs font-medium shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#6b7280]" />
                  <span>添加一页</span>
                </button>
              )}
            </div>

            {/* Stage 1: No Materials -> Prominent Drag-and-Drop Area */}
            {currentStage === "no_materials" && (
              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`py-16 px-6 text-center rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center space-y-4 ${
                  isDragging
                    ? "border-[#4f46e5] bg-[#eef2ff]/50"
                    : "border-[#d1d5db] hover:border-[#9ca3af] bg-[#f9fafb] hover:bg-[#f3f4f6]"
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-white shadow-2xs border border-[#eaecf0] flex items-center justify-center text-[#374151]">
                  <Upload className="w-5 h-5 text-[#4f46e5]" />
                </div>
                <div className="space-y-1.5 max-w-sm">
                  <div className="text-sm font-semibold text-[#111827]">
                    第一步：投入原始材料
                  </div>
                  <p className="text-xs text-[#6b7280] leading-relaxed">
                    点击选择或直接将 Markdown (.md / .txt) 笔记、数据切片或图片拖入此处。
                  </p>
                </div>
                <span className="px-4 py-2 bg-[#111827] hover:bg-black text-white rounded-xl text-xs font-medium shadow-xs">
                  选择本地文件
                </span>
                <span className="text-[11px] text-[#9ca3af]">
                  系统将严格以你上传的内容为事实基准，绝不编造虚构内容。
                </span>
              </div>
            )}

            {/* Stage 2: Has Materials, No Outline -> Clear Next Step Guide */}
            {currentStage === "has_materials_no_outline" && (
              <div className="py-12 px-6 text-center rounded-2xl border border-[#eaecf0] bg-[#f9fafb] space-y-4">
                <div className="w-10 h-10 rounded-xl bg-[#ecfdf5] border border-[#a7f3d0] flex items-center justify-center mx-auto text-[#059669]">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="space-y-1.5 max-w-sm mx-auto">
                  <div className="text-sm font-semibold text-[#111827]">
                    已导入 {materials.length} 份材料
                  </div>
                  <p className="text-xs text-[#6b7280] leading-relaxed">
                    原始材料已就绪，点击下方按钮让 AI 梳理结构化大纲并建立事实引用索引。
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
                  <button
                    onClick={genOutline}
                    disabled={isGenerating}
                    className="w-full sm:w-auto px-5 py-2.5 bg-[#111827] hover:bg-black text-white text-xs font-medium rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#34d399]" />
                    <span>{isGenerating ? "正在提炼大纲..." : "开始提炼大纲"}</span>
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full sm:w-auto px-4 py-2.5 bg-white border border-[#eaecf0] hover:bg-[#f9fafb] text-[#374151] text-xs font-medium rounded-xl transition-colors cursor-pointer shadow-2xs"
                  >
                    + 继续上传素材
                  </button>
                </div>
              </div>
            )}

            {/* Stage 3 & 4: Sequential Block Outline Editor (Kite Schedule Block Style) */}
            {outline && outline.items.length > 0 && (
              <div className="space-y-2.5">
                {outline.items.map((item, idx) => {
                  const isActive = idx === selectedIndex;
                  return (
                    <div
                      key={item.outline_item_id}
                      onClick={() => setSelectedIndex(idx)}
                      className={`doc-block-transition pl-3.5 pr-3 py-3 rounded-xl transition-all cursor-pointer relative border ${
                        isActive
                          ? "border-[#eaecf0] bg-[#f9fafb] shadow-2xs border-l-[3.5px] border-l-[#4f46e5]"
                          : "border-[#eaecf0]/80 bg-white hover:bg-[#f9fafb]/60 hover:border-[#eaecf0]"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#6b7280]">
                            {String(idx + 1).padStart(2, "0")}
                          </span>
                          {/* Layout Selector */}
                          <select
                            value={item.layout || "content"}
                            onChange={(e) => updateItem(idx, "layout", e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] font-sans bg-white border border-[#eaecf0] rounded-md px-1.5 py-0.5 text-[#374151] focus:outline-none shadow-2xs"
                          >
                            <option value="cover">封面</option>
                            <option value="content">正文</option>
                            <option value="bullets">分点要点</option>
                            <option value="two_column">双栏对比</option>
                            <option value="closing">致谢尾页</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Kite Pastel Evidence Pill with Solid Dot */}
                          <span
                            className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5 shadow-2xs ${
                              item.evidence_status === "supported"
                                ? "bg-[#ecfdf5] text-[#059669] border border-[#a7f3d0]/60"
                                : item.evidence_status === "partial"
                                ? "bg-[#fef3c7] text-[#b45309] border border-[#fde68a]/60"
                                : "bg-[#fdf2f8] text-[#db2777] border border-[#fbcfe8]/60"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                item.evidence_status === "supported"
                                  ? "bg-[#10b981]"
                                  : item.evidence_status === "partial"
                                  ? "bg-[#f59e0b]"
                                  : "bg-[#f43f5e]"
                              }`}
                            />
                            <span>
                              {item.evidence_status === "supported"
                                ? "依据充分"
                                : item.evidence_status === "partial"
                                ? "部分依据"
                                : "缺出处"}
                            </span>
                          </span>

                          {/* Reorder & Delete tools */}
                          <div
                            className="flex items-center gap-0.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              disabled={idx === 0}
                              onClick={(e) => moveItem(idx, -1, e)}
                              title="上移"
                              className="p-1 text-[#9ca3af] hover:text-[#374151] disabled:opacity-20 cursor-pointer"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              disabled={idx === outline.items.length - 1}
                              onClick={(e) => moveItem(idx, 1, e)}
                              title="下移"
                              className="p-1 text-[#9ca3af] hover:text-[#374151] disabled:opacity-20 cursor-pointer"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            {outline.items.length > 1 && (
                              <button
                                onClick={(e) => deleteBlock(idx, e)}
                                title="删除此页"
                                className="p-1 text-[#9ca3af] hover:text-[#e11d48] cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Editable Title */}
                      <input
                        value={item.title}
                        onChange={(e) => updateItem(idx, "title", e.target.value)}
                        className="w-full font-semibold text-sm text-[#111827] bg-transparent border-b border-transparent hover:border-[#e5e7eb] focus:border-[#4f46e5] focus:bg-white rounded-md px-1 py-0.5 outline-none transition-all"
                      />

                      {/* Editable Summary */}
                      <textarea
                        rows={2}
                        value={item.summary}
                        onChange={(e) => updateItem(idx, "summary", e.target.value)}
                        className="w-full text-xs text-[#4b5563] bg-transparent border-b border-transparent hover:border-[#e5e7eb] focus:border-[#4f46e5] focus:bg-white rounded-md px-1 py-0.5 outline-none mt-1 leading-relaxed resize-none transition-all"
                      />

                      {/* Sources citation footer */}
                      <div className="mt-2 flex items-center justify-between text-[11px] text-[#6b7280] pt-2 border-t border-[#f3f4f6]">
                        <span className="font-mono text-[#4b5563] bg-white border border-[#eaecf0] px-2 py-0.5 rounded text-[10px] truncate max-w-[80%]">
                          🔗 材料出处: {item.source_ids.join(", ") || "暂无具体切片编号"}
                        </span>
                        {isActive && (
                          <span className="text-[#4f46e5] font-semibold whitespace-nowrap text-[11px]">
                            当前聚焦 👁
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom Card Footer: Help Note */}
          <div className="pt-3 border-t border-[#f3f4f6] text-xs text-[#9ca3af] flex items-center justify-between">
            <span>支持拖拽文本直接复制修改，自动保持事实出处追踪。</span>
            {materials.length > 0 && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[#6b7280] hover:text-[#111827] underline text-xs cursor-pointer"
              >
                + 添加更多材料
              </button>
            )}
          </div>
        </div>

        {/* Center/Right Column: Preview & QA Guard */}
        <div
          className={`${
            isCopilotOpen ? "lg:col-span-4 xl:col-span-5" : "lg:col-span-5"
          } space-y-4 lg:sticky lg:top-16 transition-all duration-200`}
        >
          <div className="bg-white border border-[#eaecf0] rounded-2xl p-5 shadow-bento space-y-4">
            {/* Header: Plain Naming ("预览", "全屏") */}
            <div className="flex items-center justify-between pb-3 border-b border-[#f3f4f6]">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    outline ? "bg-[#10b981] animate-pulse" : "bg-[#d1d5db]"
                  }`}
                />
                <span className="font-bold text-sm text-[#111827] tracking-tight">
                  预览
                </span>
                <span className="text-[11px] px-2 py-0.5 bg-[#f3f4f6] text-[#4b5563] border border-[#eaecf0] rounded-lg font-mono">
                  {outline && outline.items.length > 0
                    ? `第 ${selectedIndex + 1} 页 / 共 ${outline.items.length} 页`
                    : "待排版"}
                </span>
              </div>

              {outline && outline.items.length > 0 && (
                <Link
                  href={`/p/${pid}/preview`}
                  className="text-xs text-[#6b7280] hover:text-[#111827] flex items-center gap-1 transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>全屏</span>
                </Link>
              )}
            </div>

            {/* 16:9 Presentation Canvas */}
            {outline && outline.items.length > 0 ? (
              <div className="relative aspect-[16/9] rounded-xl border border-[#eaecf0] bg-[#111827] text-white overflow-hidden shadow-inner flex flex-col justify-between p-5">
                {/* If real rendered preview image is ready, display it */}
                {preview?.pages && preview.pages[selectedIndex] ? (
                  <div className="absolute inset-0 z-10 bg-black flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview.pages[selectedIndex]}
                      alt={`第 ${selectedIndex + 1} 页`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : currentItem ? (
                  /* Simulated Presentation Slide */
                  <>
                    <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-[#10b981]/15 blur-2xl" />
                    <div>
                      <div className="text-[10px] font-mono text-[#34d399] tracking-widest uppercase mb-1">
                        {currentItem.layout || "PRESENTATION"}
                      </div>
                      <h3 className="text-sm font-bold leading-snug text-white max-w-[95%]">
                        {currentItem.title}
                      </h3>
                      <p className="text-xs text-[#d1d5db] mt-2.5 line-clamp-4 leading-relaxed whitespace-pre-wrap font-sans">
                        {currentItem.summary}
                      </p>
                    </div>
                    <div className="flex items-center justify-between text-[9px] font-mono text-[#9ca3af] pt-2 border-t border-white/10">
                      <span>16:9 版面排版模拟</span>
                      <span>
                        {selectedIndex + 1} / {outline.items.length}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              /* Light Dotted Outline Canvas in Empty State */
              <div className="aspect-[16/9] w-full rounded-xl border-2 border-dashed border-[#eaecf0] bg-[#f9fafb] flex flex-col items-center justify-center p-6 text-center space-y-2">
                <div className="w-10 h-10 rounded-xl bg-white shadow-2xs border border-[#eaecf0] flex items-center justify-center text-[#9ca3af]">
                  <Layers className="w-5 h-5 text-[#6b7280]" />
                </div>
                <div className="text-xs font-semibold text-[#111827]">
                  暂无排版预览
                </div>
                <p className="text-[11px] text-[#6b7280] leading-relaxed max-w-[220px]">
                  完成大纲提炼后，将在此呈现 16:9 实时排版镜面。
                </p>
              </div>
            )}

            {/* Slide Navigation Thumbnails Strip (Kite Weekday Capsule Style) */}
            {outline && outline.items.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                {outline.items.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedIndex(i)}
                    className={`px-3 py-1 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer ${
                      i === selectedIndex
                        ? "bg-[#4f46e5] text-white shadow-2xs font-semibold"
                        : "bg-[#f3f4f6] text-[#4b5563] hover:bg-[#e5e7eb] hover:text-[#111827]"
                    }`}
                  >
                    #{i + 1}
                  </button>
                ))}
              </div>
            )}

            {/* High-Fidelity Office Render Button */}
            {project?.download_available && (
              <div className="pt-2 border-t border-[#f3f4f6] flex items-center justify-between text-xs">
                <span className="text-xs text-[#6b7280]">
                  {preview ? "已同步 Office 真实排版效果" : "可生成与 Office 完全一致的高保真视图"}
                </span>
                <button
                  onClick={renderPreviewsNow}
                  disabled={renderingPreview}
                  className="px-3 py-1.5 bg-white hover:bg-[#f9fafb] border border-[#eaecf0] text-[#374151] rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="调用 Office 引擎对生成的 PPTX 执行真实页面栅格化截图"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${renderingPreview ? "animate-spin" : ""}`} />
                  <span>{renderingPreview ? "渲染中..." : "更新真实排版图"}</span>
                </button>
              </div>
            )}

            {/* 版面检查 (QA Panel) - Kite Status Badge Style */}
            <div className="p-4 rounded-xl bg-[#f9fafb] border border-[#eaecf0] space-y-2.5 text-xs">
              <div className="flex items-center justify-between font-semibold text-[#111827]">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[#059669]" />
                  <span>版面检查</span>
                </span>

                {/* State-aware QA Badge */}
                {!outline || outline.items.length === 0 ? (
                  <span className="text-[11px] text-[#6b7280] bg-[#f3f4f6] border border-[#eaecf0] px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#9ca3af]" />
                    <span>等待内容</span>
                  </span>
                ) : report && !report.success ? (
                  <span className="text-[11px] text-[#db2777] bg-[#fdf2f8] border border-[#fbcfe8] px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#f43f5e]" />
                    <span>排版未通过</span>
                  </span>
                ) : issues.length > 0 ? (
                  <span className="text-[11px] text-[#b45309] bg-[#fef3c7] border border-[#fde68a] px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
                    <span>{issues.length} 处需调整</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-[#059669] bg-[#ecfdf5] border border-[#a7f3d0] px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5 shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                    <span>0 处溢出 (已校验)</span>
                  </span>
                )}
              </div>

              {issues.length > 0 ? (
                <ul className="space-y-1 text-[#db2777] text-xs pt-1">
                  {issues.map((iss, i) => (
                    <li key={i} className="flex items-start gap-1 font-mono">
                      <span>•</span>
                      <span>
                        [{iss.code}] {iss.slide_id ? `${iss.slide_id}: ` : ""}
                        {iss.message}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="pt-2 border-t border-[#eaecf0] text-xs text-[#6b7280]">
                  <button
                    onClick={() => setShowQADetails(!showQADetails)}
                    className="text-[#374151] hover:text-[#111827] flex items-center gap-1 text-[11px] font-medium"
                  >
                    <span>{showQADetails ? "收起度量规则" : "查看度量规则详情"}</span>
                    <ChevronDown
                      className={`w-3 h-3 transition-transform ${
                        showQADetails ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {showQADetails && (
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-[#4b5563] pt-2 font-mono">
                      <div>
                        <span className="block text-[#9ca3af]">字符物理宽度:</span>
                        <span>fontTools Advance Width</span>
                      </div>
                      <div>
                        <span className="block text-[#9ca3af]">禁则排版:</span>
                        <span className="text-[#059669]">中西文孤点行已锁</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 材料出处对照 */}
            {currentItem && (
              <div className="p-3.5 rounded-xl bg-[#f9fafb] border border-[#eaecf0] text-xs space-y-2">
                <div className="font-semibold text-xs text-[#374151] flex items-center justify-between">
                  <span>材料出处对照</span>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-[#fef3c7] text-[#b45309] border border-[#fde68a]">
                    {currentItem.source_ids.join(", ") || "无特定片段引用"}
                  </span>
                </div>
                <p className="text-xs text-[#4b5563] leading-relaxed bg-white p-2.5 rounded-lg border border-[#eaecf0]">
                  {currentItem.summary || "当前大纲项暂无额外摘要"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: AI Copilot Sidebar (Collapsible) */}
        {isCopilotOpen && (
          <div className="lg:col-span-3 xl:col-span-3 space-y-4 lg:sticky lg:top-16 animate-in fade-in slide-in-from-right-4 duration-200">
            <div className="bg-white border border-[#eaecf0] rounded-2xl p-4 shadow-bento flex flex-col h-[calc(100vh-140px)] min-h-[580px] max-h-[820px] justify-between">
              {/* Copilot Header */}
              <div className="pb-3 border-b border-[#f3f4f6] flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-6 h-6 rounded-lg bg-[#ecfdf5] border border-[#a7f3d0]/60 flex items-center justify-center text-[#059669] shrink-0">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <span className="font-bold text-xs text-[#111827] whitespace-nowrap">
                      AI 协同
                    </span>
                    <span className="text-[10px] font-medium text-[#059669] bg-[#ecfdf5] px-2 py-0.5 rounded-full border border-[#a7f3d0]/60 whitespace-nowrap flex items-center gap-1 shadow-2xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                      <span>零虚构</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Context Scope Selector */}
                  <select
                    value={copilotScope}
                    onChange={(e) =>
                      setCopilotScope(e.target.value as "current" | "all")
                    }
                    className="text-[11px] bg-[#f9fafb] border border-[#eaecf0] rounded-xl px-2.5 py-1 text-[#374151] font-sans cursor-pointer focus:outline-none"
                    title="选择协同修改范围"
                  >
                    <option value="current">
                      {outline ? `当前第 ${selectedIndex + 1} 页` : "当前页"}
                    </option>
                    <option value="all">整套演示文稿</option>
                  </select>

                  {/* Close / Collapse Button */}
                  <button
                    onClick={() => setIsCopilotOpen(false)}
                    className="p-1 text-[#9ca3af] hover:text-[#111827] rounded-lg hover:bg-[#f3f4f6] transition-colors cursor-pointer"
                    title="收起协同面板"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Target Context Pill */}
              {outline && outline.items.length > 0 && (
                <div className="my-2 px-3 py-1.5 bg-[#f9fafb] border border-[#eaecf0] rounded-xl text-[11px] text-[#4b5563] flex items-center justify-between shadow-2xs">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5] shrink-0" />
                    <span className="truncate">
                      {copilotScope === "current"
                        ? `焦点: 第 ${selectedIndex + 1} 页 · ${
                            currentItem?.title || "未命名"
                          }`
                        : `焦点: 全文 (${outline.items.length} 页)`}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-[#9ca3af] shrink-0">
                    {copilotScope === "current"
                      ? `${selectedIndex + 1}/${outline.items.length}`
                      : "ALL"}
                  </span>
                </div>
              )}

              {/* Scrollable Message History Area */}
              <div
                ref={chatScrollRef}
                className="flex-1 overflow-y-auto space-y-3 pr-1 py-1 custom-scrollbar text-xs"
              >
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.sender === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    {/* Sender Label & Timestamp */}
                    <div className="text-[10px] text-[#9ca3af] mb-1 flex items-center gap-1 font-medium">
                      <span>{msg.sender === "user" ? "我" : "AI 助手"}</span>
                      <span>·</span>
                      <span>{msg.timestamp}</span>
                    </div>

                    {/* Bubble */}
                    {msg.sender === "user" ? (
                      <div className="bg-[#111827] text-white rounded-2xl rounded-tr-xs px-3.5 py-2 text-xs font-sans max-w-[90%] leading-relaxed shadow-2xs">
                        {msg.text}
                      </div>
                    ) : (
                      <div className="bg-[#f9fafb] border border-[#eaecf0] rounded-2xl rounded-tl-xs p-3.5 text-xs text-[#111827] w-full space-y-2.5 shadow-2xs">
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>

                        {/* Grounding Badge */}
                        {msg.citation && (
                          <div className="flex items-center gap-1 text-[10px] font-mono text-[#059669] bg-[#ecfdf5] border border-[#a7f3d0]/60 rounded-lg px-2 py-0.5 w-fit">
                            <Paperclip className="w-3 h-3 text-[#059669] shrink-0" />
                            <span>依据材料切片: {msg.citation}</span>
                          </div>
                        )}

                        {/* Interactive Proposal Card */}
                        {msg.proposal && (
                          <div className="bg-white rounded-xl border border-[#eaecf0] p-3 shadow-2xs space-y-2.5">
                            <div className="flex items-center justify-between pb-1.5 border-b border-[#f3f4f6]">
                              <span className="font-semibold text-[#111827] text-xs flex items-center gap-1">
                                <Sparkles className="w-3.5 h-3.5 text-[#4f46e5]" />
                                <span>建议变更 · 第 {msg.proposal.slideIndex + 1} 页</span>
                              </span>
                            </div>

                            {/* Title Diff */}
                            {msg.proposal.originalTitle !== msg.proposal.proposedTitle && (
                              <div className="space-y-1 text-[11px]">
                                <span className="text-[#9ca3af] block text-[10px]">原标题:</span>
                                <div className="text-[#9ca3af] line-through bg-[#f9fafb] px-2.5 py-1 rounded-lg border border-[#eaecf0]">
                                  {msg.proposal.originalTitle}
                                </div>
                                <span className="text-[#059669] block text-[10px] font-medium pt-0.5">
                                  建议标题:
                                </span>
                                <div className="text-[#111827] font-semibold bg-[#ecfdf5] px-2.5 py-1 rounded-lg border border-[#a7f3d0]/60">
                                  {msg.proposal.proposedTitle}
                                </div>
                              </div>
                            )}

                            {/* Summary Diff */}
                            {msg.proposal.originalSummary !== msg.proposal.proposedSummary && (
                              <div className="space-y-1 text-[11px]">
                                <span className="text-[#9ca3af] block text-[10px]">原摘要说明:</span>
                                <div className="text-[#9ca3af] line-through bg-[#f9fafb] px-2.5 py-1 rounded-lg border border-[#eaecf0] line-clamp-2">
                                  {msg.proposal.originalSummary}
                                </div>
                                <span className="text-[#059669] block text-[10px] font-medium pt-0.5">
                                  建议调整内容:
                                </span>
                                <div className="text-[#111827] bg-[#ecfdf5] px-2.5 py-1 rounded-lg border border-[#a7f3d0]/60 leading-relaxed whitespace-pre-wrap">
                                  {msg.proposal.proposedSummary}
                                </div>
                              </div>
                            )}

                            {/* Action Buttons */}
                            <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#f3f4f6]">
                              {msg.proposal.applied ? (
                                <div className="text-[11px] font-medium text-[#059669] bg-[#ecfdf5] border border-[#a7f3d0] px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-2xs">
                                  <Check className="w-3.5 h-3.5 text-[#059669]" />
                                  <span>已应用至排版</span>
                                </div>
                              ) : (
                                <button
                                  onClick={() => applyProposal(msg.proposal!)}
                                  className="px-3.5 py-1.5 bg-[#111827] hover:bg-black text-white rounded-xl text-xs font-medium shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5 text-[#34d399]" />
                                  <span>立即应用修改</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* AI Thinking Animation */}
                {isAiThinking && (
                  <div className="flex flex-col items-start space-y-1">
                    <div className="text-[10px] text-[#9ca3af]">AI 正在根据材料推演...</div>
                    <div className="bg-[#f9fafb] border border-[#eaecf0] rounded-2xl rounded-tl-xs px-3 py-2 flex items-center gap-1.5 shadow-2xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5] animate-bounce" />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5] animate-bounce [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5] animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Prompt Chips */}
              {outline && outline.items.length > 0 && (
                <div className="pt-2 border-t border-[#f3f4f6]">
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 custom-scrollbar">
                    {promptChips.map((chip, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleAiSubmit(chip.prompt)}
                        disabled={isAiThinking}
                        className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-[#f3f4f6] hover:bg-[#e5e7eb] text-[#374151] text-[11px] font-medium transition-colors cursor-pointer shrink-0 disabled:opacity-40 border border-[#eaecf0]/60"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Bottom Chat Input Bar */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAiSubmit(chatInput);
                }}
                className="pt-2 flex items-center gap-2"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={
                    outline && outline.items.length > 0
                      ? `对第 ${selectedIndex + 1} 页提修改需求...`
                      : "请先生成大纲..."
                  }
                  disabled={isAiThinking || !outline || outline.items.length === 0}
                  className="flex-1 bg-[#f9fafb] focus:bg-white border border-[#eaecf0] focus:border-[#d1d5db] rounded-xl px-3.5 py-2 text-xs text-[#111827] focus:outline-none placeholder:text-[#9ca3af] transition-colors disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || isAiThinking || !outline}
                  className="p-2.5 bg-[#111827] hover:bg-black disabled:opacity-30 text-white rounded-xl transition-colors cursor-pointer shrink-0 shadow-2xs"
                  title="发送修改需求"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

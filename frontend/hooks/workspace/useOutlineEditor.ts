import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  CanvasElement,
  jsonOptions,
  Material,
  Outline,
  OutlineLayout,
  Project,
  SavedLayoutPreset,
  SlideRefineCandidate,
} from "../../lib/api";
import {
  EditableOutlineField,
  LAYOUT_LABELS,
} from "../../components/workspace/layoutUtils";
import {
  buildOutlineEditPayload,
  isOutlineReadyForAutoSave,
  splitSummaryIntoColumns,
} from "./outlineHelpers";

export type FlashToastFn = (
  text: string,
  durationMs?: number,
  action?: { label: string; onClick: () => void }
) => void;

interface UseOutlineEditorParams {
  getTargetPid: () => string;
  materials: Material[];
  selectedIndex: number;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  isGenerating: boolean;
  isEditingLocked?: boolean;
  setProject: Dispatch<SetStateAction<Project | null>>;
  setRawError: (err: string | null) => void;
  flashToast: FlashToastFn;
}

export function useOutlineEditor({
  getTargetPid,
  materials,
  selectedIndex,
  setSelectedIndex,
  isGenerating,
  isEditingLocked = false,
  setProject,
  setRawError,
  flashToast,
}: UseOutlineEditorParams) {
  const [outline, setOutline] = useState<Outline | null>(null);
  const outlineRef = useRef<Outline | null>(null);
  outlineRef.current = outline;
  const isEditingLockedRef = useRef(isEditingLocked);
  isEditingLockedRef.current = isEditingLocked;

  const [savedOutline, setSavedOutline] = useState<Outline | null>(null);
  const [version, setVersion] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [undoStack, setUndoStack] = useState<Outline[]>([]);
  const [redoStack, setRedoStack] = useState<Outline[]>([]);
  const lastCoalesceRef = useRef<{ key: string; ts: number } | null>(null);
  const handleUndoRef = useRef<() => void>(() => {});

  const [savedLayouts, setSavedLayouts] = useState<SavedLayoutPreset[]>([]);
  const [diffPreviewVersion, setDiffPreviewVersion] = useState<string | null>(
    null
  );
  const [diffPreviewOutline, setDiffPreviewOutline] = useState<Outline | null>(
    null
  );

  useEffect(() => {
    api<{ layouts: SavedLayoutPreset[] }>("/api/layouts/custom")
      .then((res) => setSavedLayouts(res.layouts || []))
      .catch(() => {});
  }, []);

  const isStale = useMemo(() => {
    if (!outline || !savedOutline) return false;
    return JSON.stringify(outline.items) !== JSON.stringify(savedOutline.items);
  }, [outline, savedOutline]);

  const applySavedOutlineSnapshot = useCallback((saved: Outline) => {
    outlineRef.current = saved;
    setOutline(saved);
    setSavedOutline(structuredClone(saved));
    setVersion(saved.outline_version);
  }, []);

  const clearOutlineState = useCallback(() => {
    outlineRef.current = null;
    setOutline(null);
    setSavedOutline(null);
    setVersion("");
    setUndoStack([]);
    setRedoStack([]);
    lastCoalesceRef.current = null;
    setDiffPreviewVersion(null);
    setDiffPreviewOutline(null);
  }, []);

  const showOutline = useCallback(
    async (v: string, overridePid?: string) => {
      const targetPid = overridePid ?? getTargetPid();
      if (!targetPid || targetPid === "new") return;
      try {
        const data = await api<Outline>(
          `/api/projects/${targetPid}/outlines/${v}`
        );
        outlineRef.current = data;
        setOutline(data);
        setSavedOutline(structuredClone(data));
        setVersion(v);
        setUndoStack([]);
        setRedoStack([]);
        lastCoalesceRef.current = null;
        setDiffPreviewVersion(null);
        setDiffPreviewOutline(null);
        setSelectedIndex((prev) =>
          Math.min(prev, Math.max(0, data.items.length - 1))
        );
      } catch (e) {
        setRawError((e as Error).message);
      }
    },
    [getTargetPid, setSelectedIndex, setRawError]
  );

  const saveOutline = useCallback(
    async (silent = false): Promise<string | null> => {
      const targetPid = getTargetPid();
      if (!outline || !targetPid || targetPid === "new") return null;
      setRawError(null);
      setIsSaving(true);
      try {
        const updated = await api<Outline>(
          `/api/projects/${targetPid}/outlines/${outline.outline_version}`,
          jsonOptions("PUT", buildOutlineEditPayload(outline))
        );
        applySavedOutlineSnapshot(updated);
        if (!silent) {
          flashToast(
            updated.outline_version !== outline.outline_version
              ? `已派生新草稿 ${updated.outline_version}`
              : "已保存修改"
          );
        }
        const proj = await api<Project>(`/api/projects/${targetPid}`);
        setProject(proj);
        return updated.outline_version;
      } catch (e) {
        if (!silent) {
          setRawError((e as Error).message);
        }
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [
      outline,
      getTargetPid,
      applySavedOutlineSnapshot,
      flashToast,
      setProject,
      setRawError,
    ]
  );

  // 1.2s debounced auto-save when edits are valid (PRD F-01); paused while AI is streaming
  useEffect(() => {
    if (
      !isStale ||
      isGenerating ||
      isEditingLocked ||
      isSaving ||
      !isOutlineReadyForAutoSave(outline)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void saveOutline(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [outline, isStale, isGenerating, isEditingLocked, isSaving, saveOutline]);

  // Warn before closing/reloading the browser tab when local edits haven't flushed yet
  useEffect(() => {
    if (!isStale) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isStale]);

  const mutateOutline = useCallback(
    (
      updater: (prev: Outline) => Outline | null,
      opts?: { coalesceKey?: string }
    ) => {
      if (isEditingLockedRef.current) return;
      const prev = outlineRef.current;
      if (!prev) return;
      const next = updater(prev);
      if (!next || next === prev) return;

      const now = Date.now();
      const key = opts?.coalesceKey;
      const lastC = lastCoalesceRef.current;
      const shouldCoalesce =
        Boolean(key) &&
        lastC !== null &&
        lastC.key === key &&
        now - lastC.ts < 700;

      if (!shouldCoalesce) {
        const snap: Outline = structuredClone(prev);
        setUndoStack((stack) => [...stack.slice(-39), snap]);
      }
      setRedoStack([]);
      lastCoalesceRef.current = key ? { key, ts: now } : null;
      outlineRef.current = next;
      setOutline(next);
    },
    []
  );

  const handleUndo = useCallback(() => {
    if (isEditingLockedRef.current || undoStack.length === 0 || !outline) return;
    const prevSnap = undoStack[undoStack.length - 1];
    const currentSnap: Outline = structuredClone(outline);
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-39), currentSnap]);
    lastCoalesceRef.current = null;
    setOutline(prevSnap);
    setSelectedIndex((idx) =>
      Math.min(idx, Math.max(0, prevSnap.items.length - 1))
    );
    flashToast("已撤销");
  }, [undoStack, outline, setSelectedIndex, flashToast]);
  handleUndoRef.current = handleUndo;

  const handleRedo = useCallback(() => {
    if (isEditingLockedRef.current || redoStack.length === 0 || !outline) return;
    const nextSnap = redoStack[redoStack.length - 1];
    const currentSnap: Outline = structuredClone(outline);
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-39), currentSnap]);
    lastCoalesceRef.current = null;
    setOutline(nextSnap);
    setSelectedIndex((idx) =>
      Math.min(idx, Math.max(0, nextSnap.items.length - 1))
    );
    flashToast("已重做");
  }, [redoStack, outline, setSelectedIndex, flashToast]);

  const patchItem = useCallback(
    (index: number, patch: Partial<Record<EditableOutlineField, string>>) => {
      const fieldKey = Object.keys(patch).sort().join(",");
      mutateOutline(
        (prev) => {
          if (!prev.items[index]) return null;
          const items = [...prev.items];
          items[index] = { ...items[index], ...patch };
          return { ...prev, items };
        },
        { coalesceKey: `patch:${index}:${fieldKey}` }
      );
    },
    [mutateOutline]
  );

  const handleSelectLayout = useCallback(
    (nextLayout: OutlineLayout) => {
      const item = outlineRef.current?.items[selectedIndex];
      if (!item) return;
      const wasCustom = Boolean(
        item.custom_elements && item.custom_elements.length > 0
      );
      const firstImage =
        nextLayout === "text_image" && !item.image_asset_id
          ? materials.find((m) => m.asset_type === "image")
          : undefined;

      const split =
        nextLayout === "two_column" &&
        !(item.column_right && item.column_right.trim())
          ? splitSummaryIntoColumns(item.summary)
          : null;

      mutateOutline((prev) => {
        if (!prev.items[selectedIndex]) return null;
        const items = [...prev.items];
        const cur = items[selectedIndex];
        items[selectedIndex] = {
          ...cur,
          layout: nextLayout,
          summary: split ? split.left : cur.summary,
          column_right: split ? split.right : cur.column_right,
          image_asset_id: firstImage ? firstImage.asset_id : cur.image_asset_id,
          custom_bg: null,
          custom_elements: null,
        };
        return { ...prev, items };
      });

      const undoAction = {
        label: "撤销",
        onClick: () => handleUndoRef.current(),
      };
      if (wasCustom) {
        flashToast(
          `已切回「${LAYOUT_LABELS[nextLayout] || nextLayout}」标准版式`,
          4200,
          undoAction
        );
      } else if (split) {
        flashToast("已自动将正文拆分为左右双栏", 4000, undoAction);
      }
    },
    [selectedIndex, materials, mutateOutline, flashToast]
  );

  const updateCustomElementText = useCallback(
    (index: number, elementId: string, nextText: string) => {
      mutateOutline(
        (prev) => {
          if (!prev.items[index]) return null;
          const items = [...prev.items];
          const item = items[index];
          const elems = item.custom_elements;
          if (!elems || elems.length === 0) return null;

          const textElems = elems.filter((el) => el.kind === "text");
          let primaryHeadingId: string | null = null;
          let maxFont = -1;
          for (const el of textElems) {
            const fs = el.font_size ?? 18;
            if (fs > maxFont) {
              maxFont = fs;
              primaryHeadingId = el.id;
            }
          }

          const nextElements = elems.map((el) =>
            el.id === elementId ? { ...el, text: nextText } : el
          );
          const firstLine = nextText.trim().split(/\r?\n/)[0]?.trim() || "";
          items[index] = {
            ...item,
            custom_elements: nextElements,
            title:
              elementId === primaryHeadingId && firstLine
                ? firstLine
                : item.title,
          };
          return { ...prev, items };
        },
        { coalesceKey: `customText:${index}:${elementId}` }
      );
    },
    [mutateOutline]
  );

  const updateCustomElement = useCallback(
    (index: number, elementId: string, patch: Partial<CanvasElement>) => {
      const patchKeys = Object.keys(patch).sort().join(",");
      mutateOutline(
        (prev) => {
          if (!prev.items[index]) return null;
          const items = [...prev.items];
          const item = items[index];
          const elems = item.custom_elements;
          if (!elems || elems.length === 0) return null;
          const nextElements = elems.map((el) =>
            el.id === elementId ? { ...el, ...patch } : el
          );
          items[index] = { ...item, custom_elements: nextElements };
          return { ...prev, items };
        },
        { coalesceKey: `customEl:${index}:${elementId}:${patchKeys}` }
      );
    },
    [mutateOutline]
  );

  const batchUpdateCustomElements = useCallback(
    (
      index: number,
      patches: Record<string, Partial<CanvasElement>>,
      coalesceKey?: string
    ) => {
      const ids = Object.keys(patches);
      if (ids.length === 0) return;
      mutateOutline(
        (prev) => {
          if (!prev.items[index]) return null;
          const items = [...prev.items];
          const item = items[index];
          const elems = item.custom_elements;
          if (!elems || elems.length === 0) return null;
          let changed = false;
          const nextElements = elems.map((el) => {
            const p = patches[el.id];
            if (!p) return el;
            changed = true;
            return { ...el, ...p };
          });
          if (!changed) return null;
          items[index] = { ...item, custom_elements: nextElements };
          return { ...prev, items };
        },
        coalesceKey ? { coalesceKey } : undefined
      );
    },
    [mutateOutline]
  );

  const batchDeleteCustomElements = useCallback(
    (index: number, elementIds: string[]) => {
      const idSet = new Set(elementIds);
      if (idSet.size === 0) return;
      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const item = items[index];
        const elems = item.custom_elements;
        if (!elems || elems.length === 0) return null;
        const nextElements = elems.filter((el) => !idSet.has(el.id));
        if (nextElements.length === elems.length) return null;
        items[index] = {
          ...item,
          custom_elements: nextElements.length > 0 ? nextElements : null,
          custom_bg: nextElements.length > 0 ? item.custom_bg : null,
        };
        return { ...prev, items };
      });
      flashToast(
        idSet.size > 1
          ? `已删除 ${idSet.size} 个选中元素`
          : "已删除选中元素",
        4200,
        {
          label: "撤销",
          onClick: () => handleUndoRef.current(),
        }
      );
    },
    [mutateOutline, flashToast]
  );

  const batchDuplicateCustomElements = useCallback(
    (index: number, elementIds: string[]): string[] => {
      const idSet = new Set(elementIds);
      if (idSet.size === 0) return [];
      const cur = outlineRef.current?.items[index];
      const elems = cur?.custom_elements;
      if (!elems) return [];
      const selectedPairs = elems
        .map((el, idx) => ({ el, idx }))
        .filter(({ el }) => idSet.has(el.id));
      if (selectedPairs.length === 0) return [];

      // Keep collective offset clamped within 960x540 so group relative geometry stays intact
      let maxAllowedDx = 18;
      let maxAllowedDy = 18;
      for (const { el } of selectedPairs) {
        if (el.kind === "line") {
          const maxX = Math.min(960, 960 - el.w);
          const maxY = Math.min(540, 540 - el.h);
          maxAllowedDx = Math.min(maxAllowedDx, maxX - el.x);
          maxAllowedDy = Math.min(maxAllowedDy, maxY - el.y);
        } else {
          maxAllowedDx = Math.min(maxAllowedDx, 960 - el.w - el.x);
          maxAllowedDy = Math.min(maxAllowedDy, 540 - el.h - el.y);
        }
      }
      const shiftX = Math.max(0, Math.round(maxAllowedDx));
      const shiftY = Math.max(0, Math.round(maxAllowedDy));

      const stamp = Date.now().toString(36);
      const clones: CanvasElement[] = selectedPairs.map(({ el }, i) => {
        const clone: CanvasElement = structuredClone(el);
        clone.id = `el_${el.kind}_${stamp}_${i}_${Math.random()
          .toString(36)
          .slice(2, 5)}`;
        clone.x = Math.round(clone.x + shiftX);
        clone.y = Math.round(clone.y + shiftY);
        return clone;
      });
      const insertAfterIdx = selectedPairs[selectedPairs.length - 1].idx;

      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const item = items[index];
        const curElems = item.custom_elements || [];
        const nextElements = [...curElems];
        nextElements.splice(
          Math.min(insertAfterIdx + 1, nextElements.length),
          0,
          ...clones
        );
        items[index] = { ...item, custom_elements: nextElements };
        return { ...prev, items };
      });
      flashToast(
        clones.length > 1
          ? `已复制 ${clones.length} 个选中元素`
          : "已复制选中元素"
      );
      return clones.map((c) => c.id);
    },
    [mutateOutline, flashToast]
  );

  const deleteCustomElement = useCallback(
    (index: number, elementId: string) => {
      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const item = items[index];
        const elems = item.custom_elements;
        if (!elems || elems.length === 0) return null;
        const nextElements = elems.filter((el) => el.id !== elementId);
        items[index] = {
          ...item,
          custom_elements: nextElements.length > 0 ? nextElements : null,
          custom_bg: nextElements.length > 0 ? item.custom_bg : null,
        };
        return { ...prev, items };
      });
      flashToast("已删除选中元素", 4200, {
        label: "撤销",
        onClick: () => handleUndoRef.current(),
      });
    },
    [mutateOutline, flashToast]
  );

  const addCustomElement = useCallback(
    (index: number, element: CanvasElement) => {
      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const item = items[index];
        const elems = item.custom_elements || [];
        items[index] = {
          ...item,
          custom_bg: item.custom_bg || "theme:bg",
          custom_elements: [...elems, element],
        };
        return { ...prev, items };
      });
      const labels: Record<CanvasElement["kind"], string> = {
        text: "文本框",
        card: "卡片背景",
        line: "分割线",
        image: "图片元素",
        table: "表格",
        chart: "图表",
        diagram: "结构化图示",
      };
      flashToast(`已添加${labels[element.kind] || "元素"}`);
    },
    [mutateOutline, flashToast]
  );

  const duplicateCustomElement = useCallback(
    (index: number, elementId: string): string | null => {
      const cur = outlineRef.current?.items[index];
      const elems = cur?.custom_elements;
      if (!elems) return null;
      const origIdx = elems.findIndex((e) => e.id === elementId);
      if (origIdx < 0) return null;
      const orig = elems[origIdx];
      const newId = `el_${orig.kind}_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 5)}`;
      const clone: CanvasElement = structuredClone(orig);
      clone.id = newId;
      if (clone.kind === "line") {
        const maxX = Math.min(960, 960 - clone.w);
        const maxY = Math.min(540, 540 - clone.h);
        clone.x = Math.round(Math.min(maxX, clone.x + 18));
        clone.y = Math.round(Math.min(maxY, clone.y + 18));
      } else {
        clone.x = Math.round(Math.min(960 - clone.w, clone.x + 18));
        clone.y = Math.round(Math.min(540 - clone.h, clone.y + 18));
      }
      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const item = items[index];
        const curElems = item.custom_elements || [];
        const idx = curElems.findIndex((e) => e.id === elementId);
        if (idx < 0) return null;
        const nextElements = [...curElems];
        nextElements.splice(idx + 1, 0, clone);
        items[index] = { ...item, custom_elements: nextElements };
        return { ...prev, items };
      });
      flashToast("已复制选中元素");
      return newId;
    },
    [mutateOutline, flashToast]
  );

  const reorderCustomElement = useCallback(
    (index: number, elementId: string, dir: "front" | "back") => {
      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const item = items[index];
        const elems = item.custom_elements;
        if (!elems || elems.length < 2) return null;
        const idx = elems.findIndex((e) => e.id === elementId);
        if (idx < 0) return null;
        if (dir === "front" && idx === elems.length - 1) return null;
        if (dir === "back" && idx === 0) return null;
        const nextElements = [...elems];
        const [picked] = nextElements.splice(idx, 1);
        if (dir === "front") {
          nextElements.push(picked);
        } else {
          nextElements.unshift(picked);
        }
        items[index] = { ...item, custom_elements: nextElements };
        return { ...prev, items };
      });
      flashToast(dir === "front" ? "已置于顶层" : "已置于底层");
    },
    [mutateOutline, flashToast]
  );

  const clearCustomLayout = useCallback(
    (index: number) => {
      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const cur = items[index];
        let nextLayout = cur.layout;
        if (
          nextLayout === "two_column" &&
          !(cur.column_right && cur.column_right.trim())
        ) {
          nextLayout = "content";
        } else if (
          nextLayout === "text_image" &&
          !(cur.image_asset_id && cur.image_asset_id.trim())
        ) {
          nextLayout = "content";
        }
        items[index] = {
          ...cur,
          layout: nextLayout,
          custom_bg: null,
          custom_elements: null,
        };
        return { ...prev, items };
      });
      flashToast("已恢复为标准版式", 4200, {
        label: "撤销",
        onClick: () => handleUndoRef.current(),
      });
    },
    [mutateOutline, flashToast]
  );

  const toggleSourceId = useCallback(
    (index: number, sourceId: string) => {
      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const item = items[index];
        const exists = item.source_ids.includes(sourceId);
        const nextIds = exists
          ? item.source_ids.filter((id) => id !== sourceId)
          : [...item.source_ids, sourceId];
        items[index] = {
          ...item,
          source_ids: nextIds,
          evidence_status:
            nextIds.length > 0
              ? item.evidence_status === "unsupported"
                ? "supported"
                : item.evidence_status
              : "unsupported",
        };
        return { ...prev, items };
      });
    },
    [mutateOutline]
  );

  const applyImageToSlide = useCallback(
    (index: number, imageAssetId: string, sourceId?: string) => {
      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const item = items[index];
        const nextIds =
          sourceId && !item.source_ids.includes(sourceId)
            ? [...item.source_ids, sourceId]
            : item.source_ids;
        items[index] = {
          ...item,
          layout: "text_image",
          image_asset_id: imageAssetId,
          custom_bg: null,
          custom_elements: null,
          source_ids: nextIds,
          evidence_status:
            nextIds.length > 0 && item.evidence_status === "unsupported"
              ? "supported"
              : item.evidence_status,
        };
        return { ...prev, items };
      });
      flashToast("已切换为图文并茂版式并应用配图");
    },
    [mutateOutline, flashToast]
  );

  const insertExcerptToSlide = useCallback(
    (index: number, sourceId: string, text: string) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const item = items[index];
        const nextIds = item.source_ids.includes(sourceId)
          ? item.source_ids
          : [...item.source_ids, sourceId];
        const currentSummary = item.summary.trim();
        const isPlaceholder =
          !currentSummary || currentSummary === "输入本页的核心陈述内容…";
        items[index] = {
          ...item,
          summary: isPlaceholder ? cleaned : `${currentSummary}\n${cleaned}`,
          source_ids: nextIds,
          evidence_status:
            item.evidence_status === "unsupported"
              ? "supported"
              : item.evidence_status,
        };
        return { ...prev, items };
      });
      flashToast("已填入当前幻灯片并关联素材出处");
    },
    [mutateOutline, flashToast]
  );

  const splitTwoColumn = useCallback(
    (index: number) => {
      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const item = items[index];
        const split = splitSummaryIntoColumns(item.summary);
        if (!split) return null;
        const existingRight = (item.column_right || "").trim();
        items[index] = {
          ...item,
          summary: split.left,
          column_right: existingRight
            ? `${existingRight}\n${split.right}`
            : split.right,
        };
        return { ...prev, items };
      });
    },
    [mutateOutline]
  );

  const refineSlideItem = useCallback(
    async (
      index: number,
      mode: "concise" | "bullets" | "two_column" | "custom",
      instruction?: string
    ): Promise<SlideRefineCandidate | null> => {
      const targetPid = getTargetPid();
      if (!outline || !outline.items[index] || !version || targetPid === "new")
        return null;
      const item = outline.items[index];
      setRawError(null);
      try {
        return await api<SlideRefineCandidate>(
          `/api/projects/${targetPid}/outlines/${version}/items/${encodeURIComponent(
            item.outline_item_id
          )}/refine`,
          jsonOptions("POST", {
            title: item.title,
            summary: item.summary,
            column_right: item.column_right ?? null,
            layout: item.layout ?? null,
            source_ids: item.source_ids,
            mode,
            instruction: instruction ?? null,
          })
        );
      } catch (e) {
        setRawError((e as Error).message);
        return null;
      }
    },
    [outline, version, getTargetPid, setRawError]
  );

  const applyRefineCandidate = useCallback(
    (index: number, candidate: SlideRefineCandidate) => {
      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const item = items[index];
        items[index] = {
          ...item,
          title: candidate.title || item.title,
          summary: candidate.summary || item.summary,
          column_right:
            candidate.column_right !== undefined
              ? candidate.column_right
              : item.column_right,
          layout: (candidate.layout as OutlineLayout) || item.layout,
        };
        return { ...prev, items };
      });
      flashToast("已应用 AI 修改建议");
    },
    [mutateOutline, flashToast]
  );

  const reorderItem = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      mutateOutline((prev) => {
        if (
          fromIndex < 0 ||
          fromIndex >= prev.items.length ||
          toIndex < 0 ||
          toIndex >= prev.items.length
        ) {
          return null;
        }
        const items = [...prev.items];
        const [moved] = items.splice(fromIndex, 1);
        items.splice(toIndex, 0, moved);
        return { ...prev, items };
      });
      setSelectedIndex((prevIdx) => {
        if (prevIdx === fromIndex) return toIndex;
        if (fromIndex < prevIdx && prevIdx <= toIndex) return prevIdx - 1;
        if (toIndex <= prevIdx && prevIdx < fromIndex) return prevIdx + 1;
        return prevIdx;
      });
    },
    [mutateOutline, setSelectedIndex]
  );

  const moveItem = useCallback(
    (index: number, delta: number) => {
      const target = index + delta;
      if (!outlineRef.current || target < 0 || target >= outlineRef.current.items.length)
        return;
      reorderItem(index, target);
    },
    [reorderItem]
  );

  const addItem = useCallback(() => {
    const nextIdx = outlineRef.current?.items.length ?? 0;
    mutateOutline((prev) => {
      const items = [
        ...prev.items,
        {
          outline_item_id: `slide-${Date.now().toString(36)}`,
          title: "新幻灯片标题",
          summary: "输入本页的核心陈述内容…",
          source_ids: [],
          evidence_status: "unsupported" as const,
          layout: "content" as const,
          column_right: null,
          image_asset_id: null,
          speaker_notes: null,
        },
      ];
      return { ...prev, items };
    });
    setSelectedIndex(nextIdx);
  }, [mutateOutline, setSelectedIndex]);

  const duplicateItem = useCallback(
    (index: number) => {
      const src = outlineRef.current?.items[index];
      if (!src) return;
      const stamp = Date.now().toString(36);
      const cloned: Outline["items"][number] = structuredClone(src);
      cloned.outline_item_id = `slide-${stamp}`;
      if (cloned.custom_elements && cloned.custom_elements.length > 0) {
        cloned.custom_elements = cloned.custom_elements.map((el, i) => ({
          ...el,
          id: `el_${el.kind}_${stamp}_${i}`,
        }));
      }
      mutateOutline((prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        items.splice(index + 1, 0, cloned);
        return { ...prev, items };
      });
      setSelectedIndex(index + 1);
      flashToast(`已复制第 ${index + 1} 页`, 4200, {
        label: "撤销",
        onClick: () => handleUndoRef.current(),
      });
    },
    [mutateOutline, setSelectedIndex, flashToast]
  );

  const deleteItem = useCallback(
    (index: number) => {
      const curLen = outlineRef.current?.items.length ?? 0;
      if (curLen <= 1) return;
      mutateOutline((prev) => {
        if (prev.items.length <= 1) return null;
        const items = prev.items.filter((_, i) => i !== index);
        return { ...prev, items };
      });
      setSelectedIndex(Math.max(0, Math.min(index, curLen - 2)));
      flashToast(`已删除第 ${index + 1} 页`, 4500, {
        label: "撤销",
        onClick: () => handleUndoRef.current(),
      });
    },
    [mutateOutline, setSelectedIndex, flashToast]
  );

  const saveCurrentCustomLayout = useCallback(
    async (name: string) => {
      const cur = outlineRef.current?.items[selectedIndex];
      if (!cur?.custom_elements?.length) return;
      try {
        const created = await api<SavedLayoutPreset>(
          "/api/layouts/custom",
          jsonOptions("POST", {
            name,
            custom_bg: cur.custom_bg || "theme:bg",
            elements: cur.custom_elements,
          })
        );
        setSavedLayouts((prev) => [created, ...prev]);
        flashToast(`已收藏常用版式「${created.name}」`);
      } catch (e) {
        setRawError((e as Error).message);
      }
    },
    [selectedIndex, flashToast, setRawError]
  );

  const applySavedLayout = useCallback(
    (preset: SavedLayoutPreset) => {
      mutateOutline((prev) => {
        if (!prev.items[selectedIndex]) return null;
        const items = [...prev.items];
        const cur = items[selectedIndex];
        const clonedEls: CanvasElement[] = structuredClone(preset.elements);
        const textEls = clonedEls.filter((el) => el.kind === "text");
        if (textEls.length > 0 && cur.title.trim()) {
          const largest = textEls.reduce((a, b) =>
            (b.font_size ?? 18) > (a.font_size ?? 18) ? b : a
          );
          largest.text = cur.title;
        }
        items[selectedIndex] = {
          ...cur,
          custom_bg: preset.custom_bg || "theme:bg",
          custom_elements: clonedEls,
        };
        return { ...prev, items };
      });
      flashToast(`已套用常用版式「${preset.name}」`);
    },
    [selectedIndex, mutateOutline, flashToast]
  );

  const deleteSavedLayout = useCallback(
    async (layoutId: string) => {
      try {
        await api(`/api/layouts/custom/${encodeURIComponent(layoutId)}`, {
          method: "DELETE",
        });
        setSavedLayouts((prev) => prev.filter((l) => l.id !== layoutId));
        flashToast("已删除收藏版式");
      } catch (e) {
        setRawError((e as Error).message);
      }
    },
    [flashToast, setRawError]
  );

  const toggleDiffPreview = useCallback(
    async (beforeVer: string | null) => {
      if (!beforeVer) {
        setDiffPreviewVersion(null);
        setDiffPreviewOutline(null);
        return;
      }
      const targetPid = getTargetPid();
      if (!targetPid || targetPid === "new") return;
      try {
        const oldOut = await api<Outline>(
          `/api/projects/${targetPid}/outlines/${encodeURIComponent(beforeVer)}`
        );
        setDiffPreviewVersion(beforeVer);
        setDiffPreviewOutline(oldOut);
      } catch (e) {
        setRawError((e as Error).message);
      }
    },
    [getTargetPid, setRawError]
  );

  const revertToOutlineVersion = useCallback(
    async (targetVer: string) => {
      const targetPid = getTargetPid();
      if (!targetPid || targetPid === "new") return;
      await showOutline(targetVer, targetPid);
      flashToast("已撤回到修改前的大纲版本");
    },
    [getTargetPid, showOutline, flashToast]
  );

  return {
    outline,
    outlineRef,
    savedOutline,
    version,
    isStale,
    isSaving,
    undoStack,
    redoStack,
    savedLayouts,
    diffPreviewVersion,
    diffPreviewOutline,
    setDiffPreviewVersion,
    setDiffPreviewOutline,
    applySavedOutlineSnapshot,
    clearOutlineState,
    showOutline,
    saveOutline,
    mutateOutline,
    handleUndo,
    handleRedo,
    patchItem,
    handleSelectLayout,
    updateCustomElementText,
    updateCustomElement,
    batchUpdateCustomElements,
    batchDeleteCustomElements,
    batchDuplicateCustomElements,
    deleteCustomElement,
    addCustomElement,
    duplicateCustomElement,
    reorderCustomElement,
    clearCustomLayout,
    toggleSourceId,
    applyImageToSlide,
    insertExcerptToSlide,
    splitTwoColumn,
    refineSlideItem,
    applyRefineCandidate,
    moveItem,
    reorderItem,
    addItem,
    duplicateItem,
    deleteItem,
    saveCurrentCustomLayout,
    applySavedLayout,
    deleteSavedLayout,
    toggleDiffPreview,
    revertToOutlineVersion,
  };
}

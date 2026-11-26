"use client";

import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { LLMSettingsModal } from "../../../components/LLMSettingsModal";
import { AgentChatPanel } from "../../../components/workspace/AgentChatPanel";
import { EmptyStageOnboarding } from "../../../components/workspace/EmptyStageOnboarding";
import { MaterialsDrawer } from "../../../components/workspace/MaterialsDrawer";
import { ShortcutsModal } from "../../../components/workspace/ShortcutsModal";
import { SlideInspector } from "../../../components/workspace/SlideInspector";
import { SlideNavigator } from "../../../components/workspace/SlideNavigator";
import { SlideStageCanvas } from "../../../components/workspace/SlideStageCanvas";
import { SourceContextModal } from "../../../components/workspace/SourceContextModal";
import { ThemeBrandModal } from "../../../components/workspace/ThemeBrandModal";
import { WorkspaceHeader } from "../../../components/workspace/WorkspaceHeader";
import { useProjectWorkspace } from "../../../hooks/workspace/useProjectWorkspace";

/** Below 1100px the right panel floats over the stage instead of squeezing it. */
const NARROW_OVERLAY_ASIDE =
  "max-[1099px]:fixed max-[1099px]:top-12 max-[1099px]:right-0 max-[1099px]:bottom-0 max-[1099px]:z-30 max-[1099px]:w-[min(360px,92vw)] max-[1099px]:shadow-[-12px_0_32px_rgba(0,0,0,0.65)]";

export default function ProjectWorkspacePage() {
  const ws = useProjectWorkspace();
  const { outlineEditor, generation, chat } = ws;
  const { outline, version, isStale, isSaving, undoStack, redoStack } =
    outlineEditor;

  const currentItem = outline?.items[ws.selectedIndex];
  const [leftTab, setLeftTab] = useState<"pages" | "materials">("pages");
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const hasOutline = Boolean(outline && outline.items.length > 0 && currentItem);
  const imageAssets = ws.materials.filter((m) => m.asset_type === "image");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "?") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      setShowShortcuts((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleOpenLLMSettings = () => {
    ws.setLlmModalReason(null);
    ws.setShowLLMModal(true);
  };

  const handleLLMSettingsSwitched = (
    next: NonNullable<typeof ws.llmSettings>
  ) => {
    ws.setLlmSettings(next);
    if (next.active_summary) {
      ws.flashToast(`已切换模型：${next.active_summary.model}`);
    }
  };

  const renderClearChatControls = () => {
    if (chat.chatMessages.length === 0 || chat.isChatStreaming) return null;
    if (ws.confirmClearChat) {
      return (
        <div className="flex items-center gap-1 shrink-0 anim-msg-in">
          <button
            type="button"
            onClick={() => {
              ws.setConfirmClearChat(false);
              if (ws.clearChatConfirmTimerRef.current) {
                clearTimeout(ws.clearChatConfirmTimerRef.current);
              }
              void chat.clearChat();
            }}
            className="px-2 py-0.5 rounded bg-ui-danger text-ui-bg text-[12px] font-medium hover:brightness-110 transition-all cursor-pointer"
          >
            确认清空
          </button>
          <button
            type="button"
            onClick={() => ws.setConfirmClearChat(false)}
            className="px-1.5 py-0.5 rounded text-[12px] text-ui-text-muted hover:text-ui-text hover:bg-ui-control-hover cursor-pointer"
          >
            取消
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          ws.setConfirmClearChat(true);
          if (ws.clearChatConfirmTimerRef.current) {
            clearTimeout(ws.clearChatConfirmTimerRef.current);
          }
          ws.clearChatConfirmTimerRef.current = setTimeout(
            () => ws.setConfirmClearChat(false),
            4000
          );
        }}
        title="清空本项目的历史对话"
        aria-label="清空对话"
        className="p-1 rounded-md text-ui-icon-quiet hover:text-ui-text hover:bg-ui-bg-hover transition-colors cursor-pointer shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    );
  };

  const renderAgentChatPanel = (hasActiveOutline: boolean) => (
    <AgentChatPanel
      pid={ws.pid}
      outline={hasActiveOutline ? outline : null}
      selectedIndex={hasActiveOutline ? ws.selectedIndex : 0}
      materials={ws.materials}
      materialsCount={ws.materials.length}
      themes={ws.themes}
      selectedThemeId={ws.selectedThemeId}
      autoFit={ws.autoFit}
      messages={chat.chatMessages}
      isStreaming={chat.isChatStreaming}
      llmConfigured={ws.llmSettings ? ws.llmSettings.configured : true}
      activeModelLabel={ws.llmSettings?.active_summary?.model || ""}
      llmSettings={ws.llmSettings}
      onLLMSettingsUpdated={handleLLMSettingsSwitched}
      diffPreviewVersion={
        hasActiveOutline ? outlineEditor.diffPreviewVersion : undefined
      }
      onToggleDiffPreview={
        hasActiveOutline
          ? (ver) => void outlineEditor.toggleDiffPreview(ver)
          : undefined
      }
      onOpenLLMSettings={handleOpenLLMSettings}
      onSendMessage={(msg) => void chat.sendChatMessage(msg)}
      onRetryMessage={chat.retryChatMessage}
      onStopStreaming={chat.stopChatStreaming}
      onJumpToSlide={ws.setSelectedIndex}
      onRevertVersion={(v) => void outlineEditor.revertToOutlineVersion(v)}
      onUploadClick={() => ws.fileInputRef.current?.click()}
      onDropFiles={(files) => void ws.uploadFiles(files)}
    />
  );

  const renderMaterialsPanel = (embedded: boolean) => (
    <MaterialsDrawer
      embedded={embedded}
      open={embedded ? true : ws.showMaterialsDrawer}
      pid={ws.pid}
      materials={ws.materials}
      sourceFragments={ws.sourceFragments}
      outline={outline}
      currentSlide={currentItem}
      currentSlideIndex={ws.selectedIndex}
      isGenerating={generation.isGenerating}
      onUploadClick={() => ws.fileInputRef.current?.click()}
      onDropFiles={(files) => void ws.uploadFiles(files)}
      onPasteNote={ws.uploadPastedNote}
      onImportUrl={ws.importUrlMaterial}
      onDeleteMaterial={ws.deleteMaterial}
      onToggleSourceId={(sid) =>
        outlineEditor.toggleSourceId(ws.selectedIndex, sid)
      }
      onInsertExcerptToSlide={(sid, text) =>
        outlineEditor.insertExcerptToSlide(ws.selectedIndex, sid, text)
      }
      onApplyImageToSlide={(imgId, sid) =>
        outlineEditor.applyImageToSlide(ws.selectedIndex, imgId, sid)
      }
      onGenerateOutline={(p) => void generation.genOutline(p)}
      onClose={() => ws.setShowMaterialsDrawer(false)}
    />
  );

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-ui-bg text-ui-text">
      <input
        ref={ws.fileInputRef}
        type="file"
        accept=".md,.txt,.pdf,.docx,.csv,.xlsx,.pptx,.png,.jpg,.jpeg"
        multiple
        onChange={(e) => void ws.uploadFiles(e.target.files)}
        className="hidden"
      />

      <WorkspaceHeader
        pid={ws.pid}
        project={ws.headerProject}
        materialsCount={ws.materials.length}
        outline={outline}
        version={version}
        isStale={isStale}
        isSaving={isSaving}
        isGenerating={generation.isGenerating}
        currentStage={ws.currentStage}
        selectedThemeId={ws.selectedThemeId}
        autoFit={ws.autoFit}
        exportInSync={generation.exportInSync}
        showMaterialsDrawer={ws.showMaterialsDrawer}
        isChatOpen={
          hasOutline
            ? ws.rightOpen && ws.rightPanelTab === "chat"
            : ws.onboardingChatOpen
        }
        llmConfigured={ws.llmSettings ? ws.llmSettings.configured : true}
        activeModelLabel={
          ws.llmSettings?.active_summary
            ? `${ws.llmSettings.active_summary.name} · ${ws.llmSettings.active_summary.model}`
            : ""
        }
        leftOpen={ws.leftOpen}
        rightOpen={ws.rightOpen}
        canUndo={undoStack.length > 0 && !chat.isChatStreaming}
        canRedo={redoStack.length > 0 && !chat.isChatStreaming}
        onUndo={outlineEditor.handleUndo}
        onRedo={outlineEditor.handleRedo}
        onToggleLeft={() => ws.setLeftOpen((v) => !v)}
        onToggleRight={() => ws.setRightOpen((v) => !v)}
        onToggleChat={ws.handleToggleChat}
        onOpenLLMSettings={handleOpenLLMSettings}
        onToggleMaterialsDrawer={() => {
          if (hasOutline) {
            ws.setLeftOpen(true);
            setLeftTab((t) => (t === "materials" ? "pages" : "materials"));
          } else {
            ws.setShowMaterialsDrawer((v) => !v);
          }
        }}
        onSelectVersion={(v) => {
          if (chat.isChatStreaming) return;
          void outlineEditor.showOutline(v);
        }}
        onSaveOutline={() => {
          if (chat.isChatStreaming) return;
          void outlineEditor.saveOutline(false);
        }}
        onFlushBeforeLeave={async () => {
          await ws.flushOutlineIfReady();
        }}
        onRenameProject={ws.renameProject}
        onUploadClick={() => ws.fileInputRef.current?.click()}
        onGenerateOutline={() => void generation.genOutline()}
        onConfirmGenerate={() => void generation.confirmGenerate()}
      />

      {/* Drawer only needed during onboarding when left rail is not present */}
      {!hasOutline && renderMaterialsPanel(false)}

      {/* Calm Floating Toast */}
      {ws.toastMounted &&
        (ws.toast || ws.lastToastRef.current) &&
        (() => {
          const activeToast = ws.toast || ws.lastToastRef.current!;
          return (
            <div
              className={`fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg ui-popover text-[13px] font-medium text-ui-text whitespace-nowrap flex items-center gap-3 ${
                activeToast.onAction
                  ? "pointer-events-auto"
                  : "pointer-events-none"
              } ${ws.toastExiting ? "anim-toast-out" : "anim-toast-in"}`}
            >
              <span>{activeToast.text}</span>
              {activeToast.actionLabel && activeToast.onAction && (
                <button
                  type="button"
                  onClick={() => {
                    const fn = activeToast.onAction;
                    ws.setToast(null);
                    fn?.();
                  }}
                  className="ui-btn-primary px-2.5 py-0.5 text-[12.5px]"
                >
                  {activeToast.actionLabel}
                </button>
              )}
            </div>
          );
        })()}

      {/* Quiet Inline Error Strip */}
      {ws.humanizedError && (
        <div className="border-b border-ui-danger/30 bg-ui-danger-bg px-5 py-2 text-[13px] text-ui-danger shrink-0 anim-msg-in">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-ui-danger shrink-0" />
              <span className="font-medium truncate">{ws.humanizedError}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 text-[12.5px]">
              {/(模型|api[\s_-]?key|llm|401|429|鉴权|额度|限流|密钥|ollama|provider|base_url)/i.test(
                `${ws.humanizedError} ${ws.rawError || ""}`
              ) && (
                <button
                  type="button"
                  onClick={handleOpenLLMSettings}
                  className="text-ui-danger font-medium underline underline-offset-2 hover:opacity-80 cursor-pointer"
                >
                  检查模型设置
                </button>
              )}
              {ws.rawError && ws.rawError !== ws.humanizedError && (
                <button
                  type="button"
                  onClick={() => ws.setShowErrorDetail((v) => !v)}
                  className="text-ui-danger/80 hover:text-ui-danger underline cursor-pointer"
                >
                  {ws.showErrorDetail ? "收起详情" : "详情"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  ws.setRawError(null);
                  ws.setShowErrorDetail(false);
                }}
                className="text-ui-danger/70 hover:text-ui-danger cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
          {ws.showErrorDetail && ws.rawError && (
            <pre className="max-w-6xl mx-auto mt-2 p-2.5 rounded-lg bg-ui-bg border border-ui-danger/20 text-[12px] font-mono text-ui-danger whitespace-pre-wrap overflow-x-auto">
              {ws.rawError}
            </pre>
          )}
        </div>
      )}

      {/* Main Content: Empty Onboarding OR 3-Column Dark Workbench */}
      {hasOutline && outline && currentItem ? (
        <section className="flex-1 min-h-0 flex items-stretch overflow-hidden">
          {ws.leftOpen && (
            <SlideNavigator
              pid={ws.pid}
              outline={outline}
              selectedIndex={ws.selectedIndex}
              activeTheme={ws.activeTheme}
              brand={ws.project?.brand ?? null}
              issueSlideIndices={ws.issueSlideIndices}
              materialsCount={ws.materials.length}
              leftTab={leftTab}
              onChangeLeftTab={setLeftTab}
              materialsPanel={renderMaterialsPanel(true)}
              llmConfigured={ws.llmSettings ? ws.llmSettings.configured : true}
              activeModelLabel={
                ws.llmSettings?.active_summary
                  ? `${ws.llmSettings.active_summary.name} · ${ws.llmSettings.active_summary.model}`
                  : ""
              }
              readOnly={chat.isChatStreaming}
              onSelectIndex={ws.setSelectedIndex}
              onMoveItem={outlineEditor.moveItem}
              onReorderItem={outlineEditor.reorderItem}
              onDuplicateItem={outlineEditor.duplicateItem}
              onDeleteItem={outlineEditor.deleteItem}
              onAddItem={outlineEditor.addItem}
              onUploadClick={() => ws.fileInputRef.current?.click()}
              onCollapseLeft={() => ws.setLeftOpen(false)}
              onOpenThemeModal={() => setShowThemeModal(true)}
              onOpenLLMSettings={handleOpenLLMSettings}
              onOpenShortcuts={() => setShowShortcuts(true)}
            />
          )}

          <SlideStageCanvas
            pid={ws.pid}
            project={ws.project}
            outline={outlineEditor.diffPreviewOutline || outline}
            version={version}
            isStale={isStale}
            selectedIndex={Math.min(
              ws.selectedIndex,
              Math.max(
                0,
                (outlineEditor.diffPreviewOutline || outline).items.length - 1
              )
            )}
            preview={generation.preview}
            report={generation.report}
            issues={generation.issues}
            issueSlideIndices={ws.issueSlideIndices}
            activeTheme={ws.activeTheme}
            exportInSync={generation.exportInSync}
            statusText={generation.status}
            isGenerating={generation.isGenerating}
            materials={ws.materials}
            brand={ws.project?.brand ?? null}
            diffPreviewActive={Boolean(outlineEditor.diffPreviewOutline)}
            isAgentBusy={chat.isChatStreaming}
            onStopAgent={chat.stopChatStreaming}
            onExitDiffPreview={() => void outlineEditor.toggleDiffPreview(null)}
            onRevertFromDiff={() => {
              if (outlineEditor.diffPreviewVersion) {
                const targetVer = outlineEditor.diffPreviewVersion;
                outlineEditor.setDiffPreviewVersion(null);
                outlineEditor.setDiffPreviewOutline(null);
                void outlineEditor.revertToOutlineVersion(targetVer);
              }
            }}
            onSelectIndex={ws.setSelectedIndex}
            onFocusField={ws.focusInspectorField}
            onUpdateCustomElement={(elId, patch) =>
              outlineEditor.updateCustomElement(ws.selectedIndex, elId, patch)
            }
            onDeleteCustomElement={(elId) =>
              outlineEditor.deleteCustomElement(ws.selectedIndex, elId)
            }
            onAddCustomElement={(el) =>
              outlineEditor.addCustomElement(ws.selectedIndex, el)
            }
            onDuplicateCustomElement={(elId) =>
              outlineEditor.duplicateCustomElement(ws.selectedIndex, elId)
            }
            onReorderCustomElement={(elId, dir) =>
              outlineEditor.reorderCustomElement(ws.selectedIndex, elId, dir)
            }
            onSelectedCustomElementChange={ws.handleSelectedCustomElementChange}
          />

          {ws.rightOpen && (
            <div
              aria-hidden
              onClick={() => ws.setRightOpen(false)}
              className="min-[1100px]:hidden fixed inset-x-0 top-12 bottom-0 z-20 bg-black/55 anim-scrim-in"
            />
          )}

          {ws.rightOpen && (
            <aside
              className={`w-[316px] xl:w-[356px] shrink-0 bg-ui-bg flex flex-col min-h-0 ${NARROW_OVERLAY_ASIDE}`}
            >
              {/* Right Rail Top Bar: AI 助手 / 属性 tabs + clear + close (×) */}
              <div className="h-10 px-4 flex items-center justify-between gap-2 shrink-0 select-none">
                <div className="flex items-center gap-4 text-[13px]">
                  <button
                    type="button"
                    onClick={() => ws.setRightPanelTab("chat")}
                    className={`cursor-pointer transition-colors whitespace-nowrap ${
                      ws.rightPanelTab === "chat"
                        ? "text-ui-text font-medium"
                        : "text-ui-text-muted hover:text-ui-text-secondary"
                    }`}
                  >
                    AI 助手
                  </button>
                  <button
                    type="button"
                    onClick={() => ws.setRightPanelTab("edit")}
                    className={`cursor-pointer transition-colors whitespace-nowrap ${
                      ws.rightPanelTab === "edit"
                        ? "text-ui-text font-medium"
                        : "text-ui-text-muted hover:text-ui-text-secondary"
                    }`}
                  >
                    属性
                  </button>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {ws.rightPanelTab === "chat" && renderClearChatControls()}
                  <button
                    type="button"
                    onClick={() => ws.setRightOpen(false)}
                    aria-label="收起右侧面板"
                    title="收起右侧面板"
                    className="p-1 rounded-md text-ui-icon-quiet hover:text-ui-text hover:bg-ui-bg-hover transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {ws.rightPanelTab === "chat" ? (
                renderAgentChatPanel(true)
              ) : (
                <SlideInspector
                  pid={ws.pid}
                  item={currentItem}
                  slideIndex={ws.selectedIndex}
                  totalSlides={outline.items.length}
                  materials={ws.materials}
                  sourceFragments={ws.sourceFragments}
                  slideIssues={ws.currentSlideIssues}
                  activeTheme={ws.activeTheme}
                  onSelectLayout={outlineEditor.handleSelectLayout}
                  onOpenThemeModal={() => setShowThemeModal(true)}
                  embedded={true}
                  readOnly={chat.isChatStreaming}
                  onStopAgent={chat.stopChatStreaming}
                  onUpdateField={(field, val) =>
                    outlineEditor.patchItem(ws.selectedIndex, { [field]: val })
                  }
                  onUpdateCustomElementText={(elId, text) =>
                    outlineEditor.updateCustomElementText(
                      ws.selectedIndex,
                      elId,
                      text
                    )
                  }
                  onUpdateCustomElement={(elId, patch) =>
                    outlineEditor.updateCustomElement(
                      ws.selectedIndex,
                      elId,
                      patch
                    )
                  }
                  onClearCustomLayout={() =>
                    outlineEditor.clearCustomLayout(ws.selectedIndex)
                  }
                  onSwitchToChat={() => ws.setRightPanelTab("chat")}
                  onInspectFragment={ws.setInspectedFragment}
                  savedLayouts={outlineEditor.savedLayouts}
                  onSaveCustomLayout={outlineEditor.saveCurrentCustomLayout}
                  onApplySavedLayout={outlineEditor.applySavedLayout}
                  onDeleteSavedLayout={outlineEditor.deleteSavedLayout}
                  onToggleSourceId={(sid) =>
                    outlineEditor.toggleSourceId(ws.selectedIndex, sid)
                  }
                  onApplyImageToSlide={(imgId, sid) =>
                    outlineEditor.applyImageToSlide(
                      ws.selectedIndex,
                      imgId,
                      sid
                    )
                  }
                  onSplitTwoColumn={() =>
                    outlineEditor.splitTwoColumn(ws.selectedIndex)
                  }
                  onUploadClick={() => ws.fileInputRef.current?.click()}
                />
              )}
            </aside>
          )}
        </section>
      ) : (
        <div className="flex-1 min-h-0 flex items-stretch overflow-hidden">
          <EmptyStageOnboarding
            materials={ws.materials}
            isGenerating={generation.isGenerating}
            llmConfigured={ws.llmSettings ? ws.llmSettings.configured : true}
            activeModelLabel={ws.llmSettings?.active_summary?.model || ""}
            llmSettings={ws.llmSettings}
            onLLMSettingsUpdated={handleLLMSettingsSwitched}
            onOpenLLMSettings={handleOpenLLMSettings}
            onUploadClick={() => ws.fileInputRef.current?.click()}
            onDropFiles={(files) => void ws.uploadFiles(files)}
            onPasteNote={ws.uploadPastedNote}
            onImportUrl={ws.importUrlMaterial}
            onGenerateOutline={(p) => void generation.genOutline(p)}
          />
          {ws.onboardingChatOpen && (
            <div
              aria-hidden
              onClick={() => ws.setOnboardingChatOpen(false)}
              className="min-[1100px]:hidden fixed inset-x-0 top-12 bottom-0 z-20 bg-black/55 anim-scrim-in"
            />
          )}
          {ws.onboardingChatOpen && (
            <aside
              className={`w-[332px] xl:w-[372px] shrink-0 bg-ui-bg flex flex-col min-h-0 ${NARROW_OVERLAY_ASIDE}`}
            >
              <div className="h-10 px-4 flex items-center justify-between gap-2 shrink-0">
                <span className="text-[13px] font-medium text-ui-text">
                  AI 助手
                </span>
                <div className="flex items-center gap-1">
                  {renderClearChatControls()}
                  <button
                    type="button"
                    onClick={() => ws.setOnboardingChatOpen(false)}
                    aria-label="收起对话面板"
                    className="p-1 rounded-md text-ui-icon-quiet hover:text-ui-text hover:bg-ui-bg-hover transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {renderAgentChatPanel(false)}
            </aside>
          )}
        </div>
      )}

      <SourceContextModal
        fragment={ws.inspectedFragment}
        materials={ws.materials}
        onClose={() => ws.setInspectedFragment(null)}
      />

      <ThemeBrandModal
        open={showThemeModal}
        themes={ws.themes}
        activeTheme={ws.activeTheme}
        selectedThemeId={ws.selectedThemeId}
        autoFit={ws.autoFit}
        brand={ws.project?.brand ?? null}
        imageAssets={imageAssets}
        onSelectTheme={ws.handleSelectTheme}
        onToggleAutoFit={() => ws.setAutoFit((v) => !v)}
        onUpdateBrand={ws.updateBrand}
        onClose={() => setShowThemeModal(false)}
      />

      <ShortcutsModal
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      <LLMSettingsModal
        open={ws.showLLMModal}
        settings={ws.llmSettings}
        reasonBanner={ws.llmModalReason}
        onClose={() => {
          ws.setShowLLMModal(false);
          ws.setLlmModalReason(null);
          ws.pendingOutlinePromptRef.current = null;
        }}
        onSettingsUpdated={(next) => {
          ws.setLlmSettings(next);
          if (next.configured && next.active_summary) {
            ws.flashToast(`已启用模型：${next.active_summary.model}`);
            const pending = ws.pendingOutlinePromptRef.current;
            if (pending) {
              ws.pendingOutlinePromptRef.current = null;
              ws.setLlmModalReason(null);
              void generation.genOutline(pending.prompt, true);
            }
          }
        }}
      />
    </div>
  );
}

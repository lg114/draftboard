"use client";

import { Sparkles, Trash2, X } from "lucide-react";
import { LLMSettingsModal } from "../../../components/LLMSettingsModal";
import { AgentChatPanel } from "../../../components/workspace/AgentChatPanel";
import { EmptyStageOnboarding } from "../../../components/workspace/EmptyStageOnboarding";
import {
  inferEffectiveLayout,
  LAYOUT_LABELS,
} from "../../../components/workspace/layoutUtils";
import { MaterialsDrawer } from "../../../components/workspace/MaterialsDrawer";
import { PreflightModal } from "../../../components/workspace/PreflightModal";
import { SlideInspector } from "../../../components/workspace/SlideInspector";
import { SlideNavigator } from "../../../components/workspace/SlideNavigator";
import { SlideStageCanvas } from "../../../components/workspace/SlideStageCanvas";
import { SourceContextModal } from "../../../components/workspace/SourceContextModal";
import { WorkspaceHeader } from "../../../components/workspace/WorkspaceHeader";
import { useProjectWorkspace } from "../../../hooks/workspace/useProjectWorkspace";

export default function ProjectWorkspacePage() {
  const ws = useProjectWorkspace();
  const { outlineEditor, generation, chat } = ws;
  const { outline, version, isStale, isSaving, undoStack, redoStack } =
    outlineEditor;

  const currentItem = outline?.items[ws.selectedIndex];

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
            className="px-2.5 py-1 rounded-lg bg-danger text-white text-[13px] font-medium hover:bg-danger-hover transition-colors cursor-pointer"
          >
            确认清空
          </button>
          <button
            type="button"
            onClick={() => ws.setConfirmClearChat(false)}
            className="px-2 py-1 rounded-lg text-[13px] text-ink-secondary hover:text-ink hover:bg-black/[0.05] cursor-pointer"
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
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[13px] text-ink-muted hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>清空</span>
      </button>
    );
  };

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-canvas text-ink">
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
          Boolean(outline && outline.items.length > 0)
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
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={outlineEditor.handleUndo}
        onRedo={outlineEditor.handleRedo}
        onToggleLeft={() => ws.setLeftOpen((v) => !v)}
        onToggleRight={() => ws.setRightOpen((v) => !v)}
        onToggleChat={ws.handleToggleChat}
        onOpenLLMSettings={handleOpenLLMSettings}
        onOpenPreflight={() => ws.setShowPreflight(true)}
        onToggleMaterialsDrawer={() => ws.setShowMaterialsDrawer((v) => !v)}
        onSelectVersion={(v) => void outlineEditor.showOutline(v)}
        onSaveOutline={() => void outlineEditor.saveOutline(false)}
        onFlushBeforeLeave={async () => {
          await ws.flushOutlineIfReady();
        }}
        onRenameProject={ws.renameProject}
        onUploadClick={() => ws.fileInputRef.current?.click()}
        onGenerateOutline={() => void generation.genOutline()}
        onConfirmGenerate={() => void generation.confirmGenerate()}
      />

      <MaterialsDrawer
        open={ws.showMaterialsDrawer}
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

      {/* Calm Floating Toast */}
      {ws.toastMounted &&
        (ws.toast || ws.lastToastRef.current) &&
        (() => {
          const activeToast = ws.toast || ws.lastToastRef.current!;
          return (
            <div
              className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full apple-glass dock-shadow text-[13px] font-medium text-ink whitespace-nowrap flex items-center gap-3 ${
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
                  className="px-2.5 py-0.5 rounded-full bg-ink text-white text-[13px] font-medium hover:bg-ink-hover transition-colors cursor-pointer"
                >
                  {activeToast.actionLabel}
                </button>
              )}
            </div>
          );
        })()}

      {/* Quiet Inline Error Strip */}
      {ws.humanizedError && (
        <div className="border-b border-danger/20 bg-danger-bg px-5 py-2.5 text-[13px] text-danger shrink-0 anim-msg-in">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
              <span className="font-medium truncate">{ws.humanizedError}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 text-[13px]">
              <button
                type="button"
                onClick={handleOpenLLMSettings}
                className="text-danger font-medium underline underline-offset-2 hover:opacity-80 cursor-pointer"
              >
                检查模型设置
              </button>
              {ws.rawError && ws.rawError !== ws.humanizedError && (
                <button
                  type="button"
                  onClick={() => ws.setShowErrorDetail((v) => !v)}
                  className="text-danger/80 hover:text-danger underline cursor-pointer"
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
                className="text-danger/70 hover:text-danger cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
          {ws.showErrorDetail && ws.rawError && (
            <pre className="max-w-6xl mx-auto mt-2 p-2.5 rounded-xl bg-surface/80 text-[13px] font-mono text-danger whitespace-pre-wrap overflow-x-auto">
              {ws.rawError}
            </pre>
          )}
        </div>
      )}

      {/* Main Content: Empty Onboarding OR 3-Column Keynote Studio */}
      {outline && outline.items.length > 0 && currentItem ? (
        <section className="flex-1 min-h-0 flex items-stretch overflow-hidden">
          {ws.leftOpen && (
            <SlideNavigator
              pid={ws.pid}
              outline={outline}
              selectedIndex={ws.selectedIndex}
              activeTheme={ws.activeTheme}
              brand={ws.project?.brand ?? null}
              issueSlideIndices={ws.issueSlideIndices}
              onSelectIndex={ws.setSelectedIndex}
              onMoveItem={outlineEditor.moveItem}
              onReorderItem={outlineEditor.reorderItem}
              onDuplicateItem={outlineEditor.duplicateItem}
              onDeleteItem={outlineEditor.deleteItem}
              onAddItem={outlineEditor.addItem}
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
            themes={ws.themes}
            activeTheme={ws.activeTheme}
            selectedThemeId={ws.selectedThemeId}
            autoFit={ws.autoFit}
            exportInSync={generation.exportInSync}
            statusText={generation.status}
            isGenerating={generation.isGenerating}
            materials={ws.materials}
            brand={ws.project?.brand ?? null}
            diffPreviewActive={Boolean(outlineEditor.diffPreviewOutline)}
            onExitDiffPreview={() => void outlineEditor.toggleDiffPreview(null)}
            onRevertFromDiff={() => {
              if (outlineEditor.diffPreviewVersion) {
                const targetVer = outlineEditor.diffPreviewVersion;
                outlineEditor.setDiffPreviewVersion(null);
                outlineEditor.setDiffPreviewOutline(null);
                void outlineEditor.revertToOutlineVersion(targetVer);
              }
            }}
            onUpdateBrand={ws.updateBrand}
            onSelectIndex={ws.setSelectedIndex}
            onSelectTheme={ws.handleSelectTheme}
            onSelectLayout={outlineEditor.handleSelectLayout}
            onToggleAutoFit={() => ws.setAutoFit((v) => !v)}
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
            <aside className="w-[344px] xl:w-[396px] shrink-0 bg-surface-subtle border-l border-black/[0.08] flex flex-col min-h-0">
              {/* Dual-Mode Right Sidebar Top Bar: Edit vs AI Chat */}
              <div className="px-4 py-2.5 border-b border-black/[0.07] bg-surface-subtle flex items-center justify-between gap-2 shrink-0">
                <div className="inline-flex items-center bg-black/[0.06] p-[3px] rounded-xl gap-0.5">
                  <button
                    type="button"
                    onClick={() => ws.setRightPanelTab("edit")}
                    className={`px-3 py-1 rounded-[9px] text-[13px] transition-all cursor-pointer whitespace-nowrap ${
                      ws.rightPanelTab === "edit"
                        ? "bg-surface text-ink font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.06)]"
                        : "text-ink-secondary hover:text-ink font-medium"
                    }`}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => ws.setRightPanelTab("chat")}
                    className={`px-3 py-1 rounded-[9px] text-[13px] inline-flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                      ws.rightPanelTab === "chat"
                        ? "bg-surface text-ink font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.06)]"
                        : "text-ink-secondary hover:text-ink font-medium"
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI 对话</span>
                  </button>
                </div>

                {ws.rightPanelTab === "edit" ? (
                  <div className="flex items-center gap-2 text-[13px] whitespace-nowrap truncate">
                    <span className="font-semibold text-ink">
                      第 {ws.selectedIndex + 1} 页
                    </span>
                    <span className="text-ink-secondary">
                      {currentItem.custom_elements &&
                      currentItem.custom_elements.length > 0
                        ? "自由画布"
                        : LAYOUT_LABELS[
                            inferEffectiveLayout(
                              currentItem.layout,
                              ws.selectedIndex,
                              outline.items.length
                            )
                          ] || "正文"}
                    </span>
                  </div>
                ) : (
                  renderClearChatControls()
                )}
              </div>

              {ws.rightPanelTab === "chat" ? (
                <AgentChatPanel
                  pid={ws.pid}
                  outline={outline}
                  selectedIndex={ws.selectedIndex}
                  materials={ws.materials}
                  materialsCount={ws.materials.length}
                  themes={ws.themes}
                  selectedThemeId={ws.selectedThemeId}
                  autoFit={ws.autoFit}
                  messages={chat.chatMessages}
                  isStreaming={chat.isChatStreaming}
                  llmConfigured={
                    ws.llmSettings ? ws.llmSettings.configured : true
                  }
                  activeModelLabel={ws.llmSettings?.active_summary?.model || ""}
                  llmSettings={ws.llmSettings}
                  onLLMSettingsUpdated={handleLLMSettingsSwitched}
                  diffPreviewVersion={outlineEditor.diffPreviewVersion}
                  onToggleDiffPreview={(ver) =>
                    void outlineEditor.toggleDiffPreview(ver)
                  }
                  onOpenLLMSettings={handleOpenLLMSettings}
                  onSendMessage={(msg) => void chat.sendChatMessage(msg)}
                  onRetryMessage={chat.retryChatMessage}
                  onStopStreaming={chat.stopChatStreaming}
                  onJumpToSlide={ws.setSelectedIndex}
                  onRevertVersion={(v) =>
                    void outlineEditor.revertToOutlineVersion(v)
                  }
                  onUploadClick={() => ws.fileInputRef.current?.click()}
                  onDropFiles={(files) => void ws.uploadFiles(files)}
                />
              ) : (
                <SlideInspector
                  pid={ws.pid}
                  item={currentItem}
                  slideIndex={ws.selectedIndex}
                  totalSlides={outline.items.length}
                  materials={ws.materials}
                  sourceFragments={ws.sourceFragments}
                  slideIssues={ws.currentSlideIssues}
                  llmConfigured={
                    ws.llmSettings ? ws.llmSettings.configured : true
                  }
                  activeModelLabel={ws.llmSettings?.active_summary?.model || ""}
                  llmSettings={ws.llmSettings}
                  onLLMSettingsUpdated={handleLLMSettingsSwitched}
                  onOpenLLMSettings={handleOpenLLMSettings}
                  embedded={true}
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
                  onRefineSlide={(mode, inst) =>
                    outlineEditor.refineSlideItem(ws.selectedIndex, mode, inst)
                  }
                  onApplyRefineCandidate={(cand) =>
                    outlineEditor.applyRefineCandidate(ws.selectedIndex, cand)
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
            <aside className="w-[360px] xl:w-[410px] shrink-0 bg-surface-subtle border-l border-black/[0.08] flex flex-col min-h-0">
              <div className="px-4 py-2.5 border-b border-black/[0.07] bg-surface-subtle flex items-center justify-between gap-2 shrink-0">
                <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink">
                  <Sparkles className="w-4 h-4" />
                  <span>AI 对话</span>
                </span>
                <div className="flex items-center gap-1">
                  {renderClearChatControls()}
                  <button
                    type="button"
                    onClick={() => ws.setOnboardingChatOpen(false)}
                    aria-label="收起对话面板"
                    className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <AgentChatPanel
                pid={ws.pid}
                outline={null}
                selectedIndex={0}
                materials={ws.materials}
                materialsCount={ws.materials.length}
                themes={ws.themes}
                selectedThemeId={ws.selectedThemeId}
                autoFit={ws.autoFit}
                messages={chat.chatMessages}
                isStreaming={chat.isChatStreaming}
                llmConfigured={
                  ws.llmSettings ? ws.llmSettings.configured : true
                }
                activeModelLabel={ws.llmSettings?.active_summary?.model || ""}
                llmSettings={ws.llmSettings}
                onLLMSettingsUpdated={handleLLMSettingsSwitched}
                onOpenLLMSettings={handleOpenLLMSettings}
                onSendMessage={(msg) => void chat.sendChatMessage(msg)}
                onRetryMessage={chat.retryChatMessage}
                onStopStreaming={chat.stopChatStreaming}
                onJumpToSlide={ws.setSelectedIndex}
                onRevertVersion={(v) =>
                  void outlineEditor.revertToOutlineVersion(v)
                }
                onUploadClick={() => ws.fileInputRef.current?.click()}
                onDropFiles={(files) => void ws.uploadFiles(files)}
              />
            </aside>
          )}
        </div>
      )}

      <SourceContextModal
        fragment={ws.inspectedFragment}
        materials={ws.materials}
        onClose={() => ws.setInspectedFragment(null)}
      />

      <PreflightModal
        open={ws.showPreflight}
        pid={ws.pid}
        version={version}
        themeId={ws.selectedThemeId}
        autoFit={ws.autoFit}
        onBeforeCheck={ws.flushOutlineIfReady}
        onJumpToSlide={ws.setSelectedIndex}
        onClose={() => ws.setShowPreflight(false)}
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

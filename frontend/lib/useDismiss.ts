"use client";

import { type RefObject, useEffect, useRef } from "react";

/**
 * Close a popover on Escape or on any pointer-down outside the given elements.
 *
 * Replaces `fixed inset-0` click-catcher backdrops, which silently break when an
 * ancestor has `transform` / `backdrop-filter` (it becomes the containing block,
 * so the "full-screen" backdrop only covers that ancestor).
 */
export function useDismiss(
  open: boolean,
  onClose: () => void,
  refs: RefObject<HTMLElement | null>[]
) {
  const onCloseRef = useRef(onClose);
  const refsRef = useRef(refs);

  useEffect(() => {
    onCloseRef.current = onClose;
    refsRef.current = refs;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) onCloseRef.current();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (refsRef.current.some((r) => r.current?.contains(target))) return;
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);
}

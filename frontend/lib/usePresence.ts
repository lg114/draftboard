"use client";

import { useEffect, useState } from "react";

/**
 * Lightweight, 100% interruptible enter/exit presence hook (zero external deps).
 * Keeps an overlay mounted for `exitMs` after `open` flips false so exit animations
 * play smoothly; if `open` flips back true mid-exit, the unmount timer is cancelled.
 */
export function usePresence(open: boolean, exitMs = 150) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);

  return {
    mounted: open || mounted,
    exiting: !open && mounted,
  };
}

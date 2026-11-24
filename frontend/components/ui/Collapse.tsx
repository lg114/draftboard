"use client";

import type { ReactNode } from "react";

/**
 * Interruptible CSS grid-row collapse/expand container (0fr -> 1fr)
 * matching macOS Keynote disclosure smoothness without height measurement jank.
 */
export function Collapse({
  open,
  children,
  className = "",
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`ui-collapse ${className}`}
      data-open={open ? "true" : "false"}
      aria-hidden={!open}
    >
      <div className="ui-collapse-inner">{children}</div>
    </div>
  );
}

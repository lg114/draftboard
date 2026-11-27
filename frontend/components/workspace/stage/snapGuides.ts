import type { CanvasElement } from "../../../lib/api";

export const CANVAS_W = 960;
export const CANVAS_H = 540;
export const SNAP_THRESHOLD = 6;

export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapLine {
  axis: "x" | "y";
  pos: number;
  start: number;
  end: number;
  isCanvas?: boolean;
}

export interface SpacingGuide {
  axis: "x" | "y";
  start: number;
  end: number;
  cross: number;
  gapPx: number;
}

export interface SmartSnapResult {
  dx: number;
  dy: number;
  lines: SnapLine[];
  spacings: SpacingGuide[];
}

export type AlignMode =
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "centerY"
  | "bottom";

export type DistributeAxis = "horizontal" | "vertical";

/**
 * Normalized positive-dimension bounding box for any CanvasElement
 * (handles negative w/h on diagonal `line` primitives).
 */
export function getElementBounds(el: CanvasElement): BoxRect {
  if (el.kind === "line") {
    const x1 = el.x;
    const y1 = el.y;
    const x2 = el.x + el.w;
    const y2 = el.y + el.h;
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

export function computeGroupBounds(elements: CanvasElement[]): BoxRect | null {
  if (elements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    const b = getElementBounds(el);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  return {
    x: minX,
    y: minY,
    w: Math.max(0, maxX - minX),
    h: Math.max(0, maxY - minY),
  };
}

export function rectsIntersect(a: BoxRect, b: BoxRect): boolean {
  const bw = Math.max(b.w, 2);
  const bh = Math.max(b.h, 2);
  return (
    a.x <= b.x + bw &&
    a.x + a.w >= b.x &&
    a.y <= b.y + bh &&
    a.y + a.h >= b.y
  );
}

interface AxisTarget {
  pos: number;
  spanStart: number;
  spanEnd: number;
  isCanvas: boolean;
}

/**
 * Compute smart magnetic snapping (canvas margins/center, sibling edges/centers,
 * and equal-spacing gaps) for a moving bounding box in 960x540 coordinates.
 * Returns incremental (dx, dy) corrections plus visual SnapLines & SpacingGuides.
 */
export function computeSmartSnap(
  movingBox: BoxRect,
  siblings: CanvasElement[],
  options?: { disableSnap?: boolean }
): SmartSnapResult {
  if (options?.disableSnap) {
    return { dx: 0, dy: 0, lines: [], spacings: [] };
  }

  const nonLineSiblings = siblings
    .filter((s) => s.kind !== "line")
    .map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }));

  const xTargets: AxisTarget[] = [
    { pos: 48, spanStart: 0, spanEnd: CANVAS_H, isCanvas: true },
    { pos: CANVAS_W / 2, spanStart: 0, spanEnd: CANVAS_H, isCanvas: true },
    { pos: CANVAS_W - 48, spanStart: 0, spanEnd: CANVAS_H, isCanvas: true },
  ];
  const yTargets: AxisTarget[] = [
    { pos: 36, spanStart: 0, spanEnd: CANVAS_W, isCanvas: true },
    { pos: CANVAS_H / 2, spanStart: 0, spanEnd: CANVAS_W, isCanvas: true },
    { pos: CANVAS_H - 36, spanStart: 0, spanEnd: CANVAS_W, isCanvas: true },
  ];

  for (const s of nonLineSiblings) {
    xTargets.push(
      { pos: s.x, spanStart: s.y, spanEnd: s.y + s.h, isCanvas: false },
      { pos: s.x + s.w / 2, spanStart: s.y, spanEnd: s.y + s.h, isCanvas: false },
      { pos: s.x + s.w, spanStart: s.y, spanEnd: s.y + s.h, isCanvas: false }
    );
    yTargets.push(
      { pos: s.y, spanStart: s.x, spanEnd: s.x + s.w, isCanvas: false },
      { pos: s.y + s.h / 2, spanStart: s.x, spanEnd: s.x + s.w, isCanvas: false },
      { pos: s.y + s.h, spanStart: s.x, spanEnd: s.x + s.w, isCanvas: false }
    );
  }

  // 1. Edge / center snapping along X
  let bestDx = 0;
  let bestAbsDx = SNAP_THRESHOLD + 0.01;
  const xAnchors = [
    movingBox.x,
    movingBox.x + movingBox.w / 2,
    movingBox.x + movingBox.w,
  ];
  for (const anchor of xAnchors) {
    for (const target of xTargets) {
      const diff = target.pos - anchor;
      const abs = Math.abs(diff);
      if (abs < bestAbsDx) {
        bestAbsDx = abs;
        bestDx = diff;
      }
    }
  }

  // 2. Edge / center snapping along Y
  let bestDy = 0;
  let bestAbsDy = SNAP_THRESHOLD + 0.01;
  const yAnchors = [
    movingBox.y,
    movingBox.y + movingBox.h / 2,
    movingBox.y + movingBox.h,
  ];
  for (const anchor of yAnchors) {
    for (const target of yTargets) {
      const diff = target.pos - anchor;
      const abs = Math.abs(diff);
      if (abs < bestAbsDy) {
        bestAbsDy = abs;
        bestDy = diff;
      }
    }
  }

  // 3. Equal-spacing snapping along X (if closer than edge snap or no edge snap)
  const hOverlapSiblings = nonLineSiblings
    .filter(
      (s) =>
        Math.min(movingBox.y + movingBox.h, s.y + s.h) -
          Math.max(movingBox.y, s.y) >
        4
    )
    .sort((a, b) => a.x - b.x);

  const eqX = findEqualSpacingDelta("x", movingBox, hOverlapSiblings);
  if (eqX !== null && Math.abs(eqX) < bestAbsDx) {
    bestDx = eqX;
    bestAbsDx = Math.abs(eqX);
  }

  // 4. Equal-spacing snapping along Y
  const vOverlapSiblings = nonLineSiblings
    .filter(
      (s) =>
        Math.min(movingBox.x + movingBox.w, s.x + s.w) -
          Math.max(movingBox.x, s.x) >
        4
    )
    .sort((a, b) => a.y - b.y);

  const eqY = findEqualSpacingDelta("y", movingBox, vOverlapSiblings);
  if (eqY !== null && Math.abs(eqY) < bestAbsDy) {
    bestDy = eqY;
    bestAbsDy = Math.abs(eqY);
  }

  const dx = bestAbsDx <= SNAP_THRESHOLD ? Math.round(bestDx) : 0;
  const dy = bestAbsDy <= SNAP_THRESHOLD ? Math.round(bestDy) : 0;

  const snappedBox: BoxRect = {
    x: movingBox.x + dx,
    y: movingBox.y + dy,
    w: movingBox.w,
    h: movingBox.h,
  };

  // 5. Collect ALL matching alignment guide lines at the final snapped position
  const lines: SnapLine[] = [];
  const finalXAnchors = [
    snappedBox.x,
    snappedBox.x + snappedBox.w / 2,
    snappedBox.x + snappedBox.w,
  ];
  const matchedXPositions = new Map<number, SnapLine>();
  for (const anchor of finalXAnchors) {
    for (const t of xTargets) {
      if (Math.abs(t.pos - anchor) <= 0.6) {
        const key = Math.round(t.pos * 2) / 2;
        const existing = matchedXPositions.get(key);
        const start = t.isCanvas
          ? 0
          : Math.min(snappedBox.y, t.spanStart);
        const end = t.isCanvas
          ? CANVAS_H
          : Math.max(snappedBox.y + snappedBox.h, t.spanEnd);
        if (!existing) {
          matchedXPositions.set(key, {
            axis: "x",
            pos: t.pos,
            start,
            end,
            isCanvas: t.isCanvas,
          });
        } else {
          existing.start = Math.min(existing.start, start);
          existing.end = Math.max(existing.end, end);
          existing.isCanvas = existing.isCanvas || t.isCanvas;
        }
      }
    }
  }
  lines.push(...matchedXPositions.values());

  const finalYAnchors = [
    snappedBox.y,
    snappedBox.y + snappedBox.h / 2,
    snappedBox.y + snappedBox.h,
  ];
  const matchedYPositions = new Map<number, SnapLine>();
  for (const anchor of finalYAnchors) {
    for (const t of yTargets) {
      if (Math.abs(t.pos - anchor) <= 0.6) {
        const key = Math.round(t.pos * 2) / 2;
        const existing = matchedYPositions.get(key);
        const start = t.isCanvas
          ? 0
          : Math.min(snappedBox.x, t.spanStart);
        const end = t.isCanvas
          ? CANVAS_W
          : Math.max(snappedBox.x + snappedBox.w, t.spanEnd);
        if (!existing) {
          matchedYPositions.set(key, {
            axis: "y",
            pos: t.pos,
            start,
            end,
            isCanvas: t.isCanvas,
          });
        } else {
          existing.start = Math.min(existing.start, start);
          existing.end = Math.max(existing.end, end);
          existing.isCanvas = existing.isCanvas || t.isCanvas;
        }
      }
    }
  }
  lines.push(...matchedYPositions.values());

  // 6. Collect matching equal-spacing indicators at final snapped position
  const spacings: SpacingGuide[] = [
    ...collectEqualSpacingGuides("x", snappedBox, hOverlapSiblings),
    ...collectEqualSpacingGuides("y", snappedBox, vOverlapSiblings),
  ];

  return { dx, dy, lines, spacings };
}

function findEqualSpacingDelta(
  axis: "x" | "y",
  box: BoxRect,
  siblings: BoxRect[]
): number | null {
  if (siblings.length < 2) return null;
  const pos = (b: BoxRect) => (axis === "x" ? b.x : b.y);
  const size = (b: BoxRect) => (axis === "x" ? b.w : b.h);
  const end = (b: BoxRect) => pos(b) + size(b);

  const bStart = pos(box);
  const bSize = size(box);
  const bEnd = bStart + bSize;

  let bestDelta: number | null = null;
  let bestAbs = SNAP_THRESHOLD + 0.01;

  const tryTargetStart = (targetStart: number) => {
    const diff = targetStart - bStart;
    const abs = Math.abs(diff);
    if (abs < bestAbs) {
      bestAbs = abs;
      bestDelta = diff;
    }
  };

  // Case A: Centered between nearest left/top sibling and nearest right/bottom sibling
  let leftNeighbor: BoxRect | null = null;
  let rightNeighbor: BoxRect | null = null;
  for (const s of siblings) {
    if (end(s) <= bStart + SNAP_THRESHOLD) {
      if (!leftNeighbor || end(s) > end(leftNeighbor)) leftNeighbor = s;
    } else if (pos(s) >= bEnd - SNAP_THRESHOLD) {
      if (!rightNeighbor || pos(s) < pos(rightNeighbor)) rightNeighbor = s;
    }
  }
  if (leftNeighbor && rightNeighbor) {
    const freeSpace = pos(rightNeighbor) - end(leftNeighbor) - bSize;
    if (freeSpace >= 4) {
      tryTargetStart(end(leftNeighbor) + freeSpace / 2);
    }
  }

  // Case B: Matching adjacent sibling-to-sibling gap on either side
  for (let i = 0; i < siblings.length - 1; i += 1) {
    const a = siblings[i];
    const b = siblings[i + 1];
    const gap = pos(b) - end(a);
    if (gap < 4) continue;
    // Box placed after B: [A] --gap-- [B] --gap-- [Box]
    if (bStart >= end(b) - SNAP_THRESHOLD) {
      tryTargetStart(end(b) + gap);
    }
    // Box placed before A: [Box] --gap-- [A] --gap-- [B]
    if (bEnd <= pos(a) + SNAP_THRESHOLD) {
      tryTargetStart(pos(a) - gap - bSize);
    }
  }

  return bestAbs <= SNAP_THRESHOLD ? bestDelta : null;
}

function collectEqualSpacingGuides(
  axis: "x" | "y",
  box: BoxRect,
  siblings: BoxRect[]
): SpacingGuide[] {
  if (siblings.length < 2) return [];
  const pos = (b: BoxRect) => (axis === "x" ? b.x : b.y);
  const size = (b: BoxRect) => (axis === "x" ? b.w : b.h);
  const end = (b: BoxRect) => pos(b) + size(b);
  const crossMid = (a: BoxRect, b: BoxRect) => {
    if (axis === "x") {
      const top = Math.max(a.y, b.y);
      const bot = Math.min(a.y + a.h, b.y + b.h);
      return (top + bot) / 2;
    }
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.w, b.x + b.w);
    return (left + right) / 2;
  };

  // Insert snapped box into sorted sibling chain
  const all = [...siblings.map((s) => ({ rect: s, isMoving: false })), { rect: box, isMoving: true }];
  all.sort((a, b) => pos(a.rect) - pos(b.rect));

  const movingIdx = all.findIndex((item) => item.isMoving);
  const guides: SpacingGuide[] = [];
  const addedKeys = new Set<string>();
  const addGuide = (a: BoxRect, b: BoxRect) => {
    const start = end(a);
    const stop = pos(b);
    const gapPx = Math.round(stop - start);
    if (gapPx < 4) return;
    const key = `${axis}:${Math.round(start)}:${Math.round(stop)}`;
    if (addedKeys.has(key)) return;
    addedKeys.add(key);
    guides.push({
      axis,
      start,
      end: stop,
      cross: crossMid(a, b),
      gapPx,
    });
  };

  const TOL = 1.5;

  // Check centered between movingIdx - 1 and movingIdx + 1
  if (movingIdx > 0 && movingIdx < all.length - 1) {
    const left = all[movingIdx - 1].rect;
    const right = all[movingIdx + 1].rect;
    const g1 = pos(box) - end(left);
    const g2 = pos(right) - end(box);
    if (g1 >= 4 && g2 >= 4 && Math.abs(g1 - g2) <= TOL) {
      addGuide(left, box);
      addGuide(box, right);
    }
  }

  // Check chain to the left: [i-2] --g1-- [i-1] --g2-- [box]
  if (movingIdx >= 2) {
    const prev2 = all[movingIdx - 2].rect;
    const prev1 = all[movingIdx - 1].rect;
    const g1 = pos(prev1) - end(prev2);
    const g2 = pos(box) - end(prev1);
    if (g1 >= 4 && g2 >= 4 && Math.abs(g1 - g2) <= TOL) {
      addGuide(prev2, prev1);
      addGuide(prev1, box);
    }
  }

  // Check chain to the right: [box] --g1-- [i+1] --g2-- [i+2]
  if (movingIdx <= all.length - 3) {
    const next1 = all[movingIdx + 1].rect;
    const next2 = all[movingIdx + 2].rect;
    const g1 = pos(next1) - end(box);
    const g2 = pos(next2) - end(next1);
    if (g1 >= 4 && g2 >= 4 && Math.abs(g1 - g2) <= TOL) {
      addGuide(box, next1);
      addGuide(next1, next2);
    }
  }

  return guides;
}

/**
 * Compute atomic position patches to align 2+ selected elements relative to
 * their collective bounding box.
 */
export function computeAlignPatches(
  elements: CanvasElement[],
  selectedIds: string[],
  mode: AlignMode
): Record<string, Partial<CanvasElement>> {
  const idSet = new Set(selectedIds);
  const selected = elements.filter((e) => idSet.has(e.id));
  if (selected.length < 2) return {};
  const group = computeGroupBounds(selected);
  if (!group) return {};

  const patches: Record<string, Partial<CanvasElement>> = {};
  for (const el of selected) {
    const b = getElementBounds(el);
    let dx = 0;
    let dy = 0;
    if (mode === "left") {
      dx = group.x - b.x;
    } else if (mode === "centerX") {
      dx = group.x + group.w / 2 - (b.x + b.w / 2);
    } else if (mode === "right") {
      dx = group.x + group.w - (b.x + b.w);
    } else if (mode === "top") {
      dy = group.y - b.y;
    } else if (mode === "centerY") {
      dy = group.y + group.h / 2 - (b.y + b.h / 2);
    } else if (mode === "bottom") {
      dy = group.y + group.h - (b.y + b.h);
    }
    const nx = Math.round(el.x + dx);
    const ny = Math.round(el.y + dy);
    if (nx !== el.x || ny !== el.y) {
      patches[el.id] = { x: nx, y: ny };
    }
  }
  return patches;
}

/**
 * Compute atomic position patches to evenly distribute 3+ selected elements
 * along the horizontal or vertical axis (keeping the outer two fixed).
 */
export function computeDistributePatches(
  elements: CanvasElement[],
  selectedIds: string[],
  axis: DistributeAxis
): Record<string, Partial<CanvasElement>> {
  const idSet = new Set(selectedIds);
  const selected = elements.filter((e) => idSet.has(e.id));
  if (selected.length < 3) return {};

  const items = selected
    .map((el) => ({ el, b: getElementBounds(el) }))
    .sort((a, b) =>
      axis === "horizontal" ? a.b.x - b.b.x : a.b.y - b.b.y
    );

  const first = items[0];
  const last = items[items.length - 1];
  const patches: Record<string, Partial<CanvasElement>> = {};

  if (axis === "horizontal") {
    const spanStart = first.b.x;
    const spanEnd = last.b.x + last.b.w;
    const totalW = items.reduce((acc, it) => acc + it.b.w, 0);
    const gap = (spanEnd - spanStart - totalW) / (items.length - 1);

    if (gap >= 0) {
      let cursor = spanStart + first.b.w + gap;
      for (let i = 1; i < items.length - 1; i += 1) {
        const { el, b } = items[i];
        const dx = cursor - b.x;
        const nx = Math.round(el.x + dx);
        if (nx !== el.x) patches[el.id] = { x: nx };
        cursor += b.w + gap;
      }
    } else {
      // Overlapping fallback: distribute centers evenly
      const firstC = first.b.x + first.b.w / 2;
      const lastC = last.b.x + last.b.w / 2;
      const step = (lastC - firstC) / (items.length - 1);
      for (let i = 1; i < items.length - 1; i += 1) {
        const { el, b } = items[i];
        const targetC = firstC + step * i;
        const dx = targetC - (b.x + b.w / 2);
        const nx = Math.round(el.x + dx);
        if (nx !== el.x) patches[el.id] = { x: nx };
      }
    }
  } else {
    const spanStart = first.b.y;
    const spanEnd = last.b.y + last.b.h;
    const totalH = items.reduce((acc, it) => acc + it.b.h, 0);
    const gap = (spanEnd - spanStart - totalH) / (items.length - 1);

    if (gap >= 0) {
      let cursor = spanStart + first.b.h + gap;
      for (let i = 1; i < items.length - 1; i += 1) {
        const { el, b } = items[i];
        const dy = cursor - b.y;
        const ny = Math.round(el.y + dy);
        if (ny !== el.y) patches[el.id] = { y: ny };
        cursor += b.h + gap;
      }
    } else {
      const firstC = first.b.y + first.b.h / 2;
      const lastC = last.b.y + last.b.h / 2;
      const step = (lastC - firstC) / (items.length - 1);
      for (let i = 1; i < items.length - 1; i += 1) {
        const { el, b } = items[i];
        const targetC = firstC + step * i;
        const dy = targetC - (b.y + b.h / 2);
        const ny = Math.round(el.y + dy);
        if (ny !== el.y) patches[el.id] = { y: ny };
      }
    }
  }

  return patches;
}

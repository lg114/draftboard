"use client";

import type { OutlineLayout } from "../../../lib/api";

/**
 * True 16:9 (22x14) block-based miniature layout pictograms so users can
 * recognize each layout at a glance without reading the label.
 */
export function LayoutIcon({ layout }: { layout: OutlineLayout }) {
  switch (layout) {
    case "cover":
      return (
        <svg
          className="w-[22px] h-[14px] shrink-0"
          viewBox="0 0 22 14"
          fill="none"
        >
          <rect
            x="0.75"
            y="0.75"
            width="20.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.45"
          />
          <rect x="3" y="3.5" width="4.5" height="1.4" rx="0.7" fill="currentColor" />
          <rect x="3" y="6.2" width="12.5" height="2.4" rx="0.8" fill="currentColor" />
          <rect
            x="3"
            y="9.8"
            width="8.5"
            height="1.2"
            rx="0.6"
            fill="currentColor"
            fillOpacity="0.45"
          />
        </svg>
      );
    case "bullets":
      return (
        <svg
          className="w-[22px] h-[14px] shrink-0"
          viewBox="0 0 22 14"
          fill="none"
        >
          <rect
            x="0.75"
            y="0.75"
            width="20.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.45"
          />
          <rect x="3" y="2.8" width="9" height="1.6" rx="0.6" fill="currentColor" />
          <circle cx="3.8" cy="6.5" r="0.9" fill="currentColor" />
          <rect
            x="5.8"
            y="5.9"
            width="12"
            height="1.2"
            rx="0.6"
            fill="currentColor"
            fillOpacity="0.6"
          />
          <circle cx="3.8" cy="9" r="0.9" fill="currentColor" />
          <rect
            x="5.8"
            y="8.4"
            width="10"
            height="1.2"
            rx="0.6"
            fill="currentColor"
            fillOpacity="0.6"
          />
          <circle cx="3.8" cy="11.3" r="0.9" fill="currentColor" />
          <rect
            x="5.8"
            y="10.7"
            width="11"
            height="1.2"
            rx="0.6"
            fill="currentColor"
            fillOpacity="0.6"
          />
        </svg>
      );
    case "two_column":
      return (
        <svg
          className="w-[22px] h-[14px] shrink-0"
          viewBox="0 0 22 14"
          fill="none"
        >
          <rect
            x="0.75"
            y="0.75"
            width="20.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.45"
          />
          <rect x="3" y="2.6" width="9" height="1.5" rx="0.6" fill="currentColor" />
          <rect
            x="3"
            y="5.4"
            width="7.2"
            height="6.2"
            rx="1"
            fill="currentColor"
            fillOpacity="0.22"
          />
          <rect
            x="11.8"
            y="5.4"
            width="7.2"
            height="6.2"
            rx="1"
            fill="currentColor"
            fillOpacity="0.22"
          />
          <line
            x1="11"
            y1="5.4"
            x2="11"
            y2="11.6"
            stroke="currentColor"
            strokeWidth="0.9"
            strokeOpacity="0.5"
          />
        </svg>
      );
    case "text_image":
      return (
        <svg
          className="w-[22px] h-[14px] shrink-0"
          viewBox="0 0 22 14"
          fill="none"
        >
          <rect
            x="0.75"
            y="0.75"
            width="20.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.45"
          />
          <rect x="3" y="2.6" width="8.5" height="1.5" rx="0.6" fill="currentColor" />
          <rect
            x="3"
            y="5.8"
            width="6.2"
            height="1.1"
            rx="0.5"
            fill="currentColor"
            fillOpacity="0.55"
          />
          <rect
            x="3"
            y="8"
            width="5.4"
            height="1.1"
            rx="0.5"
            fill="currentColor"
            fillOpacity="0.55"
          />
          <rect
            x="3"
            y="10.2"
            width="4.4"
            height="1.1"
            rx="0.5"
            fill="currentColor"
            fillOpacity="0.4"
          />
          <rect
            x="11"
            y="5.1"
            width="8.2"
            height="6.6"
            rx="1.1"
            fill="currentColor"
            fillOpacity="0.24"
          />
          <path
            d="M12.2 10.6L14.2 8.4L15.6 9.8L16.8 8.7L18.2 10.6H12.2Z"
            fill="currentColor"
            fillOpacity="0.85"
          />
        </svg>
      );
    case "closing":
      return (
        <svg
          className="w-[22px] h-[14px] shrink-0"
          viewBox="0 0 22 14"
          fill="none"
        >
          <rect
            x="0.75"
            y="0.75"
            width="20.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.45"
          />
          <rect x="8.8" y="3.5" width="4.4" height="1.2" rx="0.6" fill="currentColor" />
          <rect x="5.5" y="6" width="11" height="2.2" rx="0.8" fill="currentColor" />
          <rect
            x="6.8"
            y="9.4"
            width="8.4"
            height="1.2"
            rx="0.6"
            fill="currentColor"
            fillOpacity="0.45"
          />
        </svg>
      );
    default:
      return (
        <svg
          className="w-[22px] h-[14px] shrink-0"
          viewBox="0 0 22 14"
          fill="none"
        >
          <rect
            x="0.75"
            y="0.75"
            width="20.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.45"
          />
          <rect x="3" y="2.8" width="9.5" height="1.6" rx="0.6" fill="currentColor" />
          <rect
            x="3"
            y="5.8"
            width="16"
            height="5.6"
            rx="1"
            fill="currentColor"
            fillOpacity="0.2"
          />
        </svg>
      );
  }
}

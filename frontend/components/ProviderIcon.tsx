import { Terminal } from "lucide-react";

/**
 * Official AI provider brand marks (sourced from @lobehub/icons-static-svg, MIT)
 * served locally from `/providers/*.svg` inside Draftboard's rounded badge.
 */

const OFFICIAL_PROVIDER_SVGS = new Set([
  "gemini",
  "openai",
  "deepseek",
  "siliconflow",
  "qwen",
  "kimi",
  "openrouter",
  "ollama",
]);

interface ProviderIconProps {
  provider?: string | null;
  size?: "sm" | "md" | "lg";
  muted?: boolean;
  className?: string;
}

export function ProviderIcon({
  provider,
  size = "md",
  muted = false,
  className = "",
}: ProviderIconProps) {
  const key = (provider || "custom").toLowerCase();
  const boxClass =
    size === "sm"
      ? "w-5 h-5 rounded-md p-[2.5px]"
      : size === "lg"
      ? "w-9 h-9 rounded-xl p-[7px]"
      : "w-7 h-7 rounded-lg p-[5px]";

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 bg-surface border border-black/[0.08] shadow-2xs transition-opacity ${boxClass} ${
        muted ? "opacity-65" : "opacity-100"
      } ${className}`}
    >
      {OFFICIAL_PROVIDER_SVGS.has(key) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/providers/${key}.svg`}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="w-full h-full object-contain select-none"
        />
      ) : (
        <Terminal
          className="w-full h-full text-ink-secondary"
          strokeWidth={1.8}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

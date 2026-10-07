import { useId } from "react";

/** The Nox mark: a crescent moon with a single star — code for the night shift. */
export function NoxMark({ size = 20, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={"shrink-0 " + className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-moon`} x1="0.15" y1="0.1" x2="0.85" y2="0.95">
          <stop offset="0" stopColor="#e9e4ff" />
          <stop offset="0.45" stopColor="var(--accent)" />
          <stop offset="1" stopColor="#3b2a8f" />
        </linearGradient>
        <mask id={`${id}-cut`}>
          <rect width="64" height="64" fill="#fff" />
          <circle cx="41" cy="22" r="20" fill="#000" />
        </mask>
      </defs>
      <circle cx="30" cy="34" r="24" fill={`url(#${id}-moon)`} mask={`url(#${id}-cut)`} />
      <path d="M48 6 L50.2 12.8 L57 15 L50.2 17.2 L48 24 L45.8 17.2 L39 15 L45.8 12.8 Z" fill="#fff" opacity="0.95" />
    </svg>
  );
}

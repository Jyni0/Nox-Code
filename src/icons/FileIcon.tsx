import { memo, useMemo } from "react";
import DOMPurify from "dompurify";
import { ICON_LIBRARY } from "./library";
import { resolveIcon, type IconSpec } from "./iconThemes";
import { useSettings } from "@/stores/settings";
import { setVsThemeRefs, useVsIcons } from "./vscodeThemes";

// VS Code icon themes kept in settings.
setVsThemeRefs(useSettings.getState().vscodeIconThemes);
useSettings.subscribe((s, p) => {
  if (s.vscodeIconThemes !== p.vscodeIconThemes) setVsThemeRefs(s.vscodeIconThemes);
});

export function IconView({ spec, size = 16 }: { spec: IconSpec; size?: number }) {
  switch (spec.type) {
    case "none":
      return null;
    case "glyph": {
      const Icon = ICON_LIBRARY[spec.icon] ?? ICON_LIBRARY.File;
      return <Icon size={size} className="shrink-0" style={{ color: spec.color }} aria-hidden />;
    }
    case "badge": {
      const long = spec.text.length > 2;
      return (
        <span
          aria-hidden
          className="inline-flex shrink-0 items-center justify-center rounded-[4px] font-bold leading-none tracking-tight"
          style={{
            width: size + (long ? 3 : 0),
            height: size - 2,
            background: spec.bg,
            color: spec.fg,
            fontSize: long ? size * 0.42 : size * 0.52,
          }}
        >
          {spec.text}
        </span>
      );
    }
    case "tile": {
      const Icon = spec.icon ? ICON_LIBRARY[spec.icon] ?? ICON_LIBRARY.File : null;
      const text = spec.text ?? "";
      // Mixing toward the text color keeps dark brand colors (C#, Less) readable on dark themes.
      const fg = `color-mix(in oklab, ${spec.color} 78%, var(--text-main))`;
      return (
        <span
          aria-hidden
          className="inline-flex shrink-0 items-center justify-center font-bold leading-none tracking-[-0.04em]"
          style={{
            width: size,
            height: size,
            borderRadius: size * 0.3,
            background: `color-mix(in srgb, ${spec.color} 20%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${spec.color} 26%, transparent)`,
            color: fg,
            fontSize: size * (text.length > 2 ? 0.4 : 0.5),
          }}
        >
          {Icon ? <Icon size={size * 0.66} strokeWidth={2.2} /> : text}
        </span>
      );
    }
    case "emoji":
      return (
        <span aria-hidden className="inline-flex shrink-0 items-center justify-center leading-none" style={{ width: size, height: size, fontSize: size * 0.85 }}>
          {spec.char}
        </span>
      );
    case "img":
      return spec.src ? (
        <img src={spec.src} alt="" aria-hidden draggable={false} className="shrink-0" style={{ width: size, height: size }} />
      ) : (
        <span aria-hidden className="inline-block shrink-0" style={{ width: size, height: size }} />
      );
    case "svg":
      return <SvgIcon markup={spec.markup} color={spec.color} size={size} />;
    case "dot":
      return (
        <span aria-hidden className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
          <span className="rounded-full" style={{ width: size * 0.42, height: size * 0.42, background: spec.color }} />
        </span>
      );
  }
}

/** User-uploaded SVG, sanitised and scaled to the row. */
function SvgIcon({ markup, color, size }: { markup: string; color?: string; size: number }) {
  const clean = useMemo(
    () => DOMPurify.sanitize(markup, { USE_PROFILES: { svg: true, svgFilters: true } }).replace(/<svg\b/, `<svg width="${size}" height="${size}"`),
    [markup, size],
  );
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
      style={{ width: size, height: size, color }}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

/** Icon of a file / folder under the active icon theme and custom rules. */
export const FileIcon = memo(function FileIcon({
  name,
  isDir = false,
  open = false,
  size = 16,
}: {
  name: string;
  isDir?: boolean;
  open?: boolean;
  size?: number;
}) {
  const themeId = useSettings((s) => s.iconTheme);
  const rules = useSettings((s) => s.iconRules);
  // Re-resolves when a VS Code theme's icons finish loading.
  const loaded = useVsIcons((s) => s.version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spec = useMemo(() => resolveIcon(name, isDir, open, themeId, rules), [name, isDir, open, themeId, rules, loaded]);
  return <IconView spec={spec} size={size} />;
});

import { inTauri } from "./backend";
import type { WindowEffect } from "@/stores/settings";

/** Window controls; in a browser they fall back to the Fullscreen API or no-ops. */
async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export const appWindow = {
  async minimize() {
    if (inTauri) await (await win()).minimize();
  },
  async toggleMaximize() {
    if (inTauri) await (await win()).toggleMaximize();
  },
  async close() {
    if (inTauri) await (await win()).close();
  },
  async isMaximized() {
    return inTauri ? (await win()).isMaximized() : false;
  },
  async isFullscreen() {
    return inTauri ? (await win()).isFullscreen() : !!document.fullscreenElement;
  },
  async onResized(cb: () => void): Promise<() => void> {
    if (!inTauri) return () => {};
    return (await win()).onResized(cb);
  },
  async toggleFullscreen() {
    if (!inTauri) {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen().catch(() => {});
      return;
    }
    const w = await win();
    await w.setFullscreen(!(await w.isFullscreen()));
  },
  /** What the OS draws behind the see-through window ("none" clears it). */
  async setEffect(effect: WindowEffect) {
    if (!inTauri) return;
    const { Effect, EffectState } = await import("@tauri-apps/api/window");
    const map: Record<Exclude<WindowEffect, "none">, (typeof Effect)[keyof typeof Effect]> = {
      blur: Effect.Blur,
      acrylic: Effect.Acrylic,
      mica: Effect.Mica,
      vibrancy: Effect.UnderWindowBackground,
      "vibrancy-dark": Effect.HudWindow,
      "vibrancy-sidebar": Effect.Sidebar,
      glass: Effect.LiquidGlassRegular,
    };
    const w = await win();
    if (effect === "none") await w.clearEffects().catch(() => {});
    // Active: keep the effect while the window is in the background too (macOS).
    else await w.setEffects({ effects: [map[effect]], state: EffectState.Active });
  },
  async setTitle(title: string) {
    document.title = title;
    if (inTauri) await (await win()).setTitle(title).catch(() => {});
  },
};

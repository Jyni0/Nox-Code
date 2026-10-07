import { useEffect, useRef, useState } from "react";

type ThumbState = { top: number; height: number; visible: boolean; left: number; width: number; hVisible: boolean };
const EMPTY: ThumbState = { top: 0, height: 0, visible: false, left: 0, width: 0, hVisible: false };

/** Singularity's overlay scrollbar: 6px, no arrows, appears on hover / scroll. */
export function useOverlayThumb(elRef: React.RefObject<HTMLElement | null>) {
  const [thumb, setThumb] = useState<ThumbState>(EMPTY);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let timer: number | undefined;
    let hovering = false;
    const update = (active = false) => {
      const { scrollHeight, clientHeight, scrollTop, scrollWidth, clientWidth, scrollLeft } = el;
      const show = active || hovering;
      const ratio = clientHeight / Math.max(scrollHeight, 1);
      const height = Math.max(ratio * clientHeight, 28);
      const top = ratio >= 1 ? 0 : (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height);
      const hRatio = clientWidth / Math.max(scrollWidth, 1);
      const width = Math.max(hRatio * clientWidth, 28);
      const left = hRatio >= 1 ? 0 : (scrollLeft / (scrollWidth - clientWidth)) * (clientWidth - width);
      setThumb({ top, height, visible: scrollHeight > clientHeight + 1 && show, left, width, hVisible: scrollWidth > clientWidth + 1 && show });
    };
    const onScroll = () => {
      update(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => update(false), 800);
    };
    const onEnter = () => {
      hovering = true;
      update();
    };
    const onLeave = () => {
      hovering = false;
      update();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => update()) : null;
    ro?.observe(el);
    update();
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      ro?.disconnect();
      window.clearTimeout(timer);
    };
  }, [elRef]);
  return thumb;
}

export function Thumb({ thumb }: { thumb: ThumbState }) {
  return (
    <>
      <div className="pointer-events-none absolute right-0 top-0 h-full w-2">
        <div className={`scroll-thumb ${thumb.visible ? "" : "opacity-0"}`} style={{ top: thumb.top, height: thumb.height }} />
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 h-2 w-full">
        <div className={`scroll-thumb scroll-thumb--h ${thumb.hVisible ? "" : "opacity-0"}`} style={{ left: thumb.left, width: thumb.width }} />
      </div>
    </>
  );
}

/** Fills its parent; vertical scroll with the overlay thumb. */
export function ScrollArea({
  children,
  className = "",
  innerClassName = "",
  scrollRef,
  onScroll,
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = scrollRef ?? localRef;
  const thumb = useOverlayThumb(ref);
  return (
    <div className={`relative flex min-h-0 flex-col ${className}`}>
      <div ref={ref as React.RefObject<HTMLDivElement>} onScroll={onScroll} className={`no-native-scrollbar min-h-0 flex-1 overflow-y-auto ${innerClassName}`}>
        {children}
      </div>
      <Thumb thumb={thumb} />
    </div>
  );
}

/**
 * A plain mouse wheel scrolls a horizontal strip (tabs) sideways — no Shift
 * needed. Touchpad swipes that are already sideways keep their native feel.
 */
export function useWheelX(ref: React.RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || el.scrollWidth <= el.clientWidth) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      el.scrollLeft += e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * el.clientWidth : d;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, enabled]);
}

/** You own the overflow classes; the wheel can scroll a one-row strip sideways. */
export function OverlayScroll({
  children,
  className = "",
  wrapperClassName = "",
  innerRef,
  wheelX = false,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  wrapperClassName?: string;
  innerRef?: React.RefObject<HTMLDivElement | null>;
  wheelX?: boolean;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const localRef = useRef<HTMLDivElement>(null);
  const ref = innerRef ?? localRef;
  const thumb = useOverlayThumb(ref);
  useWheelX(ref, wheelX);
  return (
    <div className={"relative " + wrapperClassName}>
      <div ref={ref as React.RefObject<HTMLDivElement>} className={"no-native-scrollbar outline-none " + className} {...rest}>
        {children}
      </div>
      <Thumb thumb={thumb} />
    </div>
  );
}

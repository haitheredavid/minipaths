import { useEffect, useState } from "react";

export interface Viewport {
  width: number;
  height: number;
  isMobile: boolean;
  isTablet: boolean;
}

export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => compute());
  useEffect(() => {
    const onResize = () => setVp(compute());
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  return vp;
}

function compute(): Viewport {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const w: number = g.innerWidth ?? 1024;
  const h: number = g.innerHeight ?? 768;
  return {
    width: w,
    height: h,
    isMobile: w <= 480,
    isTablet: w <= 768,
  };
}

const GRID_SIZE = 20;
const BAR_RESERVE = 80;

/**
 * Fit grid to viewport: zoom = pixels per world unit.
 * Leaves padding so board doesn't hug screen edges.
 */
export function useBoardZoom(gridSize: number = GRID_SIZE): number {
  const { width, height } = useViewport();
  const usableH = Math.max(height - BAR_RESERVE, 200);
  const usableW = Math.max(width, 200);
  const pad = width <= 480 ? 0.92 : 0.88;
  return (Math.min(usableW, usableH) * pad) / gridSize;
}

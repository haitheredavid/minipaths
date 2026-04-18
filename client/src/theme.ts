export const colors = {
  bg: "#0f1923",
  surface: "#1a2632",
  surfaceAlt: "#1b2838",
  border: "#2a3a4a",
  borderSoft: "#1e3044",
  text: "#ccd6e0",
  textMuted: "#8899aa",
  textDim: "#6d7684",
  accent: "#6c5ce7",
  accentHi: "#8b7bff",
  danger: "#ff4444",
  dangerSoft: "#ff7b5c",
  marker: "#ff6b9d",
} as const;

export const space = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  xxl: "32px",
} as const;

export const radius = {
  sm: "4px",
  md: "6px",
  lg: "12px",
} as const;

export const bp = {
  sm: 480,
  md: 768,
  lg: 1024,
} as const;

export const mq = {
  sm: `@media (max-width: ${bp.sm}px)`,
  md: `@media (max-width: ${bp.md}px)`,
  lg: `@media (max-width: ${bp.lg}px)`,
} as const;

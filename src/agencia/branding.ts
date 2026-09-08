/**
 * Whitelabel del panel (Modo Agencia, pieza A). Todo por env var — es un "flag",
 * no toca la base de datos, así layout() sigue siendo síncrono.
 *
 *   AGENCY_NAME          enciende el modo agencia + reemplaza la marca "Forja".
 *   AGENCY_ACCENT        color de acento (#rgb o #rrggbb) — override de tokens CSS.
 *   AGENCY_LOGO_URL      logo del sidebar (solo https).
 *   AGENCY_HIDE_POWERED  "1" esconde el "hecho con Forja" del pie.
 *
 * En modo agencia se apaga el upsell a Forja+ (enlace a horizontesia.com).
 */
import type { Env } from "../env";

export interface Branding {
  agencyMode: boolean;
  name: string;
  accent: string | null; // "#rrggbb" normalizado, o null
  accentSoft: string | null; // "rgba(r,g,b,.08)" derivado, o null
  logoUrl: string | null;
  upsell: boolean; // false en modo agencia
  showPoweredBy: boolean;
}

// "Parla": la marca de agencia de esta instancia (capa intermedia sobre el
// motor Forja). AGENCY_NAME la reemplaza si el dueño revende el bot con otra marca.
const DEFAULT_NAME = "Parla";

function sanitizeName(raw: string): string {
  return raw
    .replace(/[\x00-\x1f<>]/g, "")
    .trim()
    .slice(0, 40)
    .trim();
}

/** "#0af" → "#00aaff", "#0F766E" → "#0f766e"; cualquier otra cosa → null. */
function normalizeHex(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return null;
}

function hexToRgbTuple(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function validHttpsUrl(raw: string): string | null {
  const s = raw.trim();
  if (s.length > 500) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

export function resolveBranding(env: Env | undefined): Branding {
  const rawName = (env?.AGENCY_NAME ?? "").trim();
  const agencyMode = rawName.length > 0;
  const name = agencyMode ? sanitizeName(rawName) || DEFAULT_NAME : DEFAULT_NAME;

  const accent = normalizeHex(env?.AGENCY_ACCENT ?? "");
  const accentSoft = accent
    ? `rgba(${hexToRgbTuple(accent).join(",")},.08)`
    : null;
  const logoUrl = validHttpsUrl(env?.AGENCY_LOGO_URL ?? "");

  return {
    agencyMode,
    name,
    accent,
    accentSoft,
    logoUrl,
    upsell: !agencyMode,
    showPoweredBy: env?.AGENCY_HIDE_POWERED !== "1",
  };
}

/** Override de tokens CSS para el acento de la agencia (va después de GLOBAL_STYLE). */
export function brandingStyle(b: Branding): string {
  if (!b.accent) return "";
  const [r, g, bl] = hexToRgbTuple(b.accent);
  return (
    `<style>/* branding */:root{` +
    `--accent:${b.accent};--accent-2:${b.accent};` +
    `--accent-soft:rgba(${r},${g},${bl},.08)` +
    `}</style>`
  );
}

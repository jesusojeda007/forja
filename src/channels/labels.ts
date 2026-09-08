/**
 * Friendly channel names for the dashboard + detection of which channels are
 * actually configured (env credentials present). Kept separate from shared.ts
 * so dashboard concerns don't touch the adapter contract.
 */
import type { Env } from "../env";

/** channel id (as stored in conversations.channel) → label the owner reads. */
export const CHANNEL_LABELS: Record<string, string> = {
  twilio: "WhatsApp",
  whatsapp: "WhatsApp", // legacy rows
  telegram: "Telegram",
  instagram: "Instagram",
  messenger: "Messenger",
  manychat: "ManyChat",
  zernio: "Zernio",
  kapso: "WhatsApp (Kapso)",
};

export function channelLabel(channel: string | null | undefined): string {
  if (!channel) return "—";
  return CHANNEL_LABELS[channel] ?? channel;
}

// Logos de marca (simple-icons) + color oficial, para mostrar de un vistazo por
// dónde llegó el mensaje. Devuelve un <svg> inline listo para pegar en el HTML.
const CHANNEL_GLYPH: Record<string, { color: string; path: string }> = {
  telegram: {
    color: "#26A5E4",
    path: "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  },
  whatsapp: {
    color: "#25D366",
    path: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z",
  },
  instagram: {
    color: "#E4405F",
    path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z",
  },
  messenger: {
    color: "#0866FF",
    path: "M12 0C5.24 0 0 4.952 0 11.64c0 3.499 1.434 6.521 3.769 8.61a.96.96 0 0 1 .323.683l.065 2.135a.96.96 0 0 0 1.347.85l2.381-1.053a.96.96 0 0 1 .641-.046A13 13 0 0 0 12 23.28c6.76 0 12-4.952 12-11.64S18.76 0 12 0m6.806 7.44c.522-.03.971.567.63 1.094l-4.178 6.457a.707.707 0 0 1-.977.208l-3.87-2.504a.44.44 0 0 0-.49.007l-4.363 3.01c-.637.438-1.415-.317-.995-.966l4.179-6.457a.706.706 0 0 1 .977-.21l3.87 2.505c.15.097.344.094.491-.007l4.362-3.008a.7.7 0 0 1 .364-.13",
  },
};
// Twilio = WhatsApp por debajo.
CHANNEL_GLYPH.twilio = CHANNEL_GLYPH.whatsapp;

/**
 * SVG inline con el logo de la plataforma por donde llegó el mensaje.
 * Para canales sin logo propio (manychat, web, desconocido) devuelve una
 * burbuja de chat gris neutra.
 */
export function channelIcon(channel: string | null | undefined, size = 14): string {
  const g = channel ? CHANNEL_GLYPH[channel] : undefined;
  const title = channelLabel(channel);
  if (g) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${g.color}" aria-label="${title}" role="img" style="flex:none"><title>${title}</title><path d="${g.path}"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="#71717a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="${title}" role="img" style="flex:none"><title>${title}</title><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
}

export interface ConfiguredChannel {
  id: string;
  label: string;
  detail: string;
}

/** Channels with credentials configured — shown in Mi Agente even at 0 traffic. */
export function configuredChannels(env: Env): ConfiguredChannel[] {
  const out: ConfiguredChannel[] = [];
  if (env.TWILIO_ACCOUNT_SID) {
    out.push({ id: "twilio", label: "WhatsApp", detail: "Twilio" });
  }
  if (env.TELEGRAM_BOT_TOKEN) {
    out.push({ id: "telegram", label: "Telegram", detail: "bot oficial" });
  }
  if (env.INSTAGRAM_ACCESS_TOKEN) {
    out.push({ id: "instagram", label: "Instagram", detail: "Meta oficial" });
  }
  if (env.META_PAGE_ACCESS_TOKEN) {
    out.push({ id: "messenger", label: "Messenger", detail: "Meta oficial" });
  }
  if (env.MANYCHAT_API_KEY) {
    out.push({ id: "manychat", label: "ManyChat", detail: "IG/FB vía ManyChat" });
  }
  if (env.ZERNIO_API_KEY) {
    out.push({ id: "zernio", label: "Zernio", detail: "bandeja unificada" });
  }
  if (env.KAPSO_API_KEY) {
    out.push({ id: "kapso", label: "WhatsApp", detail: "vía Kapso" });
  }
  return out;
}

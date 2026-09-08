import { Db } from "./client";

// Canonical setting keys. Every value is stored as TEXT; the loader parses.
// Empty/absent => default (see settings-loader.ts).
export const SETTING_KEYS = {
  systemPromptOverride: "system_prompt_override",
  // Reglas del dueño que se SUMAN al prompt generado; NO lo reemplazan (eso es
  // system_prompt_override). Es el campo seguro para "siempre ofrece agendar
  // cita" sin perder el contexto del negocio, el playbook ni el KB.
  customInstructions: "custom_instructions",
  businessContext: "business_context",
  botName: "bot_name",
  tone: "tone",
  bufferSeconds: "buffer_seconds",
  maxChunks: "max_chunks",
  interChunkDelayMs: "inter_chunk_delay_ms",
  escalationKeywords: "escalation_keywords",
  modelOverride: "model_override", // auto | haiku | sonnet
  botPaused: "bot_paused", // 0 | 1
  disabledTools: "disabled_tools", // comma-separated tool names turned off from the dashboard
  temperature: "temperature", // LLM sampling temperature 0-1; empty = provider default
  monthlyBudget: "monthly_budget", // USD cap for monthly AI spend; empty = no cap
  learnedLessons: "learned_lessons", // JSON array of rules distilled from owner takeovers
  twilioHandoffContentSid: "twilio_handoff_content_sid", // HSM del aviso de handoff (fallback del secret)
  autonomyLevel: "autonomy_level", // flywheel: manual (default) | copilot (auto-aplica lo seguro de noche)
  // Blindaje anti-invento (superpoder): "" / "off" (default) | "on". Con "on" el
  // prompt lleva un bloque estricto y, tras generar, un chequeo de fundamento
  // verifica que la respuesta se apoye en el contexto del negocio o la KB antes
  // de enviarla. Ver src/llm/blindajeCheck.ts.
  blindaje: "blindaje",
  // Recupera no-shows (superpoder): "" / "off" (default) | "on". Con "on", un
  // trabajo nocturno manda un recordatorio la noche anterior a cada cita y, si
  // el cliente no dio señales tras la hora de la cita, un mensaje de
  // recuperación. Ver src/noshows/run.ts.
  noshows: "noshows",
  // Reportes automáticos (superpoder): "" / "off" (default) | "semanal" (los
  // lunes) | "diario". Un resumen del período al dueño por Telegram + email.
  // Ver src/reportes/run.ts.
  reportes: "reportes",
  // Galería (superpoder): "" / "off" (default) | "on". Con "on", el bot puede
  // llamar la tool sendGalleryItem para mandar fotos/videos/audios reales del
  // negocio. Los items se cargan por agente/CLI (skill/galeria.md). Ver
  // src/galeria/.
  galeria: "galeria",
  // Cazador de ventas (superpoder): "" / "off" (default) | "on". Con "on", tras
  // cada turno se puntúa el calor del lead y, si cruza a caliente, se le avisa
  // al dueño en el momento. Ver src/cazador/.
  cazador: "cazador",
  // Encuestas de satisfacción (superpoder): "" / "off" (default) | "auto". Con
  // "auto", un trabajo nocturno le manda una encuesta corta (nota 1-5) a cada
  // conversación cerrada y la respuesta del cliente se captura en vivo. Nota
  // baja avisa al dueño. Ver src/encuestas/.
  encuestas: "encuestas",
  // BYO-LLM (dashboard "Modelo de IA"): the owner plugs their own provider,
  // API key and/or concrete model. Empty = the instance's env defaults.
  llmProvider: "llm_provider", // "" (auto) | anthropic | openai
  llmApiKey: "llm_api_key", // owner's API key; empty = use the env key
  llmModel: "llm_model", // concrete model id; empty = auto tiers (fast⇄smart)
  // Pagos por QR (Bolivia y similar): URL pública de la imagen del QR del
  // negocio (se sirve desde el propio Worker o donde la suba el dueño) y las
  // instrucciones que el bot cita al cobrar. Vacío = la tool no ofrece QR.
  paymentQrUrl: "payment_qr_url",
  paymentInstructions: "payment_instructions",
  // Catálogo por URL: feed público del propio negocio (Shopify products.json,
  // WooCommerce store API o CSV de Google Sheets). Se cachea en D1 con TTL.
  catalogSourceUrl: "catalog_source_url",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

interface SettingRow {
  key: string;
  value: string;
}

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.first<SettingRow>(
      "SELECT value FROM settings WHERE key = ?",
      [key],
    );
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.run(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, Date.now()],
    );
  }

  async all(): Promise<Record<string, string>> {
    const rows = await this.db.all<SettingRow>(
      "SELECT key, value FROM settings",
    );
    const out: Record<string, string> = {};
    for (const row of rows) {
      out[row.key] = row.value;
    }
    return out;
  }
}

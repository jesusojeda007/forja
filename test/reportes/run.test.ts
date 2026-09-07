import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();
vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateTextMock(...a) }));
vi.mock("../../src/llm/provider", () => ({
  createModel: () => ({ provider: "anthropic", modelId: "m-test", model: {}, supportsPromptCache: true }),
}));

const ownerSendMock = vi.fn();
vi.mock("../../src/reportes/deliver", () => ({
  deliverOwnerReport: (...a: unknown[]) => ownerSendMock(...a),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { gatherMetrics, runReport } from "../../src/reportes/run";
import type { Env } from "../../src/env";

let env: Env;
let db: Db;
let convs: ConversationsRepo;
let msgs: MessagesRepo;
let leads: LeadsRepo;
let settings: SettingsRepo;

const H = 60 * 60 * 1000;
const D = 24 * H;
// Un lunes fijo, 03:00 UTC.
const MONDAY = Date.parse("2026-09-07T03:00:00Z");
const TUESDAY = Date.parse("2026-09-08T03:00:00Z");

beforeEach(async () => {
  generateTextMock.mockReset().mockResolvedValue({ text: "Resumen de la semana del bot." });
  ownerSendMock.mockReset().mockResolvedValue(undefined);
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  convs = new ConversationsRepo(db);
  msgs = new MessagesRepo(db);
  leads = new LeadsRepo(db);
  settings = new SettingsRepo(db);
  env = {
    DB: d1,
    BOT_NAME: "Bot",
    BUSINESS_NAME: "Neg",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    OWNER_EMAIL: "dueno@x.com",
    CALCOM_TIMEZONE: "UTC", // las constantes MONDAY/TUESDAY son 03:00 UTC
  } as any;
});

async function seedActivity(atMs: number) {
  const c = await convs.getOrCreate("telegram", "u" + atMs);
  await msgs.append(c.id, "user", "hola", { createdAt: atMs });
  await msgs.append(c.id, "assistant", "hola!", { createdAt: atMs + 1000 });
  const leadId = await leads.create({ conversationId: c.id, channelUserId: "u" + atMs, intent: "quiere cita" });
  await db.run("UPDATE leads SET created_at = ? WHERE id = ?", [atMs, leadId]);
}

describe("gatherMetrics", () => {
  it("cuenta solo la actividad dentro de la ventana", async () => {
    await seedActivity(MONDAY - 2 * D); // dentro (semana)
    await seedActivity(MONDAY - 10 * D); // fuera
    const m = await gatherMetrics(env, MONDAY - 7 * D, MONDAY);
    expect(m.conversations).toBe(1);
    expect(m.newLeads).toBe(1);
    expect(m.assistantMessages).toBe(1);
  });
});

describe("runReport", () => {
  it("off: no hace nada", async () => {
    await settings.set(SETTING_KEYS.reportes, "off");
    const r = await runReport(env, { now: MONDAY });
    expect(r.sent).toBe(false);
    expect(ownerSendMock).not.toHaveBeenCalled();
  });

  it("semanal: dispara en lunes y arma+envía el reporte", async () => {
    await settings.set(SETTING_KEYS.reportes, "semanal");
    await seedActivity(MONDAY - D);
    const r = await runReport(env, { now: MONDAY });
    expect(r.sent).toBe(true);
    expect(ownerSendMock).toHaveBeenCalledTimes(1);
    const [, text] = ownerSendMock.mock.calls[0] as any[];
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("semanal: NO dispara si hoy no es lunes", async () => {
    await settings.set(SETTING_KEYS.reportes, "semanal");
    const r = await runReport(env, { now: TUESDAY });
    expect(r.sent).toBe(false);
    expect(ownerSendMock).not.toHaveBeenCalled();
  });

  it("diario: dispara cualquier día", async () => {
    await settings.set(SETTING_KEYS.reportes, "diario");
    const r = await runReport(env, { now: TUESDAY });
    expect(r.sent).toBe(true);
  });

  it("no se envía dos veces para el mismo período (claim)", async () => {
    await settings.set(SETTING_KEYS.reportes, "semanal");
    await runReport(env, { now: MONDAY });
    ownerSendMock.mockClear();
    const r = await runReport(env, { now: MONDAY + H });
    expect(r.sent).toBe(false);
    expect(ownerSendMock).not.toHaveBeenCalled();
  });

  it("corre aunque el bot esté pausado (es un aviso al dueño)", async () => {
    await settings.set(SETTING_KEYS.reportes, "semanal");
    await settings.set(SETTING_KEYS.botPaused, "1");
    const r = await runReport(env, { now: MONDAY });
    expect(r.sent).toBe(true);
  });

  it("forceCadence + force: envía aunque el setting esté off y no consume la key real", async () => {
    await settings.set(SETTING_KEYS.reportes, "off");
    const r = await runReport(env, { now: MONDAY, force: true, forceCadence: "semanal" });
    expect(r.sent).toBe(true);
    expect(r.periodKey).toMatch(/^test-/);
    // La key semanal real sigue libre → el cron del lunes puede enviar.
    await settings.set(SETTING_KEYS.reportes, "semanal");
    const r2 = await runReport(env, { now: MONDAY });
    expect(r2.sent).toBe(true);
  });

  it("si el modelo falla, usa la plantilla de respaldo y envía igual", async () => {
    await settings.set(SETTING_KEYS.reportes, "diario");
    generateTextMock.mockRejectedValueOnce(new Error("503"));
    const r = await runReport(env, { now: TUESDAY });
    expect(r.sent).toBe(true);
    const [, text] = ownerSendMock.mock.calls[0] as any[];
    expect(text.length).toBeGreaterThan(0);
  });
});

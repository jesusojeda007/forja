import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();
const sendReplyMock = vi.fn();
const deliverMock = vi.fn();

vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateTextMock(...a) }));
vi.mock("../../src/llm/provider", () => ({
  createModel: () => ({ provider: "anthropic", modelId: "m-test", model: {}, supportsPromptCache: true }),
}));
vi.mock("../../src/replies/sender", () => ({
  pickAdapter: () => ({ sendReply: (...a: unknown[]) => sendReplyMock(...a) }),
}));
vi.mock("../../src/reportes/deliver", () => ({
  deliverOwnerReport: (...a: unknown[]) => deliverMock(...a),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { SurveyRepo } from "../../src/db/surveys";
import { runEncuestas, captureSurveyReply } from "../../src/encuestas/run";
import type { Env } from "../../src/env";

let env: Env;
let db: Db;
let convs: ConversationsRepo;
let msgs: MessagesRepo;
let settings: SettingsRepo;
let surveys: SurveyRepo;

const NOW = Date.now();
const H = 60 * 60 * 1000;

beforeEach(async () => {
  generateTextMock.mockReset().mockResolvedValue({ text: "" });
  sendReplyMock.mockReset();
  deliverMock.mockReset().mockResolvedValue(undefined);
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  convs = new ConversationsRepo(db);
  msgs = new MessagesRepo(db);
  settings = new SettingsRepo(db);
  surveys = new SurveyRepo(db);
  env = {
    DB: d1,
    BOT_NAME: "Bot",
    BUSINESS_NAME: "Neg",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    DASHBOARD_BASE_URL: "https://bot.example",
  } as any;
  await settings.set(SETTING_KEYS.encuestas, "auto");
});

async function closedConv(user: string) {
  const c = await convs.getOrCreate("telegram", user);
  await new LeadsRepo(db).create({ conversationId: c.id, channelUserId: user, intent: "x" });
  await convs.touchLastMessage(c.id, NOW - 4 * H);
  return c.id;
}

describe("runEncuestas", () => {
  it("off por default: no hace nada", async () => {
    await settings.set(SETTING_KEYS.encuestas, "off");
    await closedConv("u1");
    const r = await runEncuestas(env, { now: NOW });
    expect(r.sent).toBe(0);
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("manda la encuesta a una conversación cerrada y la marca enviada", async () => {
    const cid = await closedConv("u1");
    const r = await runEncuestas(env, { now: NOW });
    expect(r.sent).toBe(1);
    expect(sendReplyMock).toHaveBeenCalledTimes(1);
    const row = await db.first<any>("SELECT * FROM survey_sends WHERE conversation_id = ?", [cid]);
    expect(row.sent_at).toBeTruthy();
    expect(row.responded_at).toBeNull();
  });

  it("no manda dos veces (segunda corrida = 0)", async () => {
    await closedConv("u1");
    await runEncuestas(env, { now: NOW });
    sendReplyMock.mockClear();
    const r = await runEncuestas(env, { now: NOW + H });
    expect(r.sent).toBe(0);
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("respeta la pausa global", async () => {
    await settings.set(SETTING_KEYS.botPaused, "1");
    await closedConv("u1");
    const r = await runEncuestas(env, { now: NOW });
    expect(r.sent).toBe(0);
  });
});

describe("captureSurveyReply", () => {
  async function pendingSurvey(user = "u1") {
    const c = await convs.getOrCreate("telegram", user);
    await surveys.markSent(c.id, "telegram", user, NOW - H);
    return c.id;
  }

  it("registra la nota, agradece y NO pasa el turno al bot", async () => {
    const cid = await pendingSurvey();
    const handled = await captureSurveyReply(env, cid, "telegram", "u1", "5", { now: NOW });
    expect(handled).toBe(true);
    const row = await db.first<any>("SELECT * FROM survey_sends WHERE conversation_id = ?", [cid]);
    expect(row.rating).toBe(5);
    expect(sendReplyMock).toHaveBeenCalledTimes(1);
    // queda registrada la respuesta del cliente + el agradecimiento
    const m = await msgs.lastN(cid, 10);
    expect(m.some((x) => x.role === "user" && x.content === "5")).toBe(true);
    expect(m.some((x) => x.role === "assistant")).toBe(true);
  });

  it("guarda el texto extra como comentario", async () => {
    const cid = await pendingSurvey();
    await captureSurveyReply(env, cid, "telegram", "u1", "2 porque esperé demasiado", { now: NOW });
    const row = await db.first<any>("SELECT * FROM survey_sends WHERE conversation_id = ?", [cid]);
    expect(row.rating).toBe(2);
    expect(row.comment).toMatch(/esper/i);
  });

  it("nota baja (<=2) avisa al dueño", async () => {
    const cid = await pendingSurvey();
    await captureSurveyReply(env, cid, "telegram", "u1", "1", { now: NOW });
    expect(deliverMock).toHaveBeenCalledTimes(1);
    const [, text] = deliverMock.mock.calls[0] as any[];
    expect(text).toContain("bot.example");
  });

  it("nota alta no avisa al dueño", async () => {
    const cid = await pendingSurvey();
    await captureSurveyReply(env, cid, "telegram", "u1", "5", { now: NOW });
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it("si el mensaje no es una nota, devuelve false (que siga el bot)", async () => {
    const cid = await pendingSurvey();
    const handled = await captureSurveyReply(env, cid, "telegram", "u1", "hola, tengo otra pregunta", { now: NOW });
    expect(handled).toBe(false);
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("sin encuesta pendiente devuelve false", async () => {
    const c = await convs.getOrCreate("telegram", "nada");
    const handled = await captureSurveyReply(env, c.id, "telegram", "nada", "5", { now: NOW });
    expect(handled).toBe(false);
  });

  it("apagado: no captura nada", async () => {
    await settings.set(SETTING_KEYS.encuestas, "off");
    const cid = await pendingSurvey();
    const handled = await captureSurveyReply(env, cid, "telegram", "u1", "5", { now: NOW });
    expect(handled).toBe(false);
  });

  it("no registra dos respuestas para la misma encuesta", async () => {
    const cid = await pendingSurvey();
    await captureSurveyReply(env, cid, "telegram", "u1", "5", { now: NOW });
    sendReplyMock.mockClear();
    const handled = await captureSurveyReply(env, cid, "telegram", "u1", "1", { now: NOW + 1000 });
    expect(handled).toBe(false);
    expect(sendReplyMock).not.toHaveBeenCalled();
  });
});

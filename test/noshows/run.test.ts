import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();
const sendReplyMock = vi.fn();

vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateTextMock(...a) }));
vi.mock("../../src/llm/provider", () => ({
  createModel: () => ({ provider: "anthropic", modelId: "m-test", model: {}, supportsPromptCache: true }),
}));
vi.mock("../../src/replies/sender", () => ({
  pickAdapter: () => ({ sendReply: (...a: unknown[]) => sendReplyMock(...a) }),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { AppointmentsRepo } from "../../src/db/appointments";
import { runNoShows } from "../../src/noshows/run";
import type { Env } from "../../src/env";

let env: Env;
let db: Db;
let convs: ConversationsRepo;
let appts: AppointmentsRepo;
let settings: SettingsRepo;

const NOW = Date.now();
const H = 60 * 60 * 1000;

beforeEach(async () => {
  generateTextMock.mockReset().mockResolvedValue({ text: "mensaje del bot" });
  sendReplyMock.mockReset();
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  convs = new ConversationsRepo(db);
  appts = new AppointmentsRepo(db);
  settings = new SettingsRepo(db);
  env = {
    DB: d1,
    BOT_NAME: "Bot",
    BUSINESS_NAME: "Neg",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "1",
  } as any;
  await settings.set(SETTING_KEYS.noshows, "on");
});

async function apptFor(user: string, startTs: number) {
  const c = await convs.getOrCreate("telegram", user);
  return appts.create({ conversationId: c.id, channel: "telegram", channelUserId: user, service: "Corte", startTs });
}

describe("runNoShows", () => {
  it("apagado por default: no hace nada", async () => {
    await settings.set(SETTING_KEYS.noshows, "off");
    await apptFor("u1", NOW + 24 * H);
    const r = await runNoShows(env, { now: NOW });
    expect(r).toEqual({ remindersSent: 0, recoveriesSent: 0 });
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("recordatorio: manda un mensaje a la cita de mañana y la marca reminded", async () => {
    const id = await apptFor("u1", NOW + 24 * H);
    const r = await runNoShows(env, { now: NOW });
    expect(r.remindersSent).toBe(1);
    expect(sendReplyMock).toHaveBeenCalledTimes(1);
    const row = await db.first<any>("SELECT status FROM appointments WHERE id = ?", [id]);
    expect(row.status).toBe("reminded");
  });

  it("recordatorio: no se manda dos veces (segunda corrida = 0)", async () => {
    await apptFor("u1", NOW + 24 * H);
    await runNoShows(env, { now: NOW });
    sendReplyMock.mockClear();
    const r = await runNoShows(env, { now: NOW + H });
    expect(r.remindersSent).toBe(0);
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("recuperación: no-show silencioso recibe mensaje y queda recovered", async () => {
    const id = await apptFor("u2", NOW - 6 * H);
    const r = await runNoShows(env, { now: NOW });
    expect(r.recoveriesSent).toBe(1);
    const row = await db.first<any>("SELECT status FROM appointments WHERE id = ?", [id]);
    expect(row.status).toBe("recovered");
  });

  it("recuperación: si el cliente escribió tras la cita, no se le molesta", async () => {
    const c = await convs.getOrCreate("telegram", "u3");
    await appts.create({ conversationId: c.id, channel: "telegram", channelUserId: "u3", startTs: NOW - 6 * H });
    await new MessagesRepo(db).append(c.id, "user", "gracias!", { createdAt: NOW - 2 * H });
    const r = await runNoShows(env, { now: NOW });
    expect(r.recoveriesSent).toBe(0);
  });

  it("respeta la pausa global del bot", async () => {
    await settings.set(SETTING_KEYS.botPaused, "1");
    await apptFor("u1", NOW + 24 * H);
    const r = await runNoShows(env, { now: NOW });
    expect(r).toEqual({ remindersSent: 0, recoveriesSent: 0 });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const deliverMock = vi.fn();
vi.mock("../../src/reportes/deliver", () => ({
  deliverOwnerReport: (...a: unknown[]) => deliverMock(...a),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { LeadScoresRepo } from "../../src/db/leadScores";
import { runCazador } from "../../src/cazador/run";
import type { Env } from "../../src/env";

let env: Env;
let db: Db;
let convs: ConversationsRepo;
let msgs: MessagesRepo;
let scores: LeadScoresRepo;
let settings: SettingsRepo;

const NOW = Date.now();

beforeEach(async () => {
  deliverMock.mockReset().mockResolvedValue(undefined);
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  convs = new ConversationsRepo(db);
  msgs = new MessagesRepo(db);
  scores = new LeadScoresRepo(db);
  settings = new SettingsRepo(db);
  env = {
    DB: d1,
    BOT_NAME: "Bot",
    BUSINESS_NAME: "Neg",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    DASHBOARD_BASE_URL: "https://bot.example",
  } as any;
  await settings.set(SETTING_KEYS.cazador, "on");
});

async function convWith(userMsgs: string[]) {
  const c = await convs.getOrCreate("telegram", "u" + Math.random());
  for (const t of userMsgs) await msgs.append(c.id, "user", t, {});
  return c.id;
}

describe("runCazador", () => {
  it("off: no hace nada", async () => {
    await settings.set(SETTING_KEYS.cazador, "off");
    const cid = await convWith(["quiero comprar, ¿cuánto cuesta?"]);
    const r = await runCazador(env, cid, { now: NOW });
    expect(r.alerted).toBe(false);
    expect(await scores.get(cid)).toBeNull();
  });

  it("guarda el score de cada conversación aunque esté frío", async () => {
    const cid = await convWith(["¿a qué hora abren?"]);
    await runCazador(env, cid, { now: NOW });
    const row = await scores.get(cid);
    expect(row?.band).toBe("frio");
  });

  it("al cruzar a caliente avisa al dueño una vez y marca alerted_at", async () => {
    const cid = await convWith(["¿cuánto cuesta?", "lo quiero", "¿me lo apartas?", "sí para mañana"]);
    const r = await runCazador(env, cid, { now: NOW });
    expect(r.alerted).toBe(true);
    expect(deliverMock).toHaveBeenCalledTimes(1);
    const [, text] = deliverMock.mock.calls[0] as any[];
    expect(text).toMatch(/precio|cuesta/i);
    expect(text).toContain("bot.example");

    deliverMock.mockClear();
    await runCazador(env, cid, { now: NOW + 60_000 });
    expect(deliverMock).not.toHaveBeenCalled(); // ya se avisó este episodio
  });

  it("re-avisa si vuelve a estar caliente después de varios días", async () => {
    const cid = await convWith(["¿precio?", "lo quiero ya", "apartar", "urgente hoy"]);
    await runCazador(env, cid, { now: NOW });
    deliverMock.mockClear();
    await msgs.append(cid, "user", "sigo interesado, ¿cuánto cuesta?", {});
    await runCazador(env, cid, { now: NOW + 4 * 24 * 60 * 60 * 1000 });
    expect(deliverMock).toHaveBeenCalledTimes(1);
  });

  it("cuenta el lead capturado como señal fuerte", async () => {
    const cid = await convWith(["me interesa"]);
    await new LeadsRepo(db).create({ conversationId: cid, channelUserId: "x", intent: "interesado" });
    const r = await runCazador(env, cid, { now: NOW });
    const row = await scores.get(cid);
    expect(row!.score).toBeGreaterThanOrEqual(25);
  });
});

describe("LeadScoresRepo.topOpen", () => {
  it("devuelve los leads abiertos ordenados por score desc", async () => {
    const a = await convs.getOrCreate("telegram", "a");
    const b = await convs.getOrCreate("telegram", "b");
    await scores.upsert(a.id, { score: 40, band: "tibio", reason: "x", scoredAt: NOW });
    await scores.upsert(b.id, { score: 80, band: "muy_caliente", reason: "y", scoredAt: NOW });
    const top = await scores.topOpen(10);
    expect(top.map((t) => t.conversation_id)).toEqual([b.id, a.id]);
  });
});

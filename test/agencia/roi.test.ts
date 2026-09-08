import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import { AppointmentsRepo } from "../../src/db/appointments";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { computeRoi } from "../../src/agencia/roi";
import type { Env } from "../../src/env";

let env: Env;
let db: Db;
let convs: ConversationsRepo;
let msgs: MessagesRepo;
let settings: SettingsRepo;

const NOW = Date.now();
const D = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  convs = new ConversationsRepo(db);
  msgs = new MessagesRepo(db);
  settings = new SettingsRepo(db);
  env = { DB: d1, BOT_NAME: "Bot", BUSINESS_NAME: "Neg", BOT_LANGUAGE: "es", BOT_TIER: "pro" } as any;
});

async function seed({ assistant = 0, leads = 0, recovered = 0 }: { assistant?: number; leads?: number; recovered?: number }) {
  const c = await convs.getOrCreate("telegram", "u1");
  for (let i = 0; i < assistant; i++) await msgs.append(c.id, "assistant", "r", { createdAt: NOW - 2 * D });
  const lr = new LeadsRepo(db);
  for (let i = 0; i < leads; i++) {
    const id = await lr.create({ conversationId: c.id, channelUserId: "u1", intent: "x" });
    await db.run("UPDATE leads SET created_at = ? WHERE id = ?", [NOW - 2 * D, id]);
  }
  const ar = new AppointmentsRepo(db);
  for (let i = 0; i < recovered; i++) {
    const id = await ar.create({ conversationId: c.id, channel: "telegram", channelUserId: "u1", startTs: NOW - 3 * D });
    await ar.markRecovered(id, NOW - 1 * D);
  }
  return c.id;
}

describe("computeRoi", () => {
  it("traduce respuestas a horas y plata con los defaults", async () => {
    await seed({ assistant: 300, leads: 5 }); // 300*2/60 = 10 h
    const roi = await computeRoi(env, { now: NOW, days: 30 });
    expect(roi.hoursSaved).toBe(10);
    expect(roi.laborSaved).toBe(80); // 10 h * 8 (default)
    expect(roi.moneySaved).toBe(80);
    expect(roi.leads).toBe(5);
    expect(roi.currency).toBe("USD");
    expect(roi.roiMultiple).toBeNull();
  });

  it("suma el valor de los no-shows recuperados si se configuró", async () => {
    await seed({ assistant: 60, recovered: 3 }); // 2 h
    await settings.set(SETTING_KEYS.roiHourlyRate, "10");
    await settings.set(SETTING_KEYS.roiNoShowValue, "25");
    const roi = await computeRoi(env, { now: NOW, days: 30 });
    expect(roi.laborSaved).toBe(20); // 2 h * 10
    expect(roi.noShowMoney).toBe(75); // 3 * 25
    expect(roi.moneySaved).toBe(95);
  });

  it("calcula el múltiplo contra la mensualidad de la agencia", async () => {
    await seed({ assistant: 300 }); // 10 h -> $80 con default
    await settings.set(SETTING_KEYS.roiMonthlyFee, "40");
    const roi = await computeRoi(env, { now: NOW, days: 30 });
    expect(roi.monthlyFee).toBe(40);
    expect(roi.roiMultiple).toBeCloseTo(2, 5); // 80 / 40
  });

  it("valores basura en settings caen a los defaults", async () => {
    await seed({ assistant: 60 });
    await settings.set(SETTING_KEYS.roiHourlyRate, "abc");
    await settings.set(SETTING_KEYS.roiCurrency, "");
    const roi = await computeRoi(env, { now: NOW, days: 30 });
    expect(roi.laborSaved).toBe(16); // 2 h * 8 default
    expect(roi.currency).toBe("USD");
  });

  it("normaliza el múltiplo cuando el período no son 30 días", async () => {
    await seed({ assistant: 300 }); // en 7 días: 10 h -> $80
    await settings.set(SETTING_KEYS.roiMonthlyFee, "40");
    const roi = await computeRoi(env, { now: NOW, days: 7 });
    // $80 en 7 días ≈ $342.8/mes ; /40 ≈ 8.57
    expect(roi.roiMultiple).toBeGreaterThan(8);
    expect(roi.roiMultiple).toBeLessThan(9);
  });
});

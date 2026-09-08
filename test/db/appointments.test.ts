import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { AppointmentsRepo } from "../../src/db/appointments";

let db: Db;
let repo: AppointmentsRepo;
let convs: ConversationsRepo;
let msgs: MessagesRepo;

const NOW = Date.now();
const H = 60 * 60 * 1000;
const D = 24 * H;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  db = new Db((await mf.getD1Database("DB")) as any);
  repo = new AppointmentsRepo(db);
  convs = new ConversationsRepo(db);
  msgs = new MessagesRepo(db);
});

async function conv(channel = "telegram", user = "u1") {
  const c = await convs.getOrCreate(channel, user);
  return c.id;
}

describe("AppointmentsRepo.create", () => {
  it("guarda la cita con status booked", async () => {
    const cid = await conv();
    const id = await repo.create({
      conversationId: cid,
      channel: "telegram",
      channelUserId: "u1",
      service: "Corte",
      attendeeName: "Ana",
      startTs: NOW + 2 * D,
      bookingId: "cal_1",
    });
    const row = await db.first<any>("SELECT * FROM appointments WHERE id = ?", [id]);
    expect(row.status).toBe("booked");
    expect(row.service).toBe("Corte");
    expect(row.start_ts).toBe(NOW + 2 * D);
  });
});

describe("AppointmentsRepo.pickForReminder", () => {
  it("trae las citas booked dentro de la ventana [+18h, +42h]", async () => {
    const cid = await conv();
    const dentro = await repo.create({ conversationId: cid, channel: "telegram", channelUserId: "u1", startTs: NOW + 24 * H });
    await repo.create({ conversationId: cid, channel: "telegram", channelUserId: "u1", startTs: NOW + 6 * H }); // muy pronto
    await repo.create({ conversationId: cid, channel: "telegram", channelUserId: "u1", startTs: NOW + 5 * D }); // muy lejos

    const picked = await repo.pickForReminder(NOW, 10);
    expect(picked.map((p) => p.id)).toEqual([dentro]);
  });

  it("no trae las que ya tienen status reminded/recovered", async () => {
    const cid = await conv();
    const a = await repo.create({ conversationId: cid, channel: "telegram", channelUserId: "u1", startTs: NOW + 24 * H });
    await repo.markReminded(a, NOW);
    expect(await repo.pickForReminder(NOW, 10)).toHaveLength(0);
  });

  it("excluye conversaciones pausadas y el canal instagram", async () => {
    const paused = await conv("telegram", "pausado");
    await convs.setPausedUntil(paused, NOW + D);
    await repo.create({ conversationId: paused, channel: "telegram", channelUserId: "pausado", startTs: NOW + 24 * H });

    const ig = await conv("instagram", "ig1");
    await repo.create({ conversationId: ig, channel: "instagram", channelUserId: "ig1", startTs: NOW + 24 * H });

    expect(await repo.pickForReminder(NOW, 10)).toHaveLength(0);
  });
});

describe("AppointmentsRepo.pickForRecovery", () => {
  it("trae citas pasadas (entre 3h y 3d) sin mensajes del cliente tras la cita", async () => {
    const cid = await conv();
    const noShow = await repo.create({ conversationId: cid, channel: "telegram", channelUserId: "u1", startTs: NOW - 6 * H });
    const picked = await repo.pickForRecovery(NOW, 10);
    expect(picked.map((p) => p.id)).toEqual([noShow]);
  });

  it("NO trae la cita si el cliente escribió después de la hora de la cita", async () => {
    const cid = await conv("telegram", "vino");
    await repo.create({ conversationId: cid, channel: "telegram", channelUserId: "vino", startTs: NOW - 6 * H });
    await msgs.append(cid, "user", "¡todo bien, gracias!", { createdAt: NOW - 1 * H });
    expect(await repo.pickForRecovery(NOW, 10)).toHaveLength(0);
  });

  it("NO trae citas futuras ni las de hace más de 3 días", async () => {
    const cid = await conv();
    await repo.create({ conversationId: cid, channel: "telegram", channelUserId: "u1", startTs: NOW + 2 * H });
    await repo.create({ conversationId: cid, channel: "telegram", channelUserId: "u1", startTs: NOW - 5 * D });
    expect(await repo.pickForRecovery(NOW, 10)).toHaveLength(0);
  });

  it("recovered ya no se vuelve a traer", async () => {
    const cid = await conv();
    const a = await repo.create({ conversationId: cid, channel: "telegram", channelUserId: "u1", startTs: NOW - 6 * H });
    await repo.markRecovered(a, NOW);
    expect(await repo.pickForRecovery(NOW, 10)).toHaveLength(0);
  });
});

describe("AppointmentsRepo claims", () => {
  it("markReminded es un candado: solo la primera corrida gana", async () => {
    const cid = await conv();
    const a = await repo.create({ conversationId: cid, channel: "telegram", channelUserId: "u1", startTs: NOW + 24 * H });
    expect(await repo.markReminded(a, NOW)).toBe(true);
    expect(await repo.markReminded(a, NOW)).toBe(false);
  });

  it("markRecovered gana desde booked o reminded, una sola vez", async () => {
    const cid = await conv();
    const a = await repo.create({ conversationId: cid, channel: "telegram", channelUserId: "u1", startTs: NOW - 6 * H });
    expect(await repo.markRecovered(a, NOW)).toBe(true);
    expect(await repo.markRecovered(a, NOW)).toBe(false);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { LeadsRepo } from "../../src/db/leads";
import { AppointmentsRepo } from "../../src/db/appointments";
import { SurveyRepo } from "../../src/db/surveys";

let db: Db;
let repo: SurveyRepo;
let convs: ConversationsRepo;
let msgs: MessagesRepo;

const NOW = Date.now();
const H = 60 * 60 * 1000;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  db = new Db((await mf.getD1Database("DB")) as any);
  repo = new SurveyRepo(db);
  convs = new ConversationsRepo(db);
  msgs = new MessagesRepo(db);
});

async function conv(user = "u1", channel = "telegram") {
  const c = await convs.getOrCreate(channel, user);
  return c.id;
}

describe("SurveyRepo.pickForSend", () => {
  it("trae conversaciones quietas (2-24h) con lead y sin encuesta previa", async () => {
    const cid = await conv();
    await new LeadsRepo(db).create({ conversationId: cid, channelUserId: "u1", intent: "x" });
    await convs.touchLastMessage(cid, NOW - 4 * H);

    const picked = await repo.pickForSend(NOW, 10);
    expect(picked.map((p) => p.id)).toEqual([cid]);
  });

  it("acepta cita o ticket resuelto como señal de cierre", async () => {
    const withAppt = await conv("appt");
    await new AppointmentsRepo(db).create({
      conversationId: withAppt,
      channel: "telegram",
      channelUserId: "appt",
      startTs: NOW + 24 * H,
    });
    await convs.touchLastMessage(withAppt, NOW - 4 * H);

    const withTicket = await conv("tic");
    await db.run(
      "INSERT INTO tickets (id, conversation_id, summary, transcript, status, created_at) VALUES (?, ?, ?, ?, 'resolved', ?)",
      ["t1", withTicket, "s", "t", NOW - 5 * H],
    );
    await convs.touchLastMessage(withTicket, NOW - 4 * H);

    const ids = (await repo.pickForSend(NOW, 10)).map((p) => p.id).sort();
    expect(ids).toEqual([withAppt, withTicket].sort());
  });

  it("excluye: muy reciente, muy vieja, pausada, canal instagram, sin señal de cierre", async () => {
    const reciente = await conv("reciente");
    await new LeadsRepo(db).create({ conversationId: reciente, channelUserId: "reciente", intent: "x" });
    await convs.touchLastMessage(reciente, NOW - 30 * 60 * 1000);

    const vieja = await conv("vieja");
    await new LeadsRepo(db).create({ conversationId: vieja, channelUserId: "vieja", intent: "x" });
    await convs.touchLastMessage(vieja, NOW - 40 * H);

    const pausada = await conv("pausada");
    await new LeadsRepo(db).create({ conversationId: pausada, channelUserId: "pausada", intent: "x" });
    await convs.touchLastMessage(pausada, NOW - 4 * H);
    await convs.setPausedUntil(pausada, NOW + H);

    const ig = await conv("ig", "instagram");
    await new LeadsRepo(db).create({ conversationId: ig, channelUserId: "ig", intent: "x" });
    await convs.touchLastMessage(ig, NOW - 4 * H);

    const sinSenal = await conv("sinsenal");
    await convs.touchLastMessage(sinSenal, NOW - 4 * H);

    expect(await repo.pickForSend(NOW, 10)).toHaveLength(0);
  });

  it("no re-encuesta una conversación que ya tiene fila en survey_sends", async () => {
    const cid = await conv();
    await new LeadsRepo(db).create({ conversationId: cid, channelUserId: "u1", intent: "x" });
    await convs.touchLastMessage(cid, NOW - 4 * H);
    await repo.markSent(cid, "telegram", "u1", NOW);
    expect(await repo.pickForSend(NOW, 10)).toHaveLength(0);
  });
});

describe("SurveyRepo.markSent (candado)", () => {
  it("solo la primera vez inserta", async () => {
    const cid = await conv();
    expect(await repo.markSent(cid, "telegram", "u1", NOW)).toBe(true);
    expect(await repo.markSent(cid, "telegram", "u1", NOW)).toBe(false);
  });
});

describe("SurveyRepo.pending / recordResponse", () => {
  it("pending devuelve la encuesta enviada sin responder dentro de la ventana", async () => {
    const cid = await conv();
    await repo.markSent(cid, "telegram", "u1", NOW);
    expect((await repo.pending(cid, NOW))?.conversation_id).toBe(cid);
  });

  it("pending es null si ya venció la ventana o ya respondió", async () => {
    const viejo = await conv("viejo");
    await repo.markSent(viejo, "telegram", "viejo", NOW - 5 * 24 * H);
    expect(await repo.pending(viejo, NOW)).toBeNull();

    const resp = await conv("resp");
    await repo.markSent(resp, "telegram", "resp", NOW - H);
    await repo.recordResponse(resp, 5, "", NOW);
    expect(await repo.pending(resp, NOW)).toBeNull();
  });

  it("recordResponse guarda nota + comentario una sola vez", async () => {
    const cid = await conv();
    await repo.markSent(cid, "telegram", "u1", NOW);
    expect(await repo.recordResponse(cid, 4, "todo bien", NOW)).toBe(true);
    expect(await repo.recordResponse(cid, 1, "cambio", NOW + 1000)).toBe(false);
    const row = await db.first<any>("SELECT * FROM survey_sends WHERE conversation_id = ?", [cid]);
    expect(row.rating).toBe(4);
    expect(row.comment).toBe("todo bien");
  });
});

describe("SurveyRepo.stats / recentComments", () => {
  beforeEach(async () => {
    const rows: [string, number, string][] = [
      ["a", 5, "excelente"],
      ["b", 4, ""],
      ["c", 2, "esperé mucho"],
      ["d", 1, "nadie contestó"],
    ];
    for (let i = 0; i < rows.length; i++) {
      const [u, r, c] = rows[i];
      const cid = await conv(u);
      await repo.markSent(cid, "telegram", u, NOW - 2 * H);
      await repo.recordResponse(cid, r, c, NOW - H + i * 1000);
    }
    // una sin responder no cuenta
    const pend = await conv("pend");
    await repo.markSent(pend, "telegram", "pend", NOW - H);
  });

  it("stats: promedio, n, detractores", async () => {
    const s = await repo.stats(NOW - 24 * H);
    expect(s.n).toBe(4);
    expect(s.avg).toBeCloseTo(3, 5);
    expect(s.detractors).toBe(2);
  });

  it("recentComments: solo con comentario, más nuevo primero", async () => {
    const c = await repo.recentComments(10);
    expect(c.map((x) => x.comment)).toEqual(["nadie contestó", "esperé mucho", "excelente"]);
  });
});

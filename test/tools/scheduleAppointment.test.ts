import { afterEach, describe, it, expect, vi } from "vitest";
import { scheduleAppointmentTool } from "../../src/tools/scheduleAppointment";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// El tool ya no recibe eventTypeId del modelo: se resuelve del env
// (CALCOM_EVENT_TYPE_ID / CALCOM_EVENT_TYPES) y llama Cal.com API v2.
describe("scheduleAppointmentTool", () => {
  const baseEnv = { CALCOM_API_KEY: "fake", CALCOM_EVENT_TYPE_ID: "100", BOT_TIER: "pro" } as any;

  it("creates Cal.com booking via API v2 with server-resolved eventTypeId", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: 12345, status: "accepted" } }), { status: 201 }),
    );
    global.fetch = fetchMock as any;
    const tool = scheduleAppointmentTool(baseEnv, () => "conv_x");
    const result = (await tool.execute!(
      {
        startTime: "2027-06-01T17:00:00-06:00",
        attendeeName: "María",
        attendeeEmail: "maria@x.com",
      },
      {} as any,
    )) as { booked: boolean; bookingId: number };
    expect(result.booked).toBe(true);
    expect(result.bookingId).toBe(12345);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v2/bookings");
    const body = JSON.parse(String(init.body));
    expect(body.eventTypeId).toBe(100);
    expect(body.attendee.email).toBe("maria@x.com");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fake");
  });

  it("lists available slots when only date is given", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { "2027-06-01": [{ start: "2027-06-01T15:00:00-06:00" }] } }),
          { status: 200 },
        ),
    ) as any;
    const tool = scheduleAppointmentTool(baseEnv, () => "conv_x");
    const result = (await tool.execute!({ date: "2027-06-01" }, {} as any)) as {
      slots: string[];
    };
    expect(result.slots).toEqual(["2027-06-01T15:00:00-06:00"]);
  });

  it("returns error when Cal.com fails", async () => {
    global.fetch = vi.fn(async () => new Response("err", { status: 400 })) as any;
    const tool = scheduleAppointmentTool(baseEnv, () => "conv_x");
    const result = (await tool.execute!(
      {
        startTime: "2027-06-01T17:00:00-06:00",
        attendeeName: "María",
        attendeeEmail: "maria@x.com",
      },
      {} as any,
    )) as { error: string; reason: string };
    expect(result.error).toBe("calcom_failed");
    expect(result.reason).toBe("http_400");
  });

  it("rejects past dates without calling Cal.com", async () => {
    global.fetch = vi.fn() as any;
    const tool = scheduleAppointmentTool(baseEnv, () => "conv_x");
    const result = (await tool.execute!({ date: "2023-10-04" }, {} as any)) as {
      error: string;
      today: string;
    };
    expect(result.error).toBe("date_in_past");
    expect(result.today > "2023-10-04").toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns calcom_not_configured when no API key", async () => {
    global.fetch = vi.fn() as any;
    const env = { CALCOM_EVENT_TYPE_ID: "100", BOT_TIER: "pro" } as any;
    const tool = scheduleAppointmentTool(env, () => "conv_x");
    const result = (await tool.execute!(
      { startTime: "2027-06-01T17:00:00-06:00", attendeeName: "María", attendeeEmail: "maria@x.com" },
      {} as any,
    )) as { error: string };
    expect(result.error).toBe("calcom_not_configured");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("resuelve 'el próximo martes' en Europe/Madrid al martes 2026-09-01", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T15:00:00.000Z"));
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { "2026-09-01": [{ start: "2026-09-01T10:00:00+02:00" }] } }),
          { status: 200 },
        ),
    );
    global.fetch = fetchMock as any;
    const env = { ...baseEnv, CALCOM_TIMEZONE: "Europe/Madrid", BOT_LANGUAGE: "es" };
    const tool = scheduleAppointmentTool(env, () => "conv_x");
    const result = (await tool.execute!({ date: "el próximo martes a las 10" }, {} as any)) as {
      date: string;
      weekday: string;
      slots: string[];
    };
    expect(result.date).toBe("2026-09-01");
    expect(result.weekday).toBe("martes");
    expect(result.slots[0]).toContain("2026-09-01");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("start=2026-09-01");
  });

  it("un ISO mal contado no pisa las palabras del cliente al reservar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T15:00:00.000Z"));
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { id: 99, status: "accepted" } }), { status: 201 }),
    );
    global.fetch = fetchMock as any;
    const env = { ...baseEnv, CALCOM_TIMEZONE: "Europe/Madrid" };
    const tool = scheduleAppointmentTool(env, () => "conv_x");
    const result = (await tool.execute!(
      {
        date: "el próximo martes 2026-09-02",
        startTime: "2026-09-02T10:00:00+02:00",
        attendeeName: "Ana",
        attendeeEmail: "ana@x.com",
      },
      {} as any,
    )) as { booked: boolean; start: string; weekday: string; date: string };
    expect(result.booked).toBe(true);
    expect(result.date).toBe("2026-09-01");
    expect(result.weekday).toBe("martes");
    expect(result.start).toBe("2026-09-01T10:00:00+02:00");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.start).toBe("2026-09-01T10:00:00+02:00");
  });

  it("returns calcom_not_configured when no event type is configured", async () => {
    global.fetch = vi.fn() as any;
    const env = { CALCOM_API_KEY: "fake", BOT_TIER: "pro" } as any;
    const tool = scheduleAppointmentTool(env, () => "conv_x");
    const result = (await tool.execute!(
      { startTime: "2027-06-01T17:00:00-06:00", attendeeName: "María", attendeeEmail: "maria@x.com" },
      {} as any,
    )) as { error: string };
    expect(result.error).toBe("calcom_not_configured");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("scheduleAppointmentTool — persistencia local para no-shows", () => {
  it("al reservar OK, guarda la cita en la tabla appointments con canal/usuario", async () => {
    const mf = await createTestMiniflare();
    const d1 = await mf.getD1Database("DB");
    const db = new Db(d1 as any);
    const conv = await new ConversationsRepo(db).getOrCreate("telegram", "u9");

    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: { id: "bk_9", status: "accepted", start: "2027-06-01T17:00:00.000Z" } }),
          { status: 201 },
        ),
    ) as any;

    const env = { CALCOM_API_KEY: "fake", CALCOM_EVENT_TYPE_ID: "100", BOT_TIER: "pro", DB: d1 } as any;
    const tool = scheduleAppointmentTool(
      env,
      () => conv.id,
      () => "telegram",
      () => "u9",
    );
    const result = (await tool.execute!(
      {
        startTime: "2027-06-01T17:00:00-06:00",
        attendeeName: "Nadia",
        attendeeEmail: "nadia@x.com",
        service: "Corte",
      },
      {} as any,
    )) as { booked: boolean };
    expect(result.booked).toBe(true);

    const row = await db.first<any>(
      "SELECT * FROM appointments WHERE conversation_id = ?",
      [conv.id],
    );
    expect(row).toBeTruthy();
    expect(row.channel).toBe("telegram");
    expect(row.channel_user_id).toBe("u9");
    expect(row.service).toBe("Corte");
    expect(row.attendee_name).toBe("Nadia");
    expect(row.booking_id).toBe("bk_9");
    expect(row.status).toBe("booked");
  });

  it("sin DB o sin canal, no truena (solo reserva)", async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: { id: 1, status: "accepted" } }), { status: 201 }),
    ) as any;
    const env = { CALCOM_API_KEY: "fake", CALCOM_EVENT_TYPE_ID: "100", BOT_TIER: "pro" } as any;
    const tool = scheduleAppointmentTool(env, () => "conv_x");
    const result = (await tool.execute!(
      { startTime: "2027-06-01T17:00:00-06:00", attendeeName: "X", attendeeEmail: "x@x.com" },
      {} as any,
    )) as { booked: boolean };
    expect(result.booked).toBe(true);
  });
});

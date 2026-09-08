import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { telegramAdapter, resolveTelegramFileUrl } from "../../src/channels/telegram";
import type { Env } from "../../src/env";

function makeReq(body: unknown): Request {
  return new Request("https://bot.test/webhooks/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const env = { TELEGRAM_BOT_TOKEN: "test-token" } as Env;

// Telegram media (voice/photo) is NOT directly addressable by file_id — the
// adapter must call getFile to obtain a file_path, then build the download URL.
// So media tests mock fetch to stand in for that getFile call.
function mockGetFile(filePath: string) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true, result: { file_path: filePath } }), {
      status: 200,
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("telegramAdapter.parseIncoming", () => {
  it("parses a text message (no fetch needed)", async () => {
    const msg = await telegramAdapter.parseIncoming(
      makeReq({
        update_id: 1,
        message: {
          message_id: 10,
          from: { id: 555, first_name: "Ana", is_bot: false },
          chat: { id: 555, type: "private" },
          date: 100,
          text: "hola",
        },
      }),
      env,
    );
    expect(msg.channel).toBe("telegram");
    expect(msg.channelUserId).toBe("555");
    expect(msg.text).toBe("hola");
    expect(msg.displayName).toBe("Ana");
  });

  it("resolves voice notes to a real download URL via getFile", async () => {
    mockGetFile("voice/file_5.oga");
    const msg = await telegramAdapter.parseIncoming(
      makeReq({
        update_id: 2,
        message: {
          message_id: 11,
          from: { id: 555, first_name: "Ana", is_bot: false },
          chat: { id: 555, type: "private" },
          date: 100,
          voice: { file_id: "voice-abc", duration: 5 },
        },
      }),
      env,
    );
    // The resolved URL is the downloadable HTTPS path, not the raw file_id.
    expect(msg.audioUrl).toBe(
      "https://api.telegram.org/file/bottest-token/voice/file_5.oga",
    );
  });

  it("resolves photos to a real download URL + uses caption as text", async () => {
    mockGetFile("photos/file_9.jpg");
    const msg = await telegramAdapter.parseIncoming(
      makeReq({
        update_id: 3,
        message: {
          message_id: 12,
          from: { id: 555, first_name: "Ana", is_bot: false },
          chat: { id: 555, type: "private" },
          date: 100,
          photo: [
            { file_id: "photo-small", width: 90, height: 90 },
            { file_id: "photo-large", width: 800, height: 800 },
          ],
          caption: "mira esto",
        },
      }),
      env,
    );
    expect(msg.imageUrl).toBe(
      "https://api.telegram.org/file/bottest-token/photos/file_9.jpg",
    );
    expect(msg.text).toBe("mira esto");
  });

  it("convierte una ubicación compartida en texto con link de mapa (si no, el bot la ignora)", async () => {
    const msg = await telegramAdapter.parseIncoming(
      makeReq({
        update_id: 5,
        message: {
          message_id: 14,
          from: { id: 555, first_name: "Ana", is_bot: false },
          chat: { id: 555, type: "private" },
          date: 100,
          location: { latitude: -17.7833, longitude: -63.1821 },
        },
      }),
      env,
    );
    expect(msg.text).toContain("UBICACIÓN COMPARTIDA");
    expect(msg.text).toContain("https://www.google.com/maps?q=-17.7833,-63.1821");
  });

  it("incluye título y dirección cuando es un 'venue'", async () => {
    const msg = await telegramAdapter.parseIncoming(
      makeReq({
        update_id: 6,
        message: {
          message_id: 15,
          from: { id: 555, first_name: "Ana", is_bot: false },
          chat: { id: 555, type: "private" },
          date: 100,
          venue: {
            location: { latitude: -17.78, longitude: -63.18 },
            title: "Casa",
            address: "Barrio Las Palmas, calle 3",
          },
        },
      }),
      env,
    );
    expect(msg.text).toContain("Casa, Barrio Las Palmas, calle 3");
  });

  it("convierte un contacto compartido en texto", async () => {
    const msg = await telegramAdapter.parseIncoming(
      makeReq({
        update_id: 7,
        message: {
          message_id: 16,
          from: { id: 555, first_name: "Ana", is_bot: false },
          chat: { id: 555, type: "private" },
          date: 100,
          contact: { phone_number: "+59171234567", first_name: "Ana" },
        },
      }),
      env,
    );
    expect(msg.text).toContain("CONTACTO COMPARTIDO");
    expect(msg.text).toContain("+59171234567");
  });

  it("flags the owner's own message via OWNER_TELEGRAM_CHAT_ID", async () => {
    const ownerEnv = { TELEGRAM_BOT_TOKEN: "t", OWNER_TELEGRAM_CHAT_ID: "999" } as Env;
    const msg = await telegramAdapter.parseIncoming(
      makeReq({
        update_id: 4,
        message: {
          message_id: 13,
          from: { id: 999, first_name: "Dueño", is_bot: false },
          chat: { id: 999, type: "private" },
          date: 100,
          text: "yo me encargo",
        },
      }),
      ownerEnv,
    );
    expect(msg.isOwnerMessage).toBe(true);
  });
});

describe("resolveTelegramFileUrl", () => {
  it("returns null when getFile fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 400 }));
    const url = await resolveTelegramFileUrl("x", "tok");
    expect(url).toBeNull();
  });
});

describe("telegramAdapter.sendMedia", () => {
  it.each([
    ["image", "sendPhoto", "photo"],
    ["video", "sendVideo", "video"],
    ["audio", "sendVoice", "voice"],
  ])("kind=%s → %s con la URL en el campo %s", async (kind, method, field) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await telegramAdapter.sendMedia!(
      { channel: "telegram", channelUserId: "42", url: "https://x/m", kind: kind as any, caption: "cap" },
      { TELEGRAM_BOT_TOKEN: "TG" } as Env,
    );
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe(`https://api.telegram.org/botTG/${method}`);
    const body = JSON.parse(String(init.body));
    expect(body.chat_id).toBe("42");
    expect(body[field]).toBe("https://x/m");
    expect(body.caption).toBe("cap");
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyKapsoSignature,
  parseKapsoEvent,
  packKapsoId,
  unpackKapsoId,
  kapsoAdapter,
} from "../../src/channels/kapso";

const SECRET = "whsec_kapso";
const PHONE_ID = "123456789012345";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function received(overrides: {
  type?: string;
  from?: string;
  direction?: string;
  text?: string | null;
  media?: { kind: string; url?: string; id?: string; caption?: string };
  senderName?: string;
} = {}): any {
  const { type = "text", from = "16315551181", direction = "inbound", text = "hola", media, senderName } = overrides;
  const message: any = {
    id: "wamid.1",
    timestamp: "1730092800",
    type,
    from,
    kapso: { direction, status: "received", has_media: !!media, content: text ?? "" },
  };
  if (text != null && type === "text") message.text = { body: text };
  if (media) {
    message[media.kind] = { id: media.id, caption: media.caption };
    message.kapso.media_url = media.url;
    message.kapso.has_media = true;
  }
  if (senderName) message.contacts = [{ profile: { name: senderName } }];
  return {
    message,
    conversation: { id: "conv_123", phone_number: from, phone_number_id: PHONE_ID },
    phone_number_id: PHONE_ID,
  };
}

describe("verifyKapsoSignature", () => {
  it("acepta un HMAC-SHA256 hex correcto del cuerpo crudo", async () => {
    const body = JSON.stringify(received());
    expect(await verifyKapsoSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rechaza cuerpo alterado", async () => {
    const body = JSON.stringify(received());
    expect(await verifyKapsoSignature(body + " ", sign(body), SECRET)).toBe(false);
  });

  it("fail-closed sin secret o sin firma", async () => {
    const body = JSON.stringify(received());
    expect(await verifyKapsoSignature(body, sign(body), "")).toBe(false);
    expect(await verifyKapsoSignature(body, null, SECRET)).toBe(false);
  });
});

describe("packKapsoId / unpackKapsoId", () => {
  it("empaca phone_number_id + teléfono y los recupera", () => {
    const packed = packKapsoId(PHONE_ID, "16315551181");
    expect(unpackKapsoId(packed)).toEqual({ phoneNumberId: PHONE_ID, to: "16315551181" });
  });
});

describe("parseKapsoEvent", () => {
  const env = { KAPSO_API_KEY: "sk_test", KAPSO_WEBHOOK_SECRET: SECRET } as any;
  const ORIGIN = "https://bot.example.workers.dev";

  it("parsea un texto entrante", async () => {
    const out = await parseKapsoEvent(received({ text: "quiero una cita", senderName: "María" }), env, ORIGIN);
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe("kapso");
    expect(out[0].channelUserId).toBe(packKapsoId(PHONE_ID, "16315551181"));
    expect(out[0].text).toBe("quiero una cita");
    expect(out[0].displayName).toBe("María");
  });

  it("ignora mensajes salientes (direction != inbound)", async () => {
    const out = await parseKapsoEvent(received({ direction: "outbound" }), env, ORIGIN);
    expect(out).toHaveLength(0);
  });

  it("ignora tipos no soportados (video, document, location)", async () => {
    for (const type of ["video", "document", "location", "sticker"]) {
      const out = await parseKapsoEvent(received({ type, text: null }), env, ORIGIN);
      expect(out, type).toHaveLength(0);
    }
  });

  it("enruta la imagen entrante por el proxy firmado del worker", async () => {
    const out = await parseKapsoEvent(
      received({
        type: "image",
        text: null,
        media: { kind: "image", url: "https://api.kapso.ai/media/MID_1", id: "MID_1", caption: "mirá" },
      }),
      env,
      ORIGIN,
    );
    expect(out[0].imageUrl).toContain(`${ORIGIN}/webhooks/kapso/media`);
    expect(out[0].imageUrl).toMatch(/[?&]sig=/);
    expect(out[0].imageUrl).toMatch(/[?&]exp=/);
    expect(out[0].text).toBe("mirá");
  });

  it("parsea una nota de voz como audioUrl (por el proxy)", async () => {
    const out = await parseKapsoEvent(
      received({ type: "audio", text: null, media: { kind: "audio", url: "https://api.kapso.ai/media/AUD_1" } }),
      env,
      ORIGIN,
    );
    expect(out[0].audioUrl).toContain(`${ORIGIN}/webhooks/kapso/media`);
  });

  it("sin secret no puede firmar la media → la ignora", async () => {
    const out = await parseKapsoEvent(
      received({ type: "image", text: null, media: { kind: "image", url: "https://api.kapso.ai/media/X" } }),
      { KAPSO_API_KEY: "sk_test" } as any,
      ORIGIN,
    );
    expect(out).toHaveLength(0); // sin texto ni media utilizable
  });
});

describe("kapsoAdapter.sendReply", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POST al endpoint Meta de Kapso con X-API-Key y body con forma de Meta", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await kapsoAdapter.sendReply(
      { channel: "kapso", channelUserId: packKapsoId(PHONE_ID, "16315551181"), chunks: ["hola"] },
      { KAPSO_API_KEY: "sk_live" } as any,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe(`https://api.kapso.ai/meta/whatsapp/v24.0/${PHONE_ID}/messages`);
    expect(init.method).toBe("POST");
    expect(init.headers["X-API-Key"]).toBe("sk_live");
    const payload = JSON.parse(init.body);
    expect(payload.messaging_product).toBe("whatsapp");
    expect(payload.to).toBe("16315551181");
    expect(payload.type).toBe("text");
    expect(payload.text.body).toBe("hola");
  });

  it("un POST por chunk", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await kapsoAdapter.sendReply(
      {
        channel: "kapso",
        channelUserId: packKapsoId(PHONE_ID, "1"),
        chunks: ["uno", "dos"],
        interChunkDelayMs: 0,
      },
      { KAPSO_API_KEY: "sk_live" } as any,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lanza si falta KAPSO_API_KEY", async () => {
    await expect(
      kapsoAdapter.sendReply(
        { channel: "kapso", channelUserId: packKapsoId(PHONE_ID, "1"), chunks: ["hi"] },
        {} as any,
      ),
    ).rejects.toThrow(/KAPSO_API_KEY/);
  });
});

describe("kapsoAdapter.sendMedia / sendImage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sendImage manda type image con {link, caption}", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await kapsoAdapter.sendImage!(
      {
        channel: "kapso",
        channelUserId: packKapsoId(PHONE_ID, "16315551181"),
        url: "https://bot.example/qr.png",
        caption: "escaneá para pagar",
      },
      { KAPSO_API_KEY: "sk_live" } as any,
    );
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe(`https://api.kapso.ai/meta/whatsapp/v24.0/${PHONE_ID}/messages`);
    const payload = JSON.parse(init.body);
    expect(payload.type).toBe("image");
    expect(payload.image.link).toBe("https://bot.example/qr.png");
    expect(payload.image.caption).toBe("escaneá para pagar");
  });

  it("sendMedia audio no manda caption", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await kapsoAdapter.sendMedia!(
      {
        channel: "kapso",
        channelUserId: packKapsoId(PHONE_ID, "1"),
        url: "https://bot.example/a.mp3",
        kind: "audio",
        caption: "x",
      },
      { KAPSO_API_KEY: "sk_live" } as any,
    );
    const payload = JSON.parse((fetchMock.mock.calls[0] as any[])[1].body);
    expect(payload.type).toBe("audio");
    expect(payload.audio.link).toBe("https://bot.example/a.mp3");
    expect(payload.audio.caption).toBeUndefined();
  });
});

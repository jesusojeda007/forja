import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyZernioSignature,
  parseZernioEvent,
  packZernioId,
  unpackZernioId,
  zernioAdapter,
} from "../../src/channels/zernio";

const SECRET = "whsec_test";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** A minimal `message.received` webhook body, JSON-stringified. */
function messageReceived(overrides: {
  platform?: string;
  direction?: string;
  text?: string | null;
  attachments?: any[];
  sender?: any;
  conversationId?: string;
  accountId?: string;
  event?: string;
} = {}): string {
  const {
    platform = "whatsapp",
    direction = "incoming",
    text = "hola",
    attachments = [],
    sender = { id: "5215512345678", name: "María" },
    conversationId = "conv_1",
    accountId = "acct_1",
    event = "message.received",
  } = overrides;
  return JSON.stringify({
    id: "evt_1",
    event,
    message: {
      id: "msg_1",
      conversationId,
      platform,
      platformMessageId: "wamid.1",
      direction,
      text,
      attachments,
      sender,
      sentAt: "2026-09-07T12:00:00.000Z",
      isRead: false,
    },
    conversation: { id: conversationId, platformConversationId: "pconv_1", status: "active" },
    account: { id: accountId, accountId, platform, username: "mystore" },
    timestamp: "2026-09-07T12:00:01.000Z",
  });
}

describe("verifyZernioSignature", () => {
  it("acepta una firma HMAC-SHA256 hex correcta", async () => {
    const body = messageReceived();
    expect(await verifyZernioSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rechaza si el cuerpo fue alterado", async () => {
    const body = messageReceived();
    const sig = sign(body);
    expect(await verifyZernioSignature(body + " ", sig, SECRET)).toBe(false);
  });

  it("rechaza si falta el secret o la firma (fail-closed)", async () => {
    const body = messageReceived();
    expect(await verifyZernioSignature(body, sign(body), "")).toBe(false);
    expect(await verifyZernioSignature(body, null, SECRET)).toBe(false);
  });
});

describe("packZernioId / unpackZernioId", () => {
  it("empaca accountId + conversationId y los recupera", () => {
    const packed = packZernioId("acct_1", "conv_1");
    expect(unpackZernioId(packed)).toEqual({ accountId: "acct_1", conversationId: "conv_1" });
  });

  it("recupera conversationId aunque lleve el delimitador dentro", () => {
    const packed = packZernioId("acct_1", "conv::weird::id");
    expect(unpackZernioId(packed)).toEqual({
      accountId: "acct_1",
      conversationId: "conv::weird::id",
    });
  });
});

describe("parseZernioEvent", () => {
  const env = { ZERNIO_API_KEY: "sk_test" } as any;
  const ORIGIN = "https://bot.example.workers.dev";

  it("parsea un mensaje de texto entrante", async () => {
    const out = await parseZernioEvent(
      JSON.parse(messageReceived({ text: "quiero una cita" })),
      env,
      ORIGIN,
    );
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe("zernio");
    expect(out[0].channelUserId).toBe(packZernioId("acct_1", "conv_1"));
    expect(out[0].text).toBe("quiero una cita");
    expect(out[0].displayName).toBe("María");
  });

  it("ignora los mensajes salientes (direction=outgoing)", async () => {
    const out = await parseZernioEvent(
      JSON.parse(messageReceived({ direction: "outgoing" })),
      env,
      ORIGIN,
    );
    expect(out).toHaveLength(0);
  });

  it("ignora eventos que no son message.received", async () => {
    const out = await parseZernioEvent(
      JSON.parse(messageReceived({ event: "conversation.started" })),
      env,
      ORIGIN,
    );
    expect(out).toHaveLength(0);
  });

  it("pasa el link CDN directo de una imagen de Instagram tal cual", async () => {
    const out = await parseZernioEvent(
      JSON.parse(
        messageReceived({
          platform: "instagram",
          text: null,
          attachments: [{ type: "image", url: "https://cdn.ig.example/x.jpg" }],
        }),
      ),
      env,
      ORIGIN,
    );
    expect(out[0].imageUrl).toBe("https://cdn.ig.example/x.jpg");
    expect(out[0].text).toBeUndefined();
  });

  it("enruta la media de WhatsApp por el proxy firmado del worker", async () => {
    const out = await parseZernioEvent(
      JSON.parse(
        messageReceived({
          platform: "whatsapp",
          text: null,
          attachments: [
            { type: "image", url: "https://zernio.com/api/v1/whatsapp/media/MID_1" },
          ],
        }),
      ),
      { ZERNIO_API_KEY: "sk_test", ZERNIO_WEBHOOK_SECRET: SECRET } as any,
      ORIGIN,
    );
    expect(out[0].imageUrl).toContain(`${ORIGIN}/webhooks/zernio/media`);
    expect(out[0].imageUrl).toMatch(/[?&]sig=/);
    expect(out[0].imageUrl).toMatch(/[?&]exp=/);
  });

  it("parsea una nota de voz como audioUrl", async () => {
    const out = await parseZernioEvent(
      JSON.parse(
        messageReceived({
          platform: "telegram",
          text: null,
          attachments: [{ type: "audio", url: "https://cdn.tg.example/a.ogg" }],
        }),
      ),
      env,
      ORIGIN,
    );
    expect(out[0].audioUrl).toBe("https://cdn.tg.example/a.ogg");
  });
});

describe("zernioAdapter.sendReply", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hace POST al endpoint de conversación con { accountId, message } y Bearer", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await zernioAdapter.sendReply(
      {
        channel: "zernio",
        channelUserId: packZernioId("acct_1", "conv_1"),
        chunks: ["hola"],
      },
      { ZERNIO_API_KEY: "sk_live" } as any,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe("https://zernio.com/api/v1/inbox/conversations/conv_1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk_live");
    const payload = JSON.parse(init.body);
    expect(payload.accountId).toBe("acct_1");
    expect(payload.message).toBe("hola");
  });

  it("manda un POST por cada chunk", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await zernioAdapter.sendReply(
      {
        channel: "zernio",
        channelUserId: packZernioId("acct_1", "conv_1"),
        chunks: ["uno", "dos"],
        interChunkDelayMs: 0,
      },
      { ZERNIO_API_KEY: "sk_live" } as any,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lanza si falta ZERNIO_API_KEY", async () => {
    await expect(
      zernioAdapter.sendReply(
        { channel: "zernio", channelUserId: packZernioId("a", "c"), chunks: ["hi"] },
        {} as any,
      ),
    ).rejects.toThrow(/ZERNIO_API_KEY/);
  });
});

describe("zernioAdapter.sendImage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("manda attachmentUrl con attachmentType image y el caption como message", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await zernioAdapter.sendImage!(
      {
        channel: "zernio",
        channelUserId: packZernioId("acct_1", "conv_1"),
        url: "https://bot.example/qr.png",
        caption: "escanea para pagar",
      },
      { ZERNIO_API_KEY: "sk_live" } as any,
    );
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe("https://zernio.com/api/v1/inbox/conversations/conv_1/messages");
    const payload = JSON.parse(init.body);
    expect(payload.accountId).toBe("acct_1");
    expect(payload.attachmentUrl).toBe("https://bot.example/qr.png");
    expect(payload.attachmentType).toBe("image");
    expect(payload.message).toBe("escanea para pagar");
  });
});

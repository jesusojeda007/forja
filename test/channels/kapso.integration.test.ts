import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mismo arnés que zernio.integration: mock del SDK `agents` y del paquete `ai`;
// TODO lo demás corre de verdad — en particular `pickAdapter` NO está mockeado,
// así que esto prueba que el agente rutea una respuesta `kapso` por
// `kapsoAdapter.sendReply` y pega contra la forma real de la API de Kapso.
vi.mock("agents", () => ({
  Agent: class {
    ctx: any;
    env: any;
    state: any;
    constructor(ctx: any, env: any) {
      this.ctx = ctx;
      this.env = env;
    }
    setState(s: any) {
      this.state = s;
    }
    sql(..._args: any[]) {
      return undefined;
    }
  },
}));

const streamTextMock = vi.fn();
const generateTextMock = vi.fn();
vi.mock("ai", () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  generateText: (...args: any[]) => generateTextMock(...args),
  tool: (def: any) => def,
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

import { SupportAgent } from "../../src/agent";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { SettingsRepo } from "../../src/db/settings";
import { packKapsoId } from "../../src/channels/kapso";

function makeStreamResult(text: string) {
  async function* gen() {
    yield text;
  }
  return {
    textStream: gen(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }),
    steps: Promise.resolve([{ toolCalls: [] }]),
  };
}

describe("Kapso — pipe completo: agente → kapsoAdapter → API de Kapso", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
    vi.spyOn(MessagesRepo.prototype, "append").mockResolvedValue(undefined as any);
    vi.spyOn(MessagesRepo.prototype, "lastN").mockResolvedValue([
      { role: "user", content: "¿tienen citas mañana?" },
    ] as any);
    vi.spyOn(ConversationsRepo.prototype, "getOrCreate").mockResolvedValue({
      id: "conv-1",
      paused_until: null,
    } as any);
    vi.spyOn(ConversationsRepo.prototype, "isPaused").mockResolvedValue(false);
    vi.spyOn(ConversationsRepo.prototype, "touchLastMessage").mockResolvedValue(undefined as any);

    streamTextMock.mockReset();
    streamTextMock.mockImplementation(() => makeStreamResult("¡Claro! Tenemos hueco a las 10."));

    originalFetch = globalThis.fetch;
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("la respuesta del bot sale por POST al endpoint Meta de Kapso con X-API-Key", async () => {
    const env: any = {
      DB: {},
      AI: { run: vi.fn() },
      ANTHROPIC_API_KEY: "sk-test",
      KAPSO_API_KEY: "sk_live_kapso",
      BOT_TIER: "pro",
      BOT_LANGUAGE: "es",
      BUFFER_SECONDS: "1",
      BOT_NAME: "TestBot",
      BUSINESS_NAME: "TestCo",
    };
    const agent: any = new (SupportAgent as any)({ storage: { setAlarm: vi.fn(), getAlarm: vi.fn() } }, env);
    agent.setState({
      conversationId: "conv-1",
      channel: "kapso",
      channelUserId: packKapsoId("PNID_1", "16315551181"),
      pendingMessages: [{ text: "¿tienen citas mañana?", receivedAt: Date.now() }],
      lastAlarmAt: 0,
      lastUserLang: "es",
      toolCallsInLast2Turns: 0,
      lastSearchKbScore: 1,
      imageRetryCount: 0,
    });

    await agent.processBuffer();

    const kapsoCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("https://api.kapso.ai/meta/whatsapp/v24.0/"),
    );
    expect(kapsoCalls.length).toBeGreaterThan(0);
    for (const [url, init] of kapsoCalls as any[]) {
      expect(url).toBe("https://api.kapso.ai/meta/whatsapp/v24.0/PNID_1/messages");
      expect(init.headers["X-API-Key"]).toBe("sk_live_kapso");
      const payload = JSON.parse(init.body);
      expect(payload.messaging_product).toBe("whatsapp");
      expect(payload.to).toBe("16315551181");
    }
    const enviado = (kapsoCalls as any[]).map(([, init]) => JSON.parse(init.body).text.body).join(" ");
    expect(enviado).toContain("Tenemos hueco a las 10");
  });
});

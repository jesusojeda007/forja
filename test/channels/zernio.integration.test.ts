import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Same harness as test/agent.media.test.ts: mock the `agents` SDK so
// `SupportAgent` loads in Node, mock the `ai` package so no LLM call leaves the
// machine. Everything ELSE runs for real — crucially `pickAdapter` is NOT
// mocked, so this proves the agent actually routes a `zernio` reply through
// `zernioAdapter.sendReply` and hits the real Zernio API shape.
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
import { packZernioId } from "../../src/channels/zernio";

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

describe("Zernio — pipe completo: agente → zernioAdapter → API de Zernio", () => {
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

  it("la respuesta del bot sale por POST al endpoint de conversación de Zernio", async () => {
    const env: any = {
      DB: {},
      AI: { run: vi.fn() },
      ANTHROPIC_API_KEY: "sk-test",
      ZERNIO_API_KEY: "sk_live_zernio",
      BOT_TIER: "pro",
      BOT_LANGUAGE: "es",
      BUFFER_SECONDS: "1",
      BOT_NAME: "TestBot",
      BUSINESS_NAME: "TestCo",
    };
    const agent: any = new (SupportAgent as any)({ storage: { setAlarm: vi.fn(), getAlarm: vi.fn() } }, env);
    agent.setState({
      conversationId: "conv-1",
      channel: "zernio",
      channelUserId: packZernioId("acct_1", "conv_zrn_1"),
      pendingMessages: [{ text: "¿tienen citas mañana?", receivedAt: Date.now() }],
      lastAlarmAt: 0,
      lastUserLang: "es",
      toolCallsInLast2Turns: 0,
      lastSearchKbScore: 1,
      imageRetryCount: 0,
    });

    await agent.processBuffer();

    const zernioCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("https://zernio.com/api/v1/inbox/conversations/"),
    );
    expect(zernioCalls.length).toBeGreaterThan(0);
    // Todas van a la conversación correcta, con el Bearer correcto.
    for (const [url, init] of zernioCalls as any[]) {
      expect(url).toBe("https://zernio.com/api/v1/inbox/conversations/conv_zrn_1/messages");
      expect(init.headers.Authorization).toBe("Bearer sk_live_zernio");
      expect(JSON.parse(init.body).accountId).toBe("acct_1");
    }
    // El texto del bot (puede llegar en varios chunks) sale íntegro.
    const enviado = (zernioCalls as any[])
      .map(([, init]) => JSON.parse(init.body).message)
      .join(" ");
    expect(enviado).toContain("Tenemos hueco a las 10");
  });
});

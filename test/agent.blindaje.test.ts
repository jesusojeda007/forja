import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  streamText: (...a: any[]) => streamTextMock(...a),
  generateText: (...a: any[]) => generateTextMock(...a),
  tool: (d: any) => d,
}));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => (id: string) => ({ modelId: id }) }));

// El chequeo de fundamento se mockea: cada test controla grounded / ungrounded.
const checkGroundingMock = vi.fn();
vi.mock("../src/llm/blindajeCheck", () => ({
  checkGrounding: (...a: any[]) => checkGroundingMock(...a),
}));

import { SupportAgent } from "../src/agent";
import { ConversationsRepo } from "../src/db/conversations";
import { MessagesRepo } from "../src/db/messages";
import { SettingsRepo } from "../src/db/settings";
import { TicketsRepo } from "../src/db/tickets";
import * as senderMod from "../src/replies/sender";

function stream(text: string, steps: any[] = [{ toolCalls: [], toolResults: [] }]) {
  async function* gen() {
    yield text;
  }
  return {
    textStream: gen(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }),
    steps: Promise.resolve(steps),
  };
}

function makeAgent(settings: Record<string, string>) {
  const env: any = {
    DB: {},
    AI: { run: vi.fn() },
    ANTHROPIC_API_KEY: "sk-test",
    BOT_TIER: "pro",
    BOT_LANGUAGE: "es",
    BUFFER_SECONDS: "1",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "TestCo",
    DASHBOARD_BASE_URL: "https://x.workers.dev",
  };
  const agent: any = new (SupportAgent as any)({ storage: { setAlarm: vi.fn(), getAlarm: vi.fn() } }, env);
  agent.setState({
    conversationId: "conv-1",
    channel: "telegram",
    channelUserId: "u1",
    pendingMessages: [{ text: "¿cuánto cuesta el corte?", receivedAt: Date.now() }],
    lastAlarmAt: 0,
    lastUserLang: "es",
    toolCallsInLast2Turns: 0,
    lastSearchKbScore: 1,
    imageRetryCount: 0,
  });
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue(settings);
  return { agent };
}

describe("SupportAgent — Blindaje anti-invento", () => {
  let sendReply: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    checkGroundingMock.mockReset();
    streamTextMock.mockReset();
    generateTextMock.mockReset();
    sendReply = vi.fn(async () => {});
    vi.spyOn(senderMod, "pickAdapter").mockReturnValue({ sendReply } as any);
    vi.spyOn(MessagesRepo.prototype, "append").mockResolvedValue(undefined as any);
    vi.spyOn(MessagesRepo.prototype, "lastN").mockResolvedValue([
      { role: "user", content: "¿cuánto cuesta el corte?" },
    ] as any);
    vi.spyOn(ConversationsRepo.prototype, "getOrCreate").mockResolvedValue({ id: "conv-1", paused_until: null } as any);
    vi.spyOn(ConversationsRepo.prototype, "isPaused").mockResolvedValue(false);
    vi.spyOn(ConversationsRepo.prototype, "touchLastMessage").mockResolvedValue(undefined as any);
  });

  afterEach(() => vi.restoreAllMocks());

  const sentText = () =>
    (sendReply.mock.calls[0]?.[0] as { chunks: string[] } | undefined)?.chunks.join(" ") ?? "";

  it("blindaje OFF: no llama al chequeo y manda la respuesta tal cual", async () => {
    const { agent } = makeAgent({});
    streamTextMock.mockImplementation(() => stream("El corte cuesta $150."));
    await agent.processBuffer();
    expect(checkGroundingMock).not.toHaveBeenCalled();
    expect(sentText()).toContain("$150");
  });

  it("blindaje ON + respuesta con fundamento: se envía tal cual", async () => {
    const { agent } = makeAgent({ blindaje: "on" });
    streamTextMock.mockImplementation(() => stream("El corte cuesta $150."));
    checkGroundingMock.mockResolvedValue({ grounded: true, unsupported: [] });
    await agent.processBuffer();
    expect(checkGroundingMock).toHaveBeenCalledTimes(1);
    expect(sentText()).toContain("$150");
  });

  it("blindaje ON + dato inventado: reemplaza por un deflection y abre ticket", async () => {
    const { agent } = makeAgent({ blindaje: "on" });
    streamTextMock.mockImplementation(() => stream("El corte cuesta $150 y el tinte $999."));
    checkGroundingMock.mockResolvedValue({ grounded: false, unsupported: ["precio del tinte $999"] });
    const ticket = vi.spyOn(TicketsRepo.prototype, "create").mockResolvedValue("tkt-1");
    await agent.processBuffer();
    expect(sentText()).not.toContain("$999");
    expect(sentText().toLowerCase()).toContain("confirm");
    expect(ticket).toHaveBeenCalledTimes(1);
  });

  it("blindaje ON pero el bot ya llamó handoffHuman: no corre el chequeo", async () => {
    const { agent } = makeAgent({ blindaje: "on" });
    streamTextMock.mockImplementation(() =>
      stream("Te paso con una persona.", [
        { toolCalls: [{ toolName: "handoffHuman", input: {} }], toolResults: [] },
      ]),
    );
    await agent.processBuffer();
    expect(checkGroundingMock).not.toHaveBeenCalled();
  });

  it("blindaje ON + el chequeo hace fail-open (grounded:true): se envía la respuesta", async () => {
    const { agent } = makeAgent({ blindaje: "on" });
    streamTextMock.mockImplementation(() => stream("El corte cuesta $150."));
    checkGroundingMock.mockResolvedValue({ grounded: true, unsupported: [] });
    await agent.processBuffer();
    expect(sentText()).toContain("$150");
  });
});

/**
 * Prueba de humo del canal Zernio — simula un webhook `message.received` de
 * Zernio contra tu bot (local con `pnpm dev`, o el desplegado).
 *
 * Esto es un script CLI, NO un test de vitest: no corre en la suite ni en CI.
 *
 * Qué prueba: firma `X-Zernio-Signature` → ruta `/webhooks/zernio` → adaptador →
 * buffer del agente → LLM → intento de respuesta por el canal `zernio`. Con una
 * `ANTHROPIC_API_KEY` real en `.dev.vars`, el bot piensa y responde de verdad; el
 * envío a Zernio devolverá 401 (API key falsa) — normal, se ve en los logs de
 * `wrangler dev` y confirma que el pipe corre entero.
 *
 * Uso:
 *   pnpm dev                                    # en otra terminal
 *   pnpm tsx scripts/zernio-smoke.ts "hola, ¿tienen citas mañana?"
 *
 * Variables (todas opcionales):
 *   BOT_URL                 default http://127.0.0.1:8787
 *   ZERNIO_WEBHOOK_SECRET   si no está, se lee de .dev.vars; si tampoco, "dev-zernio-secret"
 *   ZERNIO_PLATFORM         red simulada (whatsapp | instagram | telegram | messenger); default whatsapp
 *   ZERNIO_CONVERSATION_ID  default conv_smoke_1
 *   ZERNIO_ACCOUNT_ID       default acct_smoke_1
 *   ZERNIO_SENDER_ID        default 5215500000000
 */

import process from "node:process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Lee una clave de `.dev.vars` (formato KEY=valor), o undefined. */
function fromDevVars(key: string): string | undefined {
  try {
    const raw = readFileSync(path.join(ROOT, ".dev.vars"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* sin .dev.vars */
  }
  return undefined;
}

async function main() {
  const text = process.argv.slice(2).join(" ").trim() || "hola, ¿tienen citas mañana?";
  const botUrl = (process.env.BOT_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  const secret =
    process.env.ZERNIO_WEBHOOK_SECRET || fromDevVars("ZERNIO_WEBHOOK_SECRET") || "dev-zernio-secret";
  const platform = process.env.ZERNIO_PLATFORM || "whatsapp";
  const conversationId = process.env.ZERNIO_CONVERSATION_ID || "conv_smoke_1";
  const accountId = process.env.ZERNIO_ACCOUNT_ID || "acct_smoke_1";
  const senderId = process.env.ZERNIO_SENDER_ID || "5215500000000";

  const payload = {
    id: `evt_smoke_${Date.now()}`,
    event: "message.received",
    message: {
      id: `msg_smoke_${Date.now()}`,
      conversationId,
      platform,
      platformMessageId: `pmid_${Date.now()}`,
      direction: "incoming",
      text,
      attachments: [],
      sender: { id: senderId, name: "Cliente de Prueba" },
      sentAt: new Date().toISOString(),
      isRead: false,
    },
    conversation: { id: conversationId, platformConversationId: "pconv_smoke", status: "active" },
    account: { id: accountId, accountId, platform, username: "mystore" },
    timestamp: new Date().toISOString(),
  };

  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  console.log(`→ POST ${botUrl}/webhooks/zernio`);
  console.log(`  platform=${platform}  conversationId=${conversationId}  text=${JSON.stringify(text)}`);

  const res = await fetch(`${botUrl}/webhooks/zernio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Zernio-Signature": signature },
    body,
  });

  const respText = await res.text().catch(() => "");
  console.log(`← ${res.status} ${res.statusText}  ${respText}`);

  if (res.status === 200) {
    console.log(
      "\n✓ El webhook se aceptó. Mira los logs de `wrangler dev`: deberías ver al bot\n" +
        "  procesar el mensaje y (con ANTHROPIC_API_KEY real) intentar responder por Zernio.\n" +
        "  Un `zernio sendReply 401` en los logs es esperado si la ZERNIO_API_KEY es de prueba.",
    );
  } else if (res.status === 403) {
    console.log(
      "\n✗ 403 = firma inválida. El ZERNIO_WEBHOOK_SECRET de este script no coincide con el\n" +
        "  del Worker, o el Worker no tiene el secret. Ponlo igual en .dev.vars y reinicia `pnpm dev`.",
    );
  } else {
    console.log("\n✗ Respuesta inesperada — revisa los logs de `wrangler dev`.");
  }
  process.exit(res.status === 200 ? 0 : 1);
}

main().catch((e) => {
  console.error("error:", e?.message ?? e);
  console.error("¿está corriendo `pnpm dev`? (BOT_URL =", process.env.BOT_URL || "http://127.0.0.1:8787", ")");
  process.exit(1);
});

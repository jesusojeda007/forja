# Conectar tu bot a WhatsApp con Kapso

Esta guía conecta tu chatbot a **WhatsApp usando Kapso** (https://kapso.com), un
proveedor que hace de **puente con la API oficial de Meta**: te da el onboarding
del número, los webhooks y el envío por API sin que pelees con el panel de Meta.
Está escrita para que la sigas aunque no sepas programar: Claude Code hace lo
técnico; **estas credenciales solo las consigues tú** porque salen de tu cuenta
de Kapso.

> **¿Kapso o WhatsApp Cloud directo?** Kapso simplifica el alta del número y el
> mantenimiento, a cambio de un **costo mensual** propio y un intermediario más.
> Si ya sabes moverte en la app de Meta, `whatsapp-cloud.md` es directo y sin ese
> costo. Kapso es un canal **ADICIONAL** — se suma a los que ya tengas.

---

## Qué vas a lograr

Que cuando un cliente le escriba a tu número de WhatsApp, el bot le responda solo
— incluyendo **notas de voz e imágenes** (la media pasa por un proxy firmado del
propio Worker, sin configuración extra).

## Antes de empezar

- Una cuenta de **Kapso** (https://kapso.com) con un **número de WhatsApp** ya
  dado de alta (onboarding de Kapso).
- Tu Worker ya desplegado (Claude Code te da la URL al terminar `pnpm run deploy`,
  algo como `https://TU-WORKER.workers.dev`).

---

## Paso 1 — Consigue tu API key

1. Entra a **https://kapso.com** e inicia sesión.
2. Ve a **Integrations → API keys**.
3. Dale **Create API key** y cópiala. Es tu `KAPSO_API_KEY`.

> ⚠️ Esa llave autoriza a enviar mensajes y descargar media en tu nombre. **No la
> pegues en el chat.** Solo va en la terminal en el Paso 4.

## Paso 2 — Inventa tu secreto de webhook

El **webhook secret** es una palabra secreta que **tú inventas**. Kapso firma
cada aviso que te manda con ese secreto (header `X-Webhook-Signature`), y el bot
verifica la firma para asegurarse de que de verdad viene de Kapso.

- Elige algo difícil de adivinar, ej. `kapso-mibot-7h3k9x2` (letras y números,
  sin espacios).
- Lo usas en dos lugares: al guardarlo como secret (Paso 4) y al pegarlo en Kapso
  (Paso 5), y **tienen que ser idénticos**.

## Paso 3 — Anota la URL de tu webhook

```
https://TU-WORKER.workers.dev/webhooks/kapso
```

Cambia `TU-WORKER.workers.dev` por la dirección real de tu Worker.

## Paso 4 — Guarda las credenciales en tu bot

Cuando Claude Code te lo pida, corre estos comandos (uno por uno) y pega el valor
cuando te lo pregunte. **Pega solo el dato, sin comillas, y dale Enter** (la
entrada va oculta).

```bash
# La API key de Integrations → API keys
pnpm wrangler secret put KAPSO_API_KEY

# El secreto de webhook que TÚ inventaste (Paso 2)
pnpm wrangler secret put KAPSO_WEBHOOK_SECRET
```

Después, Claude corre `pnpm run deploy` para que el Worker tome los secrets.

## Paso 5 — Crea el webhook en Kapso

1. En Kapso ve a los **Webhooks de tu número de teléfono**.
2. En **URL** pega `https://TU-WORKER.workers.dev/webhooks/kapso`.
3. En **Secret** pega **exactamente** el mismo secreto del Paso 2.
4. Suscribe el evento de **mensajes entrantes** (`whatsapp.message.received`).
5. Guarda.

## Paso 6 — Prueba

1. Desde otro teléfono, mándale un WhatsApp a tu número.
2. El bot debería responder en unos segundos.
3. Prueba también una **nota de voz** y una **foto**: el bot las entiende.
4. Abre `/admin/conexiones`: la tarjeta **"WhatsApp (Kapso)"** debe estar **verde**.

---

## Cómo trata el bot a Kapso

- **Es un canal de WhatsApp** (`channel: "kapso"`). En el panel las conversaciones
  aparecen como **WhatsApp (Kapso)**.
- **Solo mensajes entrantes.** Si respondes a mano desde Kapso, el bot no lo
  detecta como "toma de control". Usa el botón de pausa del panel si quieres que
  se calle mientras atiendes.
- **Ventana de 24 h.** Igual que WhatsApp directo: fuera de la ventana de 24 h
  desde el último mensaje del cliente, Meta solo deja mandar **plantillas
  aprobadas**, no texto libre. Los mensajes de respuesta normales (dentro de la
  ventana) no tienen ese límite.
- **Media entrante.** Las imágenes/audios usan una URL autenticada de Kapso; el
  bot la sirve por `/webhooks/kapso/media` (firmada, con expiración) para
  transcribir/ver sin exponer tu API key. No configuras nada.

---

## Resumen — qué secret es qué

| Secret | De dónde sale | Para qué sirve |
|---|---|---|
| `KAPSO_API_KEY` | Integrations → API keys | Autoriza al bot a enviar mensajes y descargar media |
| `KAPSO_WEBHOOK_SECRET` | Lo inventas tú | Valida la firma `X-Webhook-Signature` de cada aviso de Kapso |

**Webhook:** `https://TU-WORKER.workers.dev/webhooks/kapso` — suscribe
`whatsapp.message.received`.

---

## Problemas comunes

- **El bot no responde** → 1) ¿Suscribiste el evento de mensajes entrantes en el
  webhook de Kapso? 2) ¿El `KAPSO_WEBHOOK_SECRET` guardado en el bot y el que
  pegaste en Kapso son idénticos? 3) ¿Corriste `pnpm run deploy` después de
  guardar los secrets?
- **La tarjeta de Conexiones sigue gris** → Faltan uno o los dos secrets
  (`KAPSO_API_KEY`, `KAPSO_WEBHOOK_SECRET`). Los dos son obligatorios.
- **Kapso marca el webhook como fallido (403)** → El secreto no coincide, o el
  deploy con el secret nuevo todavía no terminó.
- **No entiende audios/imágenes** → El proxy de media necesita `KAPSO_API_KEY`
  **y** `KAPSO_WEBHOOK_SECRET` configurados.
- **"fuera de la ventana de 24h" / error de Meta al responder** → El cliente no
  escribe hace más de 24 h; solo se puede reabrir con una plantilla aprobada.

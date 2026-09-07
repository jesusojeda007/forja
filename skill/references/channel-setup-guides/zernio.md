# Conectar tu bot a Zernio (bandeja unificada: Instagram, Messenger, WhatsApp, Telegram…)

Esta guía conecta tu chatbot a **Zernio**, un proveedor que junta **varias redes
en una sola cuenta** (Instagram, Messenger, WhatsApp, Telegram, X y más) con
conexión de un clic. Está escrita para que la sigas aunque no sepas programar:
Claude Code hace lo técnico; **estas credenciales solo las consigues tú** porque
salen de tu cuenta de Zernio.

> **¿Por qué Zernio?** Si quieres conectar **varias redes de golpe** sin crear una
> app de Meta por cada una, o **comprar un número de WhatsApp** sin pelear con el
> setup de Meta, Zernio lo resuelve con OAuth de un clic. La contra: tiene **costo
> mensual** propio (y el Inbox requiere su add-on de Inbox), y es un intermediario
> más entre el cliente y tu bot.
>
> Zernio es un canal **ADICIONAL**. No reemplaza los canales directos: si ya
> tienes WhatsApp Cloud o Telegram conectados, Zernio se **suma**. Para **una
> sola red**, casi siempre sale más barato el método directo (`meta-oficial.md`,
> `whatsapp-cloud.md`, Telegram BotFather).

---

## Qué vas a lograr

Que cuando un cliente escriba a cualquiera de tus redes conectadas en Zernio, tu
bot le responda solo — incluyendo **notas de voz e imágenes** (el bot las procesa;
la media de WhatsApp pasa por un proxy de media firmado del propio Worker, sin
configuración extra).

## Antes de empezar

- Una cuenta de **Zernio** (https://zernio.com) con el **add-on de Inbox** activo.
- Al menos **una red social conectada** dentro de Zernio (Settings → Accounts /
  Connect account). Conecta ahí tu Instagram, WhatsApp, etc.
- Tu Worker ya desplegado (Claude Code te da la URL al terminar `pnpm run deploy`,
  algo como `https://TU-WORKER.workers.dev`).

---

## Paso 1 — Consigue tu API key

1. Entra a **https://zernio.com** e inicia sesión.
2. Ve a **Settings → API Keys**.
3. Dale **Create API key**. Cópiala — empieza con `sk_` seguido de una cadena
   larga. Es tu `ZERNIO_API_KEY`.

> ⚠️ Esa llave autoriza a enviar mensajes y descargar media en tu nombre. **No la
> pegues en el chat.** Solo va en la terminal en el Paso 4.

## Paso 2 — Inventa tu secreto de webhook

El **webhook secret** es una palabra secreta que **tú inventas**. Zernio firma
cada aviso que te manda con ese secreto, y el bot verifica la firma para
asegurarse de que de verdad viene de Zernio.

- Elige algo difícil de adivinar, ej. `zernio-mibot-7h3k9x2` (letras y números,
  sin espacios).
- Anótalo. Lo usas en dos lugares: al guardarlo como secret (Paso 4) y al
  pegarlo en Zernio (Paso 5), y **tienen que ser idénticos**.

## Paso 3 — Anota la URL de tu webhook

Tu bot escucha los mensajes de Zernio en:

```
https://TU-WORKER.workers.dev/webhooks/zernio
```

Cambia `TU-WORKER.workers.dev` por la dirección real de tu Worker.

## Paso 4 — Guarda las credenciales en tu bot

Claude Code las guarda como "secrets" del Worker en Cloudflare. Cuando te lo pida,
corre estos comandos (uno por uno) y pega el valor cuando te lo pregunte. **Pega
solo el dato, sin comillas, y dale Enter** (la entrada va oculta).

```bash
# La API key de Settings → API Keys (empieza con sk_)
pnpm wrangler secret put ZERNIO_API_KEY

# El secreto de webhook que TÚ inventaste (Paso 2)
pnpm wrangler secret put ZERNIO_WEBHOOK_SECRET
```

Después, Claude corre `pnpm run deploy` para que el Worker tome los secrets.

## Paso 5 — Crea el webhook en Zernio

1. En Zernio ve a **Settings → Webhooks** y dale **Create webhook**.
2. En **Endpoint URL** pega `https://TU-WORKER.workers.dev/webhooks/zernio`.
3. En **Secret** pega **exactamente** el mismo secreto del Paso 2.
4. En **Events**, suscribe al menos **`message.received`**. (Sin ese evento,
   Zernio no le avisa a tu bot que llegó un mensaje.)
5. Guarda.

## Paso 6 — Prueba

1. Desde otra cuenta, mándale un mensaje a una de las redes que conectaste en
   Zernio (por ejemplo tu Instagram).
2. Tu bot debería responder en unos segundos.
3. Prueba también una **nota de voz** y una **foto**: el bot las entiende
   (transcribe el audio y "ve" la imagen).
4. Abre `/admin/conexiones` en tu dashboard: la tarjeta **"Zernio"** debe estar
   **verde**.

---

## Cómo trata el bot a Zernio

- **Un solo canal.** No importa si el mensaje viene de Instagram, WhatsApp o
  Telegram por debajo: para el bot todo es el canal `zernio`. En el panel las
  conversaciones aparecen etiquetadas como **Zernio**.
- **Solo mensajes entrantes.** Si tú respondes a mano desde el inbox de Zernio,
  el bot no lo detecta como "toma de control" (a diferencia de Telegram). Si
  quieres que el bot se calle mientras atiendes, usa el botón de pausa del panel.
- **Media de WhatsApp.** Las imágenes/audios de WhatsApp vía Zernio usan una URL
  autenticada que expira; el bot la sirve por `/webhooks/zernio/media` (firmada,
  con expiración) para poder transcribir/ver sin exponer tu API key. No tienes
  que configurar nada.

---

## Resumen — qué secret es qué

| Secret | De dónde sale | Para qué sirve |
|---|---|---|
| `ZERNIO_API_KEY` | Settings → API Keys (empieza con `sk_`) | Autoriza al bot a enviar mensajes y descargar media |
| `ZERNIO_WEBHOOK_SECRET` | Lo inventas tú | Valida la firma `X-Zernio-Signature` de cada aviso de Zernio |

**Webhook:** `https://TU-WORKER.workers.dev/webhooks/zernio` — suscribe el evento
**`message.received`**.

---

## Problemas comunes

- **El bot no responde** → 1) ¿Suscribiste el evento **`message.received`** en el
  webhook de Zernio? 2) ¿El `ZERNIO_WEBHOOK_SECRET` guardado en el bot y el que
  pegaste en Zernio son idénticos? 3) ¿Corriste `pnpm run deploy` después de
  guardar los secrets?
- **La tarjeta de Conexiones sigue gris** → Faltan uno o los dos secrets
  (`ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`). Los dos son obligatorios.
- **Zernio marca el webhook como fallido (403)** → El secreto no coincide, o el
  deploy con el secret nuevo todavía no terminó. Revisa que sean iguales y
  vuelve a desplegar.
- **No entiende audios/imágenes de WhatsApp** → El proxy de media necesita
  `ZERNIO_API_KEY` **y** `ZERNIO_WEBHOOK_SECRET` configurados. Verifica los dos.
- **"Inbox add-on required" en los logs** → Tu plan de Zernio no tiene el add-on
  de Inbox activo; el envío de respuestas lo requiere.

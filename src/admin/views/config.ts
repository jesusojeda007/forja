// Pro dashboard "Config" tab — a VISUAL CONTROL PANEL for a non-technical owner
// (e.g. a barbershop owner). No raw numbers, no "pick 1-10": every technical
// setting is a group of 2-3 selectable cards (radio + inline SVG icon + short
// label + one-line plain-Spanish description). Text settings are plain inputs /
// textareas with clear labels (no jargon).
//
// La página está dividida en SECCIONES independientes (negocio, comportamiento,
// cobros, modelo de IA), cada una con su propio <form> y botón Guardar. El
// handler POST /admin/config es parcial-safe: guarda solo las llaves que
// llegan en el body, así que cada sección puede postear por su cuenta.
import type { Env } from "../../env";
import { SETTING_KEYS } from "../../db/settings";
import { renderBusinessContext } from "../../businessContext";
import { CURATED_MODELS } from "../../llm/provider";
import {
  CONTROL_LIST,
  valueToLevel,
  type ControlDef,
} from "../control-levels";
import { layout } from "./layout";

/** Escape untrusted text before interpolating it into an HTML attribute/body. */
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

/** Encabezado de sección: chip de icono + título + descripción de una línea. */
function sectionHead(icon: string, title: string, desc: string): string {
  return `
    <div style="display:flex;align-items:flex-start;gap:12px">
      <div style="width:34px;height:34px;flex:none;border-radius:9px;background:var(--accent-soft);display:flex;align-items:center;justify-content:center">
        <i data-lucide="${icon}" width="17" height="17" style="color:var(--accent)"></i>
      </div>
      <div style="min-width:0">
        <h2 class="font-display font-semibold text-[15px] text-cream" style="margin:0">${esc(title)}</h2>
        <p class="text-muted text-[12.5px]" style="margin:3px 0 0;line-height:1.45">${esc(desc)}</p>
      </div>
    </div>`;
}

const SAVE_BTN = `
  <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer"
          style="width:fit-content;background:var(--accent);border:1px solid var(--accent);color:#ffffff;padding:10px 20px;display:flex;align-items:center;gap:8px">
    <i data-lucide="check" width="15" height="15"></i> Guardar cambios
  </button>`;

// Brand accent = emerald (modern light theme). The selected card lights up
// accent; the hidden radio drives the highlight via Tailwind's `peer`
// utilities so the whole card is clickable (it's a <label>).
const CARD_BASE =
  "peer-checked:border-accent peer-checked:bg-accent-soft " +
  "peer-checked:[&_.card-icon]:text-accent peer-checked:[&_.card-label]:text-accent " +
  "cfgcard flex flex-col gap-1 h-full border border-line bg-panel2 p-4 cursor-pointer";

/** Render one card group (radio cards) for a level-based control. */
function renderCardGroup(control: ControlDef, settings: Record<string, string>): string {
  const currentLevel = valueToLevel(control.key, settings[control.key]);
  const cards = control.options
    .map((opt) => {
      const id = `${control.key}__${opt.value}`;
      const checked = opt.label === currentLevel ? "checked" : "";
      return `
        <div class="relative">
          <input type="radio" id="${esc(id)}" name="${esc(control.key)}" value="${esc(opt.value)}"
                 class="peer sr-only absolute" ${checked}>
          <label for="${esc(id)}" class="${CARD_BASE}">
            <span class="card-icon text-dim">${opt.svg}</span>
            <span class="card-label font-display font-semibold text-[12.5px] text-cream">${esc(opt.label)}</span>
            <span class="text-dim text-[11px] leading-snug">${esc(opt.desc)}</span>
          </label>
        </div>`;
    })
    .join("");
  return `
    <fieldset style="display:flex;flex-direction:column;gap:8px;border:none;margin:0;padding:0">
      <legend class="font-display font-semibold text-[13.5px] text-cream">${esc(control.title)}</legend>
      <p class="text-muted text-[12px]">${esc(control.help)}</p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">${cards}</div>
    </fieldset>`;
}

const INPUT_STYLE =
  "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%";

/** Render a labeled single-line text field. */
function renderTextField(opts: {
  name: string;
  label: string;
  help: string;
  value: string;
  placeholder?: string;
}): string {
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label for="${esc(opts.name)}" class="font-display font-semibold text-[12.5px] text-cream">${esc(opts.label)}</label>
      <p class="text-dim text-[11px]">${esc(opts.help)}</p>
      <input type="text" id="${esc(opts.name)}" name="${esc(opts.name)}"
             value="${esc(opts.value)}" placeholder="${esc(opts.placeholder ?? "")}"
             style="${INPUT_STYLE}">
    </div>`;
}

/** Render a labeled multi-line textarea. */
function renderTextArea(opts: {
  name: string;
  label: string;
  help: string;
  value: string;
  placeholder?: string;
  rows?: number;
}): string {
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label for="${esc(opts.name)}" class="font-display font-semibold text-[12.5px] text-cream">${esc(opts.label)}</label>
      <p class="text-dim text-[11px]">${esc(opts.help)}</p>
      <textarea id="${esc(opts.name)}" name="${esc(opts.name)}" rows="${opts.rows ?? 4}"
                placeholder="${esc(opts.placeholder ?? "")}"
                style="${INPUT_STYLE};resize:vertical">${esc(opts.value)}</textarea>
    </div>`;
}

const SELECT_STYLE =
  "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%";

/** Contenido de la sección "Modelo de IA": proveedor + key propia + modelo. */
function renderLlmFields(settings: Record<string, string>): string {
  const provider = settings[SETTING_KEYS.llmProvider] ?? "";
  const model = settings[SETTING_KEYS.llmModel] ?? "";
  const hasKey = (settings[SETTING_KEYS.llmApiKey] ?? "").trim() !== "";
  const keyTail = hasKey ? (settings[SETTING_KEYS.llmApiKey] ?? "").trim().slice(-4) : "";

  const providerOpts = [
    { v: "", l: "Automático (recomendado)" },
    { v: "anthropic", l: "Claude (Anthropic)" },
    { v: "openai", l: "ChatGPT (OpenAI)" },
    { v: "xai", l: "Grok (xAI)" },
  ]
    .map((o) => `<option value="${o.v}" ${provider === o.v ? "selected" : ""}>${o.l}</option>`)
    .join("");

  const anthropicOpts = CURATED_MODELS.filter((m) => m.provider === "anthropic")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.label)}</option>`)
    .join("");
  const openaiOpts = CURATED_MODELS.filter((m) => m.provider === "openai")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.label)}</option>`)
    .join("");
  const xaiOpts = CURATED_MODELS.filter((m) => m.provider === "xai")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.label)}</option>`)
    .join("");

  return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div style="display:flex;flex-direction:column;gap:6px">
          <label class="font-display font-semibold text-[12.5px] text-cream">Proveedor</label>
          <select name="${SETTING_KEYS.llmProvider}" style="${SELECT_STYLE}">${providerOpts}</select>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label class="font-display font-semibold text-[12.5px] text-cream">Modelo</label>
          <select name="${SETTING_KEYS.llmModel}" style="${SELECT_STYLE}">
            <option value="" ${model === "" ? "selected" : ""}>Automático (rápido ⇄ inteligente)</option>
            <optgroup label="Claude (Anthropic)">${anthropicOpts}</optgroup>
            <optgroup label="ChatGPT (OpenAI)">${openaiOpts}</optgroup>
            <optgroup label="Grok (xAI)">${xaiOpts}</optgroup>
          </select>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <label class="font-display font-semibold text-[12.5px] text-cream">Tu API key (opcional)</label>
        <p class="text-dim text-[11px]">${hasKey ? `Hay una key guardada (termina en …${esc(keyTail)}). Escribe una nueva para reemplazarla, o marca la casilla para quitarla.` : "Pégala aquí para que el consumo se cobre a tu cuenta. Vacío = usar la key incluida del sistema."}</p>
        <input type="password" name="${SETTING_KEYS.llmApiKey}" value="" autocomplete="off"
               placeholder="${hasKey ? "••••••••••••" : "sk-ant-… o sk-…"}" style="${INPUT_STYLE}">
        ${hasKey ? `<label class="text-dim text-[11.5px]" style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" name="llm_api_key_clear" value="1"> Quitar mi API key y volver a la del sistema</label>` : ""}
      </div>
      <a href="/admin/config/llm-test" class="text-[12px] font-display font-semibold"
         style="width:fit-content;border:1px solid var(--line);color:var(--cream);padding:9px 14px;text-decoration:none">⚡ Probar mi configuración (guarda primero)</a>`;
}

/** Banner de resultado de la prueba de conexión BYO-LLM. */
function renderLlmTestBanner(llmTest?: string): string {
  if (llmTest?.startsWith("ok:")) {
    return `<div style="border:1px solid var(--ok);background:rgba(21,128,61,.08);color:var(--ok);padding:9px 12px;font-size:12px;font-weight:600;border-radius:8px">✓ Conexión exitosa — respondió ${esc(llmTest.slice(3))}</div>`;
  }
  if (llmTest?.startsWith("err:")) {
    return `<div style="border:1px solid var(--bad);background:rgba(185,28,28,.06);color:var(--bad);padding:9px 12px;font-size:12px;font-weight:600;border-radius:8px">✕ Falló la prueba: ${esc(llmTest.slice(4, 200))}</div>`;
  }
  return "";
}

/** Card autocontenida del QR de pago: su propio form, se guarda al instante. */
function renderQrUploaderCard(settings: Record<string, string>): string {
  return `
    <div class="bg-panel border border-line rounded-xl" style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="width:34px;height:34px;flex:none;border-radius:9px;background:var(--accent-soft);display:flex;align-items:center;justify-content:center">
            <i data-lucide="qr-code" width="17" height="17" style="color:var(--accent)"></i>
          </div>
          <div>
            <h3 class="font-display font-semibold text-[14px] text-cream" style="margin:0">Tu QR de pago</h3>
            <p class="text-muted text-[12.5px]" style="margin:3px 0 0;line-height:1.45">Sube la foto de tu QR (el de tu banco o wallet). Cuando un cliente quiera pagar, el bot se la manda por el chat. Se guarda al instante — no necesitas el botón Guardar.</p>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        ${settings[SETTING_KEYS.paymentQrUrl]
          ? `<img src="${settings[SETTING_KEYS.paymentQrUrl]}" alt="QR actual" width="96" height="96"
               style="border:1px solid var(--line);border-radius:8px;object-fit:contain;background:#fff;padding:4px">`
          : `<div class="text-dim" style="font-size:12px;width:96px;height:96px;display:flex;align-items:center;justify-content:center;border:1px dashed var(--line);border-radius:8px">sin QR</div>`}
        <form method="POST" action="/admin/config/qr-upload" enctype="multipart/form-data"
              style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <input type="file" name="qr" accept="image/png,image/jpeg,image/webp" required
                 style="font-size:12px;color:var(--muted);max-width:260px">
          <button type="submit" class="ghostbtn" style="background:var(--accent);border:1px solid var(--accent);color:#ffffff;padding:9px 16px;font-size:12.5px;cursor:pointer">
            Subir QR
          </button>
        </form>
      </div>
    </div>`;
}

/**
 * Render the Config tab. Receives the current settings overlay (Record from
 * SettingsRepo.all()). `saved` shows the "Guardado ✓" confirmation banner after
 * a redirect from POST /admin/config?saved=1.
 */
export function renderConfig(
  env: Env,
  settings: Record<string, string>,
  saved = false,
  llmTest?: string,
  err?: string,
): string {
  const cardGroups = CONTROL_LIST.map((c) => renderCardGroup(c, settings)).join("");

  // Este campo escribe la MISMA llave que "Prompt del agente" de Mi Agente →
  // Flujo, donde el textarea viene precargado con el prompt efectivo. Aquí llega
  // vacío, así que hay que decir de frente que lo que se escriba sustituye al
  // prompt completo — no se suma a él.
  const hasPromptOverride = (settings[SETTING_KEYS.systemPromptOverride] ?? "").trim() !== "";

  const savedBanner = saved
    ? `<div style="border:1px solid var(--ok);background:rgba(21,128,61,.08);color:var(--ok);padding:10px 14px;font-size:12.5px;font-weight:600;border-radius:8px">Guardado ✓</div>`
    : "";
  const errBanner = err
    ? `<div style="border:1px solid var(--bad);background:rgba(185,28,28,.06);color:var(--bad);padding:11px 16px;font-size:12.5px;border-radius:8px">${err}</div>`
    : "";

  const sectionCard = (inner: string) =>
    `<div class="bg-panel border border-line rounded-xl" style="padding:20px;display:flex;flex-direction:column;gap:16px">${inner}</div>`;

  const body = `
    <div style="display:flex;flex-direction:column;gap:20px">
      ${savedBanner}
      ${errBanner}

      <!-- ═══ 1 · Tu negocio ═══ -->
      <form method="POST" action="/admin/config" style="display:contents">
      ${sectionCard(`
        ${sectionHead("store", "Tu negocio", `La información de ${esc(env.BUSINESS_NAME)} que el bot usa para responder a tus clientes: horarios, servicios, precios, ubicación.`)}
        ${renderTextField({
          name: SETTING_KEYS.botName,
          label: "Nombre del bot",
          help: "Cómo se presenta su asistente con los clientes.",
          value: settings[SETTING_KEYS.botName] ?? "",
          placeholder: env.BOT_NAME ?? "Mi asistente",
        })}
        ${renderTextArea({
          name: SETTING_KEYS.businessContext,
          label: "Información del negocio",
          help: "Horarios, servicios, precios, ubicación. El bot responde con esto. Editable en vivo — se aplica al guardar, sin re-desplegar.",
          // Pre-llenado: si el panel aún no tiene override, muestra lo que el
          // onboarding cargó en member/config.local (renderBusinessContext) para
          // que el miembro VEA y edite sus horarios aquí desde el día 1.
          value: settings[SETTING_KEYS.businessContext] || renderBusinessContext(),
          placeholder: "Ej. Abrimos lunes a sábado de 9 a 7. Corte $150, barba $100. Estamos en Av. Reforma 123.",
          rows: 6,
        })}
        ${SAVE_BTN}
      `)}
      </form>

      <!-- ═══ 2 · Cómo trabaja tu bot ═══ -->
      <form method="POST" action="/admin/config" style="display:contents">
      ${sectionCard(`
        ${sectionHead("settings-2", "Cómo trabaja tu bot", "Personalidad, velocidad y criterios: qué tan formal habla, qué tan rápido responde y cuándo pasa a un humano.")}
        ${cardGroups}
        ${renderTextField({
          name: SETTING_KEYS.escalationKeywords,
          label: "Palabras que piden un humano",
          help: "Si el cliente escribe alguna, el bot avisa a una persona. Sepárelas con comas.",
          value: settings[SETTING_KEYS.escalationKeywords] ?? "",
          placeholder: "queja, reembolso, hablar con alguien",
        })}
        <input type="hidden" name="blindaje_present" value="1">
        <label style="display:flex;gap:9px;align-items:flex-start;cursor:pointer">
          <input type="checkbox" name="${SETTING_KEYS.blindaje}" value="on" style="margin-top:3px"
                 ${settings[SETTING_KEYS.blindaje] === "on" ? "checked" : ""}>
          <span style="display:flex;flex-direction:column;gap:2px">
            <span class="font-display font-semibold text-[13px] text-cream">Blindaje anti-invento</span>
            <span class="text-dim text-[11.5px]">El bot solo afirma datos (precios, horarios, disponibilidad, políticas) que estén en tu información o tu base de conocimiento. Si no lo sabe, lo confirma contigo en vez de improvisar. Verifica cada respuesta antes de enviarla — un poco más lenta y con un costo mínimo por mensaje.</span>
          </span>
        </label>
        <input type="hidden" name="noshows_present" value="1">
        <label style="display:flex;gap:9px;align-items:flex-start;cursor:pointer">
          <input type="checkbox" name="${SETTING_KEYS.noshows}" value="on" style="margin-top:3px"
                 ${settings[SETTING_KEYS.noshows] === "on" ? "checked" : ""}>
          <span style="display:flex;flex-direction:column;gap:2px">
            <span class="font-display font-semibold text-[13px] text-cream">Recupera no-shows</span>
            <span class="text-dim text-[11.5px]">El bot recuerda cada cita la noche anterior ("¿sigue en pie?") y, si alguien no llega ni avisa, le escribe para reagendar. Necesita que agendes las citas con la herramienta de calendario del bot.</span>
          </span>
        </label>
        <div style="display:flex;flex-direction:column;gap:4px">
          <span class="font-display font-semibold text-[13px] text-cream">Reportes automáticos</span>
          <span class="text-dim text-[11.5px]">Un resumen de tus números (chats, prospectos, temas, horas ahorradas) que te llega solo por Telegram y correo.</span>
          <select name="${SETTING_KEYS.reportes}" style="${SELECT_STYLE}">
            ${["off", "semanal", "diario"]
              .map(
                (v) =>
                  `<option value="${v}" ${(settings[SETTING_KEYS.reportes] || "off") === v ? "selected" : ""}>${
                    { off: "Apagado", semanal: "Semanal (lunes)", diario: "Diario" }[v]
                  }</option>`,
              )
              .join("")}
          </select>
          <button type="submit" formaction="/admin/config/reporte-test" formmethod="POST"
                  class="text-[11px]" style="align-self:flex-start;border:1px solid var(--line);color:var(--cream);padding:5px 10px;cursor:pointer;background:none;margin-top:2px">
            Enviar reporte de prueba ahora
          </button>
        </div>
        <fieldset style="display:flex;flex-direction:column;gap:8px;border:none;margin:0;padding:0">
          <legend class="font-display font-semibold text-[13.5px] text-cream">Avanzado · prompt del agente</legend>
          ${renderTextArea({
            name: SETTING_KEYS.systemPromptOverride,
            label: "Prompt del agente (avanzado)",
            help: hasPromptOverride
              ? "✍ Modo manual: su bot está usando este texto como prompt completo, en lugar del automático. Para verlo entero o volver al automático: Mi Agente → Flujo → Agente."
              : "⚠️ Lo que escriba aquí REEMPLAZA el prompt completo del bot — incluida la información del negocio de arriba, su base de conocimiento y sus reglas de seguridad. No agrega instrucciones: las sustituye. Déjelo vacío para usar el prompt automático. Para editar sobre el prompt real, vaya a Mi Agente → Flujo → Agente.",
            value: settings[SETTING_KEYS.systemPromptOverride] ?? "",
            placeholder:
              "Vacío = el bot usa su prompt automático completo: la información del negocio, su base de conocimiento y sus reglas de seguridad.",
            rows: 4,
          })}
        </fieldset>
        ${SAVE_BTN}
      `)}
      </form>

      <!-- ═══ 3 · Cobros y catálogo ═══ -->
      <div style="display:flex;flex-direction:column;gap:12px">
        ${sectionHead("credit-card", "Cobros y catálogo", "Cómo cobra tu bot y qué vende: tu QR de pago, las instrucciones de pago y los productos que muestra.")}
        ${renderQrUploaderCard(settings)}
        <form method="POST" action="/admin/config" style="display:contents">
        ${sectionCard(`
          ${renderTextArea({
            name: SETTING_KEYS.paymentInstructions,
            label: "Instrucciones de pago",
            help: "Lo que el bot le dice al cliente junto con el QR: cuenta, medios de pago, costos de envío, etc.",
            value: settings[SETTING_KEYS.paymentInstructions] ?? "",
            placeholder: "Escanea con la app de tu banco (cualquier banco sirve). Si pagas contra entrega, avísame.",
            rows: 3,
          })}
          ${renderTextField({
            name: SETTING_KEYS.catalogSourceUrl,
            label: "URL de catálogo (opcional)",
            help: "Si tu tienda ya publica sus productos, pégalos aquí y el bot los lee solo, siempre actualizado. Acepta el /products.json de Shopify, la API de WooCommerce (/wp-json/wc/store/products) o un CSV de Google Sheets publicado.",
            value: settings[SETTING_KEYS.catalogSourceUrl] ?? "",
            placeholder: "https://tu-tienda.com/products.json",
          })}
          ${renderTextField({
            name: SETTING_KEYS.paymentQrUrl,
            label: "URL del QR (opcional, avanzado)",
            help: "Normalmente no lo necesitas: al subir el QR de arriba, esta URL se llena sola. Edítala solo si hospedas la imagen en otro lado.",
            value: settings[SETTING_KEYS.paymentQrUrl] ?? "",
            placeholder: "https://tu-bot.workers.dev/qr?v=...",
          })}
          ${SAVE_BTN}
        `)}
        </form>
      </div>

      <!-- ═══ 4 · Modelo de IA ═══ -->
      <form method="POST" action="/admin/config" style="display:contents">
      ${sectionCard(`
        ${sectionHead("brain", "Modelo de IA", "Qué inteligencia artificial usa tu bot. Puedes usar tu propia API key para pagar tú el consumo directamente. En automático, el bot usa la configuración incluida (rápido para lo simple, inteligente para lo difícil).")}
        ${renderLlmTestBanner(llmTest)}
        ${renderLlmFields(settings)}
        ${SAVE_BTN}
      `)}
      </form>
    </div>`;

  return layout({ title: "Config", activeTab: "config", body, env });
}

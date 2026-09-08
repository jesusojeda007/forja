// Un "niche pack" personaliza el bot para un giro (restaurante, inmobiliaria…)
// sin forkear el código: BOT_NICHE elige el pack y éste re-etiqueta el dashboard,
// define columnas propias (que viven en lead.metadata JSON), aporta el playbook
// del giro para el prompt y un tono por defecto. Agregar un nicho = un archivo.

export interface NicheColumn {
  /** Llave dentro de lead.metadata (JSON) de donde sale el valor. */
  key: string;
  /** Encabezado que se muestra en la tabla. */
  label: string;
}

// ─── Reglas del negocio, configurables por rubro ──────────────────────────────
// Cada rubro declara SUS propias reglas (una tienda tiene reglas de envío y
// pago que un consultorio no). El dueño las setea en el panel (Config →
// "Reglas de {rubro}"); se guardan como un solo JSON en settings.store_rules y
// se inyectan al system prompt como <reglas_del_negocio>. Cambiar un valor no
// necesita re-deploy.

export interface NicheRuleOption {
  value: string;
  label: string;
}

export interface NicheRule {
  /** id estable, snake_case. Es la llave dentro del JSON store_rules. */
  key: string;
  /** Etiqueta en el panel. */
  label: string;
  /** Ayuda de una línea bajo la etiqueta (opcional). */
  help?: string;
  /** toggle = Sí/No · select = lista cerrada · text/number = campo libre. */
  type: "toggle" | "select" | "text" | "number";
  /** Solo para type "select": las opciones. */
  options?: NicheRuleOption[];
  /** Placeholder para type "text"/"number". */
  placeholder?: string;
  /**
   * Convierte el valor guardado en una línea para <reglas_del_negocio>.
   * Devuelve null para omitir la regla del prompt (ej. valor vacío). Si no se
   * define, se usa "`${label}: ${valor legible}`".
   */
  toPrompt?: (value: string) => string | null;
}

export interface NicheRuleGroup {
  /** Título del grupo en el panel (ej. "Envío", "Pago"). */
  group: string;
  rules: NicheRule[];
}

/** Pestañas de la página Config (/admin → Configuración). */
export type ConfigTabId = "negocio" | "comportamiento" | "cobros" | "reglas" | "ia";

export interface NichePack {
  /** id estable = valor de BOT_NICHE (ej. "restaurante"). */
  id: string;
  /** Cómo se llama UN registro capturado (singular/plural) — re-etiqueta "Lead". */
  recordSingular: string;
  recordPlural: string;
  /** Item del nav lateral (reemplaza "Leads"). */
  navLabel: string;
  /** Ícono lucide del nav. */
  navIcon: string;
  /** KPI del Resumen (reemplaza "Leads captados"). */
  kpiLabel: string;
  /**
   * Re-etiqueta los 4 estados canónicos del lead para el pipeline del giro.
   * El enum de la columna `status` NO cambia (new|contacted|sold|lost) — solo
   * su presentación, así no hay migración ni se rompe el handler de estados.
   */
  statusLabels: { new: string; contacted: string; sold: string; lost: string };
  /** Columnas extra que se leen de lead.metadata (JSON), en orden. */
  columns: NicheColumn[];
  /** Playbook del giro que rellena {{NICHO_PLAYBOOK}} en el system prompt. */
  playbook: string;
  /** Tono por defecto si el dueño no eligió uno en el panel. */
  defaultTone: string;
  /** Docs de KB sugeridos para el setup del giro. */
  kbDocs: string[];
  /**
   * Reglas del negocio configurables para este rubro, agrupadas. El panel las
   * renderiza en Config y sus valores viven en settings.store_rules (JSON).
   * Vacío/ausente = el rubro no expone reglas estructuradas.
   */
  rules?: NicheRuleGroup[];
  /**
   * Pestañas de Config visibles para este rubro, en orden. "negocio" e "ia" se
   * fuerzan siempre; "reglas" cae si el rubro no define `rules`. Ausente = todas.
   * Ej: un consultorio podría querer ["negocio","comportamiento","ia"] (sin cobros).
   */
  configTabs?: ConfigTabId[];
  /**
   * Herramientas (tools) que este rubro NO ofrece al modelo. Se suman a las que
   * apaga el dueño desde el panel (settings.disabled_tools). Ej: una tienda no
   * agenda citas → ["scheduleAppointment"].
   */
  disabledTools?: string[];
  /**
   * Pestañas del panel /admin que no aplican a este giro (ids del NAV en
   * admin/views/layout.ts). Se combinan con DISABLED_TABS (que siempre gana
   * como override manual del dueño). Vacío = panel completo.
   */
  hiddenTabs: string[];
}

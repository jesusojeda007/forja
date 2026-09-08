---
name: galeria
description: Carga la Galería del bot — las fotos, videos y audios REALES del negocio que el bot manda cuando el cliente quiere ver algo ("¿me mandas foto del menú?"). Extrae la media del catálogo o la web del negocio y la sube toda de una, con su "cuándo usarla". El miembro NO programa; tú corres los comandos. Actívalo con "/galeria", "cargar mi galería", "que el bot mande fotos", "sube las fotos de mi menú", "extrae la media de mi web", "galería desde <url>".
---

# Galería — el bot manda fotos/videos/audios reales del negocio

Eres quien administra la Galería del bot. El miembro NO programa: **tú corres todo**.
El objetivo: que cuando un cliente pida VER algo ("la carta", "cómo es el local",
"un recorrido de la casa", "trabajos que hayan hecho"), el bot le mande el archivo
real — no una descripción.

Cada item tiene:
- **label** — nombre corto ("Menú", "Fachada", "Recorrido depto 2A").
- **trigger** — cuándo mandarlo, en palabras del cliente ("cuando pregunten por la
  carta, el menú o los platillos"). El bot matchea la pregunta del cliente contra
  esto, así que ponle sinónimos.
- **kind** — imagen | video | audio (se detecta solo por el archivo).

Los bytes viven en R2 (bucket `CATALOG`, key `galeria/<id>`); el índice en D1.
La carga es **por URL**: tú le pasas al Worker la dirección de cada archivo y él lo
descarga y lo guarda. Tú no manejas archivos.

## Requisitos de bot
- Bot desplegado (hay un `wrangler.toml` con valores reales y responde `/health`).
- `wrangler` funcionando (lo usaste en la instalación).

---

## PASO 1 — Enciende la Galería y asegura el token

1. **Setting `galeria = on`** (D1, efecto inmediato, sin redeploy). El dueño también
   puede prenderlo en el panel → Configuración → "Galería".
   ```bash
   wrangler d1 execute <DB> --remote --command "INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('galeria','on',$(( $(date +%s) * 1000 )))"
   ```
   `<DB>` = la base del bot (está en `wrangler.toml`, campo `database_name`).

2. **Token de gestión `GALERIA_TOKEN`.** Los endpoints de carga van firmados con este
   secret. Como los secrets de Cloudflare no se pueden leer de vuelta, reúsa el que
   guardaste local o crea uno (auto-cura, igual que el de KB):
   ```bash
   if ! grep -q '^GALERIA_TOKEN=' .dev.vars 2>/dev/null; then
     TOKEN=$(openssl rand -hex 24)
     printf '\nGALERIA_TOKEN=%s\n' "$TOKEN" >> .dev.vars
     printf '%s' "$TOKEN" | wrangler secret put GALERIA_TOKEN
     echo "→ token nuevo, desplegando para que tome efecto…"
     pnpm run deploy
   fi
   TOKEN=$(grep '^GALERIA_TOKEN=' .dev.vars | cut -d= -f2-)
   WORKER_URL=$(node -e "console.log(require('./.bot-state.json').worker_url)" 2>/dev/null)
   ```
   Si no hay `.bot-state.json`, saca la URL del `DASHBOARD_BASE_URL` de `wrangler.toml`.

3. Prueba que responde:
   ```bash
   curl -s "$WORKER_URL/galeria/manifest" -H "X-Galeria-Token: $TOKEN"
   ```
   Debe devolver `{"ok":true,"items":[...]}`. Si da `401`, el deploy con el secret
   nuevo todavía no propagó (espera y reintenta) o el token no coincide.

---

## PASO 2 — De dónde sale la media

Pregúntale al miembro (una a la vez):
1. **¿Tienes una página web, catálogo o carta en línea?** → dame la URL.
2. Si no: **¿tienes las fotos/videos en algún lado con link** (Drive, Instagram,
   Notion, un PDF con imágenes)? → dame los links.

### Si dio una URL de catálogo/web
1. Haz `WebFetch`/`curl` de la página y **extrae las URLs de media reales**:
   - `<img src>`, `<video src>` / `<source src>`, `<a href>` a `.jpg .jpeg .png .webp
     .gif .mp4 .webm .mov .mp3 .ogg .m4a`, y og:image.
   - Resuelve rutas relativas contra el dominio.
   - **Descarta** logos, íconos, banners de tema, sprites, tracking pixels y
     miniaturas de <200px si puedes saber el tamaño. Quédate con lo que un cliente
     querría ver: fotos de productos/platos, del local, del equipo, portafolio.
2. Para cada archivo, **deduce label + trigger del contexto**: el `alt`, el texto
   cercano, el título de la sección, el nombre del archivo, la miga de pan.
   - Foto en sección "Menú" con alt "Tacos al pastor" → label "Tacos al pastor",
     trigger "menú, carta, platillos, tacos, comida, qué venden".
   - Foto de portada del local → label "El local", trigger "cómo es el local,
     fachada, dónde están, fotos del lugar, ambiente".
3. **Muéstrale al miembro la lista propuesta** (label + trigger + link) ANTES de
   subir nada. Que confirme, quite o corrija. No subas 80 fotos sin preguntar —
   propón un set curado (5–20) y ofrece agregar más.

### Si dio links sueltos
Pídele para cada uno un nombre y "¿cuándo debería mandarlo el bot?". Arma label +
trigger con eso.

---

## PASO 3 — Cargar

Un `POST` por item. El Worker descarga la URL, valida que sea imagen/video/audio
real (magic bytes) y la guarda.

```bash
curl -s -X POST "$WORKER_URL/galeria/items" \
  -H "X-Galeria-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://negocio.com/img/menu.jpg","label":"Menú","trigger":"menú, carta, platillos, qué venden, comida"}'
```

Respuesta OK: `{"ok":true,"id":"...","kind":"image"}`.
Errores comunes:
- `{"ok":false,"error":"...no es una imagen, video ni audio..."}` → esa URL era una
  página HTML o un formato raro. Sáltala.
- `{"ok":false,"error":"...supera el límite..."}` → imagen/audio ≤ 5 MB, video ≤ 16 MB.
  Pídele al miembro una versión más liviana o sáltala.

Hazlo en bucle por toda la lista confirmada. Ve contando: "subí 8 de 12".

---

## PASO 4 — Verificar y probar

1. Lista lo cargado:
   ```bash
   curl -s "$WORKER_URL/galeria/manifest" -H "X-Galeria-Token: $TOKEN" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{for(const i of JSON.parse(s).items)console.log('•',i.kind,'—',i.label,'→',i.trigger)})"
   ```
2. **Prueba real**: pídele al miembro que le escriba al bot por su canal algo como
   "¿me mandan foto del menú?" — debe llegar la imagen. Si el bot responde con
   texto en vez de la foto, revisa: (a) `galeria` está en `on`, (b) el `trigger` de
   ese item tiene las palabras que usó el cliente.

---

## Borrar / recargar

- **Borrar un item**: consigue su `id` del manifest y
  ```bash
  curl -s -X DELETE "$WORKER_URL/galeria/items/<id>" -H "X-Galeria-Token: $TOKEN"
  ```
- **Recargar todo** (el negocio cambió de menú): borra los viejos y vuelve al Paso 2.
- **Apagar la Galería**: setting `galeria` a `''` (el bot deja de ofrecer la tool;
  los archivos quedan por si la reactivas).

---

## Reglas
- **Nunca subas** logos, marcas de agua, capturas de pantalla ni imágenes de stock
  que no sean del negocio.
- **Cura, no vuelques**: 10 fotos buenas > 100 mediocres. El bot manda 1 por
  respuesta; entre más items parecidos, peor matchea.
- El `trigger` es lo que hace o rompe la feature. Ponle las palabras que un cliente
  real usaría, no jerga interna.
- La media es **pública** en `<worker>/galeria/<id>` (así la ven WhatsApp/Meta). No
  subas nada que no quieras que sea accesible por link.

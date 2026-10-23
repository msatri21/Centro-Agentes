import {
  depthOf, dotsSvg, figureSvg, fitProjection, iso, lineSvg, pathOf, slabOf, solidSvg,
} from './anatomy/iso-kit.ts'
import type { Plan as Planta, Point3, Projection } from './anatomy/iso-kit.ts'

// La figura del centro, al estilo de anatomy: una mesa de trabajo isométrica.
// Atrás, una columna por trabajador: su altura son los tokens que lleva; brilla y echa chispas mientras trabaja.
// A la izquierda, el director: su altura es el contexto usado. Delante, una bandeja con una pieza por subtarea:
// plana si falta, a media altura si está en curso, alta y encendida si está hecha.

export type Bahia = { nombre: string; modelo?: string; tokens: number; trabajando: boolean }
export type DatosFigura = {
  bahias: Bahia[]
  subtareas: ('pendiente' | 'en_proceso' | 'realizado' | 'solucionado')[]
  /** 0-100 */
  contexto?: number
  titulo: string
  lectura: string
}

export const W = 640
const H = 380
const ALTO_MAX = 90

/** El único color de acento del centro; el resto son grises y negros del kit. */
export const VINO = '#9e2a3a'
// Lleva los acentos del kit (rojo, verde, azul, chispas) al vinotinto.
const ACENTO = `<style>.iso{--anatomy-red:${VINO};--anatomy-green:${VINO};--anatomy-blue:${VINO}}.iso-solid.vino>.iso-edge{stroke:${VINO}}.iso-dots[data-tone="hi"] circle[data-pulse]{fill:${VINO}}.iso-face-text[data-tone="vino"]{fill:${VINO}}.vino-fill{fill:${VINO}}</style>`

export const corto = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)

export const texto = (x: number, y: number, t: string, clase = 'iso-face-text', tono = 'mid', tam = 9, ancla = 'middle') =>
  `<text class="${clase}" data-tone="${tono}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${tam}" text-anchor="${ancla}">${t
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`

export const marco = (h: number, fig: string, titulo: string, pie: string, lectura: string) => [
  ACENTO,
  `<rect x="1" y="1" width="${W - 2}" height="${h - 2}" fill="var(--anatomy-card)" stroke="var(--anatomy-mid)" stroke-width="1"/>`,
  texto(16, 22, fig, 'iso-face-text', 'hi', 10, 'start'),
  texto(W - 16, 22, titulo.toUpperCase(), 'iso-face-text', 'mid', 9, 'end'),
  texto(16, h - 14, pie, 'iso-face-text', 'lo', 8, 'start'),
  texto(W - 16, h - 14, lectura, 'iso-face-text', 'hi', 10, 'end'),
]

export function figura(d: DatosFigura): string {
  const n = Math.max(1, d.subtareas.length)
  const mesa: Planta = { x: 0, y: 0, w: 320, d: 200, r: 8 }
  const caja: Point3[] = [[0, 0, -8], [320, 0, -8], [0, 200, -8], [320, 200, -8], [110, 18, ALTO_MAX + 8], [320, 18, ALTO_MAX + 8]]
  const P: Projection = fitProjection(caja, W, H, { pad: 30, headroom: 20 })

  const piezas: { z: number; svg: string }[] = []
  const poner = (centro: Point3, svg: string) => piezas.push({ z: depthOf(centro, P), svg })

  // Mesa: tablero, faldón y patas.
  const base = solidSvg(slabOf(mesa, -8, 8, P, 8, 0.6), { halo: true })
  const regla: string[] = []
  for (let x = 12; x <= 308; x += 8) {
    const largo = (x - 12) % 40 === 0 ? 5 : 2.5
    regla.push(pathOf([iso([x, 186, 0], P), iso([x, 186 - largo, 0], P)]))
  }

  // Director.
  const dir: Planta = { x: 22, y: 72, w: 46, d: 46, r: 5 }
  const altoDir = 8 + ((d.contexto ?? 0) / 100) * ALTO_MAX
  poner([45, 95, 0], solidSvg(slabOf({ ...dir, x: dir.x - 4, y: dir.y - 4, w: dir.w + 8, d: dir.d + 8 }, 0, 4, P, 8, 0.4), { tone: 'mid' }))
  poner([45, 95, 1], solidSvg(slabOf(dir, 4, altoDir, P, 8, 0.6), { lit: true }))
  const topeDir = iso([45, 95, 4 + altoDir], P)

  // Bahías de trabajadores, al fondo.
  // Escala logarítmica fija hasta 1M tokens: 90 tokens se ven bajos aunque sea el único que trabajó.
  const escala = (t: number) => Math.min(1, Math.log10(t + 1) / 6)
  const cables: string[] = []
  const etiquetas: string[] = []
  // Las bahías se reparten a lo ancho del fondo de la mesa, quepan 3 o 4 agentes.
  const paso = 212 / Math.max(1, d.bahias.length)
  const lado = Math.min(50, paso - 6)
  d.bahias.forEach((b, i) => {
    const x = 104 + i * paso
    const pie: Planta = { x, y: 18, w: lado, d: 50, r: 5 }
    const col: Planta = { x: x + lado * 0.18, y: 27, w: lado * 0.64, d: 32, r: 3 }
    const alto = b.tokens > 0 ? 6 + escala(b.tokens) * (ALTO_MAX - 6) : 2
    const cx = x + lado / 2
    poner([cx, 43, 0], solidSvg(slabOf(pie, 0, 5, P, 8, 0.4), { tone: 'mid' }))
    poner([cx, 43, 1], solidSvg(slabOf(col, 5, alto, P, 8, 0.6), { lit: b.trabajando, tone: b.trabajando ? 'hi' : 'mid', className: b.trabajando ? 'vino' : undefined }))
    if (b.trabajando) {
      const chispas: [number, number][] = []
      for (let k = 0; k < 9; k++) chispas.push(iso([col.x + col.w * (0.2 + (k % 3) * 0.3), col.y + 6 + Math.floor(k / 3) * 10, 5 + alto + 0.2], P))
      poner([cx, 43, 2], dotsSvg(chispas, { size: 1.1, tone: 'hi', pulse: true }))
    }
    // Cable del director a la bahía, sobre la mesa; corre mientras trabaja.
    cables.push(lineSvg(pathOf([iso([68, 95, 0.2], P), iso([90, 95, 0.2], P), iso([90, 80, 0.2], P), iso([cx, 80, 0.2], P), iso([cx, 68, 0.2], P)]), {
      tone: b.trabajando ? 'red' : 'faint', flow: b.trabajando,
    }))
    // Etiqueta grabada en el pie, delante de la columna.
    const [lx, ly] = iso([cx, 68, 0], P)
    etiquetas.push(texto(lx, ly + 14, b.nombre, 'iso-face-text', b.trabajando ? 'vino' : 'mid', 11) + (b.modelo ? texto(lx, ly + 26, corto(b.modelo, 22), 'iso-face-text', 'mid', 8.5) : ''))
  })

  // Bandeja de subtareas, delante; se pinta antes que sus piezas porque todas se apoyan en ella.
  // shortcut: con más de ~40 subtareas las piezas quedan finas como hilos; agruparlas si alguna vez pasa.
  const ancho = Math.max(1, Math.min(22, 200 / n - 4))
  const bandeja: Planta = { x: 100, y: 140, w: 210, d: 40, r: 4 }
  const bandejaSvg = solidSvg(slabOf(bandeja, 0, 3, P, 8, 0.4), { tone: 'mid' })
  const fichas: { z: number; svg: string }[] = []
  d.subtareas.forEach((e, i) => {
    const x = 106 + i * (ancho + 4)
    const alto = e === 'solucionado' ? 18 : e === 'en_proceso' || e === 'realizado' ? 9 : 1.5
    const pieza: Planta = { x, y: 148, w: ancho, d: 24, r: 2 }
    const c: Point3 = [x + ancho / 2, 160, 3]
    fichas.push({ z: depthOf(c, P), svg: solidSvg(slabOf(pieza, 3, alto, P, 6, 0.4), { lit: e === 'solucionado', tone: e === 'pendiente' ? 'lo' : 'hi', className: e === 'en_proceso' || e === 'realizado' ? 'vino' : undefined }) })
    if (e === 'en_proceso' || e === 'realizado') fichas.push({ z: depthOf(c, P) + 0.01, svg: dotsSvg([iso([c[0], c[1], 3 + alto + 0.2], P)], { size: 1.4, tone: 'hi', pulse: true }) })
  })
  fichas.sort((a, b) => a.z - b.z)

  piezas.sort((a, b) => a.z - b.z)

  const hechas = d.subtareas.filter(e => e === 'solucionado').length
  const [dx, dy] = iso([45, 120, 0], P)
  const cuerpo = [
    ...marco(H, 'Fig 1', d.titulo, 'DIRECTOR · TRABAJADORES · SUBTAREAS', d.lectura),
    base,
    lineSvg(regla.join(''), { tone: 'faint' }),
    ...cables,
    ...piezas.map(p => p.svg),
    bandejaSvg,
    ...fichas.map(p => p.svg),
    ...etiquetas,
    texto(topeDir[0], topeDir[1] - 8, d.contexto !== undefined ? `${Math.round(d.contexto)}% ctx` : 'ctx', 'iso-face-text', 'hi', 11),
    texto(dx, dy + 16, 'director', 'iso-face-text', 'hi', 11),
    texto(iso([205, 182, 0], P)[0], iso([205, 182, 0], P)[1] + 14, `${hechas}/${d.subtareas.length} subtareas`, 'iso-face-text', 'mid', 11),
  ]
  return figureSvg({ width: W, height: H, label: `${d.titulo}: ${d.lectura}`, body: cuerpo, standalone: true })
}

export type Controles = {
  clave: string
  cancelables: { id: string; titulo: string }[]
  relanzables: { n: number; titulo: string }[]
  /** El objetivo, cuando todas las subtareas están hechas */
  listo?: string
  /** Qué chat es: carpeta del proyecto y nombre del chat */
  chat?: string
  /** Cifras grandes bajo el título: progreso, agentes trabajando, tokens, ahorro */
  kpis?: { etiqueta: string; valor: string; nota: string }[]
  /** Cada agente: disponible o apartado (hasta cuándo y por qué) */
  agentes?: { nombre: string; ok: boolean; nota: string }[]
  /** Fig 3 (rendimiento por modelo), a todo el ancho bajo las otras dos */
  rendimiento?: string
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// La página web del centro: las dos tarjetas lado a lado (o una encima de otra si la ventana es estrecha).
// Se recarga sola cada `segundos`. Con `controles` lleva los botones (solo funcionan servida por el servidor local)
// y, al terminar todo, un aviso y una notificación del navegador.
export function pagina(figuraSvg: string, tableroSvg: string, titulo: string, segundos = 2, controles?: Controles): string {
  const t = titulo.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const boton = (texto: string, accion: object) => `<button data-accion="${esc(JSON.stringify(accion))}">${esc(texto)}</button>`
  const botones = controles
    ? [
        ...controles.cancelables.map(c => boton(`■ Cancelar ${c.titulo}`, { tipo: 'cancelar', id: c.id })),
        ...controles.relanzables.map(r => boton(`↻ Relanzar ${r.n} · ${r.titulo}`, { tipo: 'relanzar', n: r.n })),
      ].join('')
    : ''
  const listo = controles?.listo ? `<div class="listo">✓ Todo listo · ${esc(controles.listo)}</div>` : ''
  const script = controles
    ? `<script>
const CLAVE=${JSON.stringify(controles.clave)}, LISTO=${JSON.stringify(controles.listo ?? '')};
const servida = location.protocol.startsWith('http');
if (!servida) document.querySelectorAll('#botones').forEach(b => b.remove());
document.querySelectorAll('button[data-accion]').forEach(b => b.onclick = async () => {
  b.disabled = true; b.textContent = 'enviando…';
  // location.search ya lleva la clave y el chat (?t=...&s=...): la orden va a este chat y a ningún otro.
  try { await fetch('/accion' + location.search, { method: 'POST', body: b.dataset.accion }); b.textContent = 'enviado ✓'; }
  catch { b.textContent = 'no se pudo enviar'; }
});
if (LISTO) {
  try {
    if (localStorage.getItem('centro-avisado') !== LISTO) {
      localStorage.setItem('centro-avisado', LISTO);
      if ('Notification' in window) Notification.requestPermission().then(p => { if (p === 'granted') new Notification('Centro de agentes MST', { body: 'Todo listo: ' + LISTO }); });
    }
  } catch {}
}
setTimeout(() => location.reload(), ${segundos * 1000});
</script>`
    : ''
  // Lado a lado, cada tarjeta recibe un ancho proporcional a su relación de aspecto: así las dos miden lo mismo de alto
  // y la figura crece en vez de dejar un hueco debajo.
  const alto = (svg: string) => Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)?.[1] ?? H)
  const columnas = `${(W / alto(figuraSvg)).toFixed(3)}fr ${(W / alto(tableroSvg)).toFixed(3)}fr`
  // Con controles la recarga la hace el script (deja terminar el clic); sin ellos, la etiqueta meta.
  const refresco = controles ? '' : `<meta http-equiv="refresh" content="${segundos}">`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">${refresco}
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${t}</title>
<style>
html,body{margin:0;background:#0a0a0a;color:#a3a3a3;font:15px ui-monospace,Consolas,monospace}
header{max-width:1800px;margin:0 auto;padding:44px 20px 0;box-sizing:border-box}
.rotulo{font:13px ui-monospace,Consolas,monospace;color:#8a8a8a;letter-spacing:.05em;margin:0 0 14px}
h1{font:700 clamp(40px,6vw,84px)/0.95 'Segoe UI',system-ui,-apple-system,sans-serif;letter-spacing:-.03em;color:#f5f5f5;margin:0}
h1 b{color:${VINO};font-weight:700}
.kpis{max-width:1800px;margin:32px auto 0;padding:0 20px;box-sizing:border-box;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.kpi{border-top:1px solid #2a2a2a;border-right:1px solid #1c1c1c;padding:18px 22px 22px}
.kpi:last-child{border-right:none}
.kpi i{display:block;font:normal 12px ui-monospace,Consolas,monospace;color:${VINO};margin-bottom:12px}
.kpi span{display:block;font:15px 'Segoe UI',system-ui,sans-serif;color:#a3a3a3;margin-bottom:6px}
.kpi strong{display:block;font:700 clamp(30px,3.4vw,46px)/1 'Segoe UI',system-ui,sans-serif;color:#f5f5f5;letter-spacing:-.02em}
.kpi small{display:block;font:13px ui-monospace,Consolas,monospace;color:#8a8a8a;margin-top:10px}
#botones{max-width:1800px;margin:0 auto;padding:12px 20px 0;display:flex;flex-wrap:wrap;gap:8px}
#botones:empty{display:none}
button{background:#131313;color:#d4d4d4;border:1px solid #3e3e3e;padding:10px 16px;font:14px ui-monospace,Consolas,monospace;cursor:pointer}
button:hover{border-color:${VINO};color:#fff}
button:disabled{opacity:.6;cursor:default}
.listo{max-width:1800px;margin:12px auto 0;padding:10px 20px;border:1px solid ${VINO};color:#e6e6e6;box-sizing:border-box;width:calc(100% - 40px)}
main{display:grid;grid-template-columns:1fr;gap:24px;padding:32px 20px 28px;max-width:1800px;margin:0 auto;align-items:start}
@media (min-width:1100px){main{grid-template-columns:${columnas}}}
main svg{display:block;width:100%;height:auto}
.agentes{max-width:1800px;margin:18px auto 0;padding:0 20px;box-sizing:border-box;display:flex;flex-wrap:wrap;gap:8px}
.agente{border:1px solid #2a2a2a;padding:8px 14px;font:13px ui-monospace,Consolas,monospace;color:#d4d4d4}
.agente small{color:#8a8a8a;margin-left:8px}
.agente.no{border-color:${VINO}}
.agente.no b{color:${VINO}}
.ancho{max-width:1800px;margin:0 auto;padding:0 20px 28px;box-sizing:border-box}
.ancho svg{display:block;width:100%;max-width:1100px;height:auto}
a{color:#d4d4d4}
a:hover{color:${VINO}}
</style></head><body><header><p class="rotulo">/mst · orquestador de agentes${controles?.chat ? ` · ${esc(controles.chat)}` : ''}${controles ? ` · <a href="/todos?t=${encodeURIComponent(controles.clave)}">todos los chats</a>` : ''}</p><h1>Centro de agentes <b>MST</b></h1></header>${controles?.kpis?.length ? `<section class="kpis">${controles.kpis.map((k, i) => `<div class="kpi"><i>0${i + 1}</i><span>${esc(k.etiqueta)}</span><strong>${esc(k.valor)}</strong><small>${esc(k.nota)}</small></div>`).join('')}</section>` : ''}${listo}${controles?.agentes?.length ? `<section class="agentes">${controles.agentes.map(a => `<span class="agente${a.ok ? '' : ' no'}"><b>${a.ok ? '●' : '○'}</b> ${esc(a.nombre)}<small>${esc(a.nota)}</small></span>`).join('')}</section>` : ''}<div id="botones">${botones}</div><main>${figuraSvg}${tableroSvg}</main>${controles?.rendimiento ? `<section class="ancho">${controles.rendimiento}</section>` : ''}${script}</body></html>`
}

// La tarjeta de detalles (Fig 2): el mismo marco, tipografía y tonos que la figura, en filas de texto mono.
export type Tono = 'hi' | 'mid' | 'lo' | 'vino'
export type Fila = { celdas: string[]; tono: Tono }
export type Seccion = { titulo: string; columnas: number[]; filas: Fila[]; vacio?: string }
export type DatosTablero = {
  titulo: string
  lectura: string
  /** 0-100, la barra de progreso de arriba */
  progreso?: number
  resumen: Fila[]
  /** Una terminal por agente en marcha: su nombre y sus últimas líneas */
  terminales?: { titulo: string; lineas: string[] }[]
  secciones: Seccion[]
}

const LINEAS_TERMINAL = 6
// Letra 11 en la terminal: unos 6,6 de ancho por carácter monoespaciado → caben 86 por línea.
const LETRA_TERMINAL = 11
const ANCHO_TERMINAL = 86

// Parte el texto en líneas que caben en la terminal y se queda con las últimas.
export function colaDeLineas(texto: string, n = LINEAS_TERMINAL, ancho = ANCHO_TERMINAL): string[] {
  const lineas = texto.replace(/\r/g, '').split('\n').flatMap(l => {
    const trozos: string[] = []
    for (let i = 0; i < Math.max(1, l.length); i += ancho) trozos.push(l.slice(i, i + ancho))
    return trozos
  })
  while (lineas.length && !lineas[lineas.length - 1].trim()) lineas.pop()
  return lineas.slice(-n)
}

// Letra de la tarjeta de detalles (13 ≈ 7,8 de ancho por carácter: unos 76 por línea) y su interlineado.
const LETRA = 13
const LETRA_TITULO = 10.5
const LINEA = 21
export const CARACTERES_POR_LINEA = 76

export function tablero(d: DatosTablero): string {
  const partes: string[] = []
  let y = 48
  if (d.progreso !== undefined) {
    // Barra de progreso en segmentos, como una regla del kit: llenos en vinotinto, vacíos en gris.
    const n = 40
    const llenos = Math.round((d.progreso / 100) * n)
    const paso = (W - 32) / n
    for (let i = 0; i < n; i++)
      partes.push(`<rect x="${(16 + i * paso).toFixed(1)}" y="${y - 8}" width="${(paso - 2).toFixed(1)}" height="6" ${i < llenos ? 'class="vino-fill"' : 'fill="var(--anatomy-faint)"'}/>`)
    y += 18
  }
  for (const f of d.resumen) {
    partes.push(texto(16, y, corto(f.celdas.join('  ·  '), CARACTERES_POR_LINEA), 'iso-face-text', f.tono, LETRA, 'start'))
    y += LINEA
  }
  for (const term of d.terminales ?? []) {
    // Caja negra con borde vinotinto: la terminal del agente, con un cursor que parpadea.
    y += 10
    const alto = 34 + LINEAS_TERMINAL * 16
    partes.push(`<rect x="16" y="${y}" width="${W - 32}" height="${alto}" fill="#070707" stroke="${VINO}" stroke-width="1"/>`)
    partes.push(texto(26, y + 20, corto(`● ${term.titulo}`, 80), 'iso-face-text', 'vino', LETRA_TERMINAL, 'start'))
    term.lineas.forEach((l, i) => partes.push(texto(26, y + 40 + i * 16, l, 'iso-face-text', 'hi', LETRA_TERMINAL, 'start')))
    const ultima = term.lineas.length ? term.lineas.length - 1 : 0
    const xCursor = 26 + (term.lineas[ultima]?.length ?? 0) * LETRA_TERMINAL * 0.6 + 2
    partes.push(`<rect class="vino-fill" x="${xCursor.toFixed(1)}" y="${y + 30 + ultima * 16}" width="6" height="12"><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></rect>`)
    y += alto
  }
  for (const s of d.secciones) {
    y += 10
    partes.push(`<path class="iso-line" data-tone="faint" d="M16 ${y - 6}H${W - 16}"/>`)
    y += 10
    partes.push(texto(16, y, s.titulo.toUpperCase(), 'iso-face-text', 'mid', LETRA_TITULO, 'start'))
    y += LINEA
    if (s.filas.length === 0 && s.vacio) {
      partes.push(texto(16, y, s.vacio, 'iso-face-text', 'lo', LETRA, 'start'))
      y += LINEA
    }
    for (const f of s.filas) {
      f.celdas.forEach((c, i) => partes.push(texto(s.columnas[i] ?? 16, y, c, 'iso-face-text', i === 0 ? f.tono : f.tono === 'lo' ? 'lo' : i === f.celdas.length - 1 ? 'mid' : f.tono, LETRA, 'start')))
      y += LINEA
    }
  }
  const h = y + 30
  const cuerpo = [...marco(h, 'Fig 2', d.titulo, 'SUBTAREAS · TRABAJANDO · HISTORIAL', d.lectura), ...partes]
  return figureSvg({ width: W, height: h, label: `Detalles: ${d.lectura}`, body: cuerpo, standalone: true })
}


// Fig 3: rendimiento de cada agente y modelo (nota media sobre 10), con cuántos trabajos hizo y su tiempo medio.
// La barra de mejor nota va en vinotinto; el resto, en gris.
export function grafica(filas: { quien: string; media: number; n: number; segundos: number }[]): string {
  const alto = 30
  const arriba = 62
  const x0 = 220
  const ancho = W - x0 - 160
  const h = arriba + Math.max(1, filas.length) * alto + 40
  const mejor = Math.max(0, ...filas.map(f => f.media))
  const partes: string[] = []
  partes.push(texto(16, 48, 'NOTA MEDIA (0-10)', 'iso-face-text', 'mid', 10.5, 'start'))
  for (let v = 0; v <= 10; v += 5) {
    const x = x0 + (v / 10) * ancho
    partes.push(`<path class="iso-line" data-tone="faint" d="M${x.toFixed(1)} ${arriba - 8}V${h - 40}"/>`)
    partes.push(texto(x, arriba - 12, String(v), 'iso-face-text', 'lo', 10, 'middle'))
  }
  if (!filas.length) partes.push(texto(16, arriba + 20, 'aún no hay trabajos puntuados', 'iso-face-text', 'lo', 13, 'start'))
  filas.forEach((f, i) => {
    const y = arriba + i * alto
    const largo = Math.max(2, (f.media / 10) * ancho)
    const destacada = f.media === mejor
    partes.push(texto(16, y + 18, corto(f.quien, 26), 'iso-face-text', destacada ? 'hi' : 'mid', 12, 'start'))
    partes.push(`<rect x="${x0}" y="${y + 6}" width="${largo.toFixed(1)}" height="16" ${destacada ? 'class="vino-fill"' : 'fill="var(--anatomy-mid)"'}/>`)
    partes.push(texto(x0 + largo + 8, y + 19, f.media.toFixed(1), 'iso-face-text', destacada ? 'vino' : 'hi', 12, 'start'))
    partes.push(texto(W - 16, y + 19, `${f.n} trab · ${f.segundos}s`, 'iso-face-text', 'lo', 10.5, 'end'))
  })
  const cuerpo = [...marco(h, 'Fig 3', 'Rendimiento por modelo', 'NOTA MEDIA · TRABAJOS · TIEMPO MEDIO', `${filas.length} modelos`), ...partes]
  return figureSvg({ width: W, height: h, label: `Rendimiento por modelo: ${filas.map(f => `${f.quien} ${f.media}`).join(', ')}`, body: cuerpo, standalone: true })
}

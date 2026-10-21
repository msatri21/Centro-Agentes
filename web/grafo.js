// El grafo grande del centro: Claude, el jefe, en el centro y, alrededor, un cuadrado punteado por plan con sus subagentes.
// Cada subagente es un nodo pequeño (su nombre y un punto de estado). Al hacer clic se agranda con el modelo, el tiempo y la nota;
// cuando pregunta, pide un permiso o se queda callado se agranda solo y se contesta ahí mismo. Los nodos y los grupos se acomodan
// solos; el lienzo se mueve con el ratón y hace zoom con la rueda.
// Se crea una vez y se actualiza con cada lectura (cada 2 s), sin recargar la página: así las animaciones no se cortan.
import { FASES_PLAN, eventosEntre, gruposDe, rejilla, colocarGrupos, resumenDe } from './grafo-logica.js'

const NS = 'http://www.w3.org/2000/svg'
const el = (tag, attrs, padre) => {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) e.setAttribute(k, attrs[k])
  if (padre) padre.appendChild(e)
  return e
}
const texto = (padre, x, y, s, clase, ancla) => {
  const t = el('text', { x, y, class: clase || '', 'text-anchor': ancla || 'start' }, padre)
  t.textContent = s
  return t
}
const html = (tag, clase, contenido) => {
  const e = document.createElement(tag)
  if (clase) e.className = clase
  if (contenido !== undefined) e.textContent = contenido
  return e
}
const corto = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
// Los tokens se leen como 12k→1k, como en las gráficas de la página.
const miles = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))
const segundos = s => (s >= 120 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`)

const JEFE_R = 86
const INFO = {
  opencode: { nombre: 'OpenCode', rol: 'edita código en su carpeta', info: 'Agente de código: abre, edita y crea archivos. Usa modelos gratis de OpenCode, sin clave.' },
  ollama: { nombre: 'Ollama', rol: 'modelos de texto', info: 'Modelos de texto puros de Ollama: redactan, resumen y analizan. No tocan archivos, así que no se usan para editar ni verificar.' },
  hermes: { nombre: 'Hermes', rol: 'terminal · archivos · web', info: 'Hermes Agent (Nous Research): generalista con sus propias herramientas. Usa modelos gratis de Nous con tu cuenta; puede ejecutar comandos, leer la web y editar archivos.' },
  aider: { nombre: 'Aider', rol: 'programación por parejas', info: 'Aider edita los archivos que nombra la tarea con cambios mínimos y precisos.' },
  codex: { nombre: 'Codex', rol: 'agente de OpenAI', info: 'Codex (OpenAI): edita y ejecuta comandos. Usa el cupo gratis de tu cuenta de ChatGPT.' },
  claude: { nombre: 'Claude headless', corto: 'Claude (sub)', rol: 'último recurso · gasta del plan', info: 'Claude sin interfaz. Solo entra si los agentes gratis rinden claramente peor, con un tope de tokens por chat.' },
}
const nombreDe = a => INFO[a]?.corto ?? INFO[a]?.nombre ?? a
// Las tres alarmas: la etiqueta y lo que se le dice al lector de pantalla.
const ALARMA = {
  silencio: { etiqueta: 'SILENCIO', aviso: 'lleva callado' },
  pregunta: { etiqueta: 'PREGUNTA', aviso: 'necesita tu respuesta' },
  permiso: { etiqueta: 'PERMISO', aviso: 'pide permiso' },
}
// Lo que cuenta la sección "Paso actual" de cada fase del plan.
const TEXTOS_FASE = [
  'Claude arma el plan contigo: divide la tarea en subtareas lo más independientes posible y las registra.',
  'Claude lanza las subtareas a la vez. El centro elige el mejor modelo libre de cada agente según su historial.',
  'Los agentes trabajan, cada uno en su copia o en sus archivos. Si necesitan algo te lo preguntan aquí mismo, en su nodo.',
  'El centro ejecuta los tests y las comprobaciones donde trabajó cada agente.',
  'Claude revisa cada resultado y le pone una nota del 1 al 10; con menos de 6 se rehace.',
  'Claude junta el trabajo de los agentes y cierra lo que falta del plan.',
  'Plan completo: se guarda el informe y recibes el aviso.',
]
const REPOSO = { titulo: 'Esperando una tarea', texto: 'Escribe /mst <tarea> en tu chat: Claude planifica, reparte entre los agentes, verifica y te lo entrega.' }

const NODO = { w: 132, h: 40 }
const CABECERA = 60
const MARGEN = 14
const HUECO = 10

// Enviar a la web lo que el usuario decide: contestar una consulta o cortar un agente (la clave y el chat van en location.search).
export async function enviarRespuesta(consulta, decision, texto) {
  const r = await fetch('/accion' + location.search, { method: 'POST', body: JSON.stringify({ tipo: 'responder', id: consulta, decision, texto }) })
  return r.status
}
export async function cancelarTrabajo(id) {
  const r = await fetch('/accion' + location.search, { method: 'POST', body: JSON.stringify({ tipo: 'cancelar', id }) })
  return r.status
}

export function crearGrafo(montaje) {
  const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches
  montaje.innerHTML = `<div class="lienzo" id="g-lienzo"><svg role="img" aria-label="Grafo animado del Centro de agentes MST: Claude en el centro y, alrededor, un cuadrado por plan con los subagentes que trabajan en él"></svg>
<div class="g-rotulo g-izq">Fig 1 · cómo se hablan los agentes</div><div class="g-rotulo g-der" id="g-vivo">EN REPOSO</div>
<div class="g-controles"><button type="button" data-zoom="mas" aria-label="Acercar">+</button><button type="button" data-zoom="menos" aria-label="Alejar">−</button><button type="button" data-zoom="ajustar">Ajustar</button></div>
<div id="g-alerta" role="status" aria-live="assertive" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden"></div></div>
<div id="g-lista" class="g-lista"></div>
<section class="paso" aria-live="polite"><div><p class="rotulo">Paso actual</p><h2><i id="g-num">REPOSO</i><span id="g-titulo"></span></h2></div>
<div><p id="g-texto"></p><div class="fases" id="g-barra"></div><div class="fases-nombres" id="g-nombres"></div></div></section><div id="g-tip" role="tooltip"></div>`
  const lienzo = montaje.querySelector('#g-lienzo')
  const svg = lienzo.querySelector('svg')
  const tip = montaje.querySelector('#g-tip')
  const rotuloVivo = montaje.querySelector('#g-vivo')
  const alerta = montaje.querySelector('#g-alerta')
  const g = nombre => el('g', { id: nombre }, svg)

  // ---- fondo y capas ----
  const defs = el('defs', {}, svg)
  const flecha = el('marker', { id: 'g-flecha', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs)
  el('path', { d: 'M0 0 L10 5 L0 10 z', fill: '#555' }, flecha)
  const patron = el('pattern', { id: 'g-puntos', width: 28, height: 28, patternUnits: 'userSpaceOnUse' }, defs)
  el('circle', { cx: 1, cy: 1, r: 1, fill: '#1e1e1e' }, patron)
  el('rect', { x: -6000, y: -6000, width: 12000, height: 12000, fill: 'url(#g-puntos)' }, svg)
  const capaAristas = g('g-aristas')
  const capaGrupos = g('g-grupos')
  const capaJefe = g('g-jefe')
  const capaParticulas = g('g-particulas')

  // ---- aristas y partículas ----
  const caminos = {}
  const arista = (id, d, clase, marca) => {
    const p = el('path', { d, class: clase || 'arista' }, capaAristas)
    if (marca) p.setAttribute('marker-end', 'url(#g-flecha)')
    caminos[id] = p
    return p
  }
  const particulas = []
  let reloj = 0
  const GRIS = '#d4d4d4'
  const VINO = '#c4485a'
  const particula = (id, color, dur, radio, reversa) => {
    const camino = caminos[id]
    if (!camino || sinMovimiento) return
    const brillo = el('circle', { r: (radio || 4) * 2.6, fill: color, opacity: 0.18 }, capaParticulas)
    const punto = el('circle', { r: radio || 4, fill: color }, capaParticulas)
    particulas.push({ camino, largo: camino.getTotalLength(), t0: reloj, dur: dur || 1.3, punto, brillo, reversa: !!reversa })
    camino.classList.add('viva')
    setTimeout(() => camino.classList.remove('viva'), (dur || 1.3) * 1000 + 400)
  }
  const retrasar = (s, fn) => setTimeout(fn, s * 1000)

  // ---- tooltips ----
  function ponerTooltip(grupo) {
    const mostrar = (x, y) => {
      tip.innerHTML = ''
      const b = document.createElement('b')
      b.textContent = grupo.dataset.nombre
      tip.append(b, document.createTextNode(grupo.dataset.info))
      tip.style.left = Math.min(x + 16, innerWidth - 340) + 'px'
      tip.style.top = Math.min(y + 16, innerHeight - tip.offsetHeight - 10) + 'px'
      tip.style.opacity = 1
    }
    grupo.addEventListener('mousemove', ev => mostrar(ev.clientX, ev.clientY))
    grupo.addEventListener('mouseleave', () => { tip.style.opacity = 0 })
    grupo.addEventListener('focus', () => { const r = grupo.getBoundingClientRect(); mostrar(r.left, r.bottom) })
    grupo.addEventListener('blur', () => { tip.style.opacity = 0 })
  }
  const info = (grupo, nombre, texto) => { grupo.dataset.nombre = nombre; grupo.dataset.info = texto; grupo.setAttribute('tabindex', '0'); ponerTooltip(grupo) }

  // ---- Claude (el jefe) en el centro y el usuario arriba ----
  const tuY = -214
  const tu = el('g', { class: 'nodo' }, capaJefe)
  el('rect', { x: -75, y: tuY - 32, width: 150, height: 64 }, tu)
  texto(tu, -59, tuY - 10, 'USUARIO', 'etiqueta')
  texto(tu, -59, tuY + 14, 'Tú', 'nombre')
  texto(tu, 59, tuY + 14, 'pides con /mst', 'rol', 'end')
  info(tu, 'Tú', 'Escribes /mst <tarea> en cualquier chat de Claude Code o de OpenCode. Sigues el progreso aquí y recibes el aviso al final.')
  arista('tu-jefe', `M0 ${tuY + 32} L0 ${-JEFE_R - 20}`, 'arista', true)
  texto(capaAristas, 10, tuY + 62, '/mst <tarea>', 'rotulo-arista')

  const jefe = el('g', { class: 'nodo' }, capaJefe)
  el('circle', { cx: 0, cy: 0, r: JEFE_R, class: 'halo' }, jefe)
  el('circle', { cx: 0, cy: 0, r: JEFE_R + 18, class: 'anillo' }, jefe)
  el('circle', { cx: 0, cy: 0, r: JEFE_R, class: 'cuerpo' }, jefe)
  texto(jefe, 0, -18, 'JEFE', 'jefe-sub', 'middle')
  const jefeNombre = texto(jefe, 0, 12, 'Claude', 'jefe-titulo', 'middle')
  texto(jefe, 0, 34, 'planifica · reparte', 'jefe-desc', 'middle')
  texto(jefe, 0, 50, 'verifica · rehace', 'jefe-desc', 'middle')
  info(jefe, 'JEFE', 'No hace el trabajo: lo divide en subtareas, las reparte en paralelo, comprueba cada resultado con una nota del 1 al 10 y manda rehacer lo que saca menos de 6.')
  const contador = texto(capaJefe, 0, JEFE_R + 62, '0', 'contador-agentes', 'middle')
  const contadorTexto = texto(capaJefe, 0, JEFE_R + 84, 'agentes activos', 'rol', 'middle')
  const avisoCambio = texto(capaJefe, 0, JEFE_R + 106, '', 'aviso-falla', 'middle')

  // ---- grupos y nodos (se crean cuando aparecen y se actualizan sin recrearlos) ----
  const gruposDom = new Map()
  const nodosDom = new Map()
  const abiertos = new Set() // nodos que el usuario agrandó con un clic
  let ultimoD = null
  let anterior = null
  const alarmasVistas = new Map()

  // Clic en un nodo: se agranda o se achica. Un arrastre del lienzo no cuenta como clic.
  let arrastrado = false

  function crearGrupo(gr) {
    const grupo = el('g', { class: 'grupo' }, capaGrupos)
    const caja = el('rect', { class: 'caja-grupo', rx: 14 }, grupo)
    const titulo = texto(grupo, 18, 26, '', 'titulo-grupo')
    const cuenta = texto(grupo, 0, 26, '', 'rol', 'end')
    const fase = texto(grupo, 18, 46, '', 'rol')
    const linea = el('path', { class: 'linea-fases' }, grupo)
    const puntos = FASES_PLAN.map((nombre, i) => {
      const p = el('circle', { class: 'punto-fase', r: 4.5 }, grupo)
      p.dataset.nombre = nombre
      p.dataset.info = `Fase ${i + 1} de ${FASES_PLAN.length} de este plan`
      p.setAttribute('tabindex', '0')
      ponerTooltip(p)
      return p
    })
    const etiquetas = FASES_PLAN.map(nombre => texto(grupo, 0, -13, nombre, 'etq-fase', 'middle'))
    const vacio = texto(grupo, 18, CABECERA + 22, 'Sin agentes todavía', 'rol')
    const nodos = el('g', {}, grupo)
    const dom = { grupo, caja, titulo, cuenta, fase, linea, puntos, etiquetas, vacio, nodos }
    gruposDom.set(gr.id, dom)
    return dom
  }

  function crearNodo(dom, t) {
    const pos = el('g', { class: 'nodo-pos' }, dom.nodos)
    const dentro = el('g', { class: 'nodo sub card-entra' }, pos)
    const rect = el('rect', { rx: 9 }, dentro)
    const punto = el('circle', { class: 'punto-estado', r: 5.5, cx: 17, cy: NODO.h / 2 }, dentro)
    const nombre = texto(dentro, 31, NODO.h / 2 + 5, '', 'nombre nombre-sub')
    const insignia = texto(dentro, 0, 15, '', 'insignia', 'end')
    const fo = el('foreignObject', { x: 8, y: 32 }, dentro)
    fo.style.display = 'none'
    const rec = { pos, dentro, rect, punto, nombre, insignia, fo, firma: '', grupoId: dom }
    dentro.addEventListener('click', ev => {
      if (arrastrado || ev.target.closest('.fo-cuerpo')) return
      const abierto = rec.alarma ? true : abiertos.has(t.id)
      if (rec.alarma) return // con una alarma el nodo no se achica
      if (abierto) abiertos.delete(t.id)
      else abiertos.add(t.id)
      if (ultimoD) dibujar(ultimoD)
    })
    setTimeout(() => dentro.classList.remove('card-entra'), 450)
    nodosDom.set(t.id, rec)
    return rec
  }

  // ---- contenido de un nodo agrandado (HTML dentro del SVG) ----
  function enviando(cuerpo, estado, accion) {
    const controles = cuerpo.querySelectorAll('button, textarea')
    controles.forEach(c => { c.disabled = true })
    estado.style.display = 'block'
    estado.textContent = 'enviando…'
    estado.className = 'fo-estado'
    accion().then(
      s => {
        if (s === 200) { estado.textContent = 'enviado ✓'; estado.className = 'fo-estado ok' }
        else if (s === 409) { estado.textContent = 'ya estaba respondida'; estado.className = 'fo-estado aviso' }
        else throw new Error(String(s))
      },
      () => {},
    ).catch(() => {
      estado.textContent = 'no se pudo enviar'
      estado.className = 'fo-estado mal'
      controles.forEach(c => { c.disabled = false })
    })
  }
  const contenidoConsulta = (t, p) => {
    const cuerpo = html('div', 'fo-cuerpo')
    cuerpo.addEventListener('pointerdown', ev => ev.stopPropagation())
    cuerpo.addEventListener('wheel', ev => ev.stopPropagation())
    cuerpo.append(html('p', 'fo-texto', p.texto))
    if (p.detalle) cuerpo.append(html('p', 'fo-detalle', p.detalle))
    const estado = html('div', 'fo-estado')
    estado.style.display = 'none'
    const acciones = html('div', 'fo-acciones')
    const boton = (etiqueta, clase, decision, texto) => {
      const b = html('button', clase, etiqueta)
      b.type = 'button'
      b.addEventListener('click', () => enviando(cuerpo, estado, () => enviarRespuesta(p.consulta, decision, texto)))
      return b
    }
    if (p.tipo === 'permiso') {
      if (p.categoria) cuerpo.append(html('p', 'fo-cat', 'Categoría: ' + p.categoria))
      acciones.append(boton('Aprobar', 'btn-principal', 'aprobar'), boton('Denegar', '', 'denegar'))
      if (p.categoria && p.categoria !== 'destructivo') acciones.append(boton('Permitir siempre', 'btn-principal', 'siempre'))
      cuerpo.append(acciones)
      if (!p.categoria || p.categoria === 'destructivo') cuerpo.append(html('p', 'fo-nota', 'Lo destructivo siempre se pregunta.'))
    } else {
      if (p.opciones?.length) {
        const ops = html('div', 'fo-acciones')
        for (const o of p.opciones) ops.append(boton(o, '', 'texto', o))
        cuerpo.append(ops)
      }
      const ta = html('textarea')
      ta.rows = 2
      ta.placeholder = 'Tu respuesta… (Ctrl+Enter envía)'
      const enviar = html('button', 'btn-principal', 'Enviar')
      enviar.type = 'button'
      const mandar = () => {
        const v = ta.value.trim()
        if (v) enviando(cuerpo, estado, () => enviarRespuesta(p.consulta, 'texto', v))
      }
      enviar.addEventListener('click', mandar)
      ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); mandar() } })
      cuerpo.append(ta)
      acciones.append(enviar)
      cuerpo.append(acciones)
    }
    cuerpo.append(estado)
    return cuerpo
  }
  const contenidoSilencio = t => {
    const cuerpo = html('div', 'fo-cuerpo')
    cuerpo.addEventListener('pointerdown', ev => ev.stopPropagation())
    const aviso = html('p', 'fo-texto', `Lleva ${segundos(t.callado ?? t.segundos)} sin escribir.`)
    aviso.dataset.silencio = '1'
    cuerpo.append(aviso, html('p', 'fo-nota', 'Si no responde, el centro puede probar con otro modelo.'))
    const estado = html('div', 'fo-estado')
    estado.style.display = 'none'
    const acciones = html('div', 'fo-acciones')
    const b = html('button', 'btn-principal', 'Cancelar')
    b.type = 'button'
    b.addEventListener('click', () => enviando(cuerpo, estado, () => cancelarTrabajo(t.id)))
    acciones.append(b)
    cuerpo.append(acciones, estado)
    return cuerpo
  }
  const contenidoDetalles = t => {
    const cuerpo = html('div', 'fo-cuerpo')
    const fila = (k, v) => {
      const f = html('div', 'fo-fila')
      f.append(html('span', 'fo-k', k), html('span', 'fo-v', v))
      cuerpo.append(f)
    }
    fila('Modelo', t.modelo || '—')
    fila(t.estado === 'corriendo' ? 'Lleva' : 'Tardó', segundos(t.segundos))
    if (t.puntaje !== undefined) fila('Nota', `${t.puntaje}/10`)
    if (t.tokensIn !== undefined) fila('Tokens', `${miles(t.tokensIn)}→${miles(t.tokensOut ?? 0)}`)
    if (t.subtarea !== undefined) fila('Subtarea', `#${t.subtarea}${t.titulo ? ' · ' + corto(t.titulo, 28) : ''}`)
    const ultima = t.lineas?.length ? t.lineas[t.lineas.length - 1] : ''
    if (ultima) cuerpo.append(html('div', 'fo-salida', corto(ultima, 60)))
    return { cuerpo, filas: cuerpo.childElementCount }
  }

  // Qué lleva un nodo ahora: su forma (cerrado, detalles o una alarma) y el tamaño que le toca.
  function formaDe(t, pend) {
    if (t.alarma === 'pregunta' && pend) return { tipo: 'pregunta', w: 274, h: pend.opciones?.length ? 256 : 214 }
    if (t.alarma === 'permiso' && pend) return { tipo: 'permiso', w: 274, h: pend.detalle || pend.categoria ? 214 : 184 }
    if (t.alarma === 'silencio') return { tipo: 'silencio', w: 250, h: 140 }
    if (abiertos.has(t.id)) {
      // Cada dato ocupa una fila; el modelo, la subtarea y la última línea de salida pueden dar una segunda línea.
      const filas = 2 + (t.puntaje !== undefined ? 1 : 0) + (t.tokensIn !== undefined ? 1 : 0) + (t.subtarea !== undefined ? 1 : 0)
      const subLargo = t.subtarea !== undefined && `#${t.subtarea}${t.titulo ? ' · ' + corto(t.titulo, 28) : ''}`.length > 21
      return { tipo: 'detalles', w: 250, h: 50 + 25 * filas + ((t.modelo || '').length > 21 ? 18 : 0) + (subLargo ? 18 : 0) + (t.lineas?.length ? 40 : 0) }
    }
    return { tipo: 'cerrado', w: NODO.w, h: NODO.h }
  }

  // ---- pan y zoom del lienzo ----
  const vista = { cx: 0, cy: 0, escala: 1 }
  let manual = false
  let cajaAjuste = null
  const tam = () => ({ W: lienzo.clientWidth || 1000, H: lienzo.clientHeight || 700 })
  function aplicarVista() {
    const { W, H } = tam()
    const w = W / vista.escala
    const h = H / vista.escala
    svg.setAttribute('viewBox', `${vista.cx - w / 2} ${vista.cy - h / 2} ${w} ${h}`)
  }
  function ajustar(caja) {
    const { W, H } = tam()
    const cw = caja.x1 - caja.x0
    const ch = caja.y1 - caja.y0
    vista.escala = Math.max(0.2, Math.min(W / cw, H / ch, 1.25))
    vista.cx = (caja.x0 + caja.x1) / 2
    vista.cy = (caja.y0 + caja.y1) / 2
    aplicarVista()
  }
  const aMundo = (px, py) => {
    const r = svg.getBoundingClientRect()
    const { W, H } = tam()
    return { x: vista.cx + (px - r.left - r.width / 2) / vista.escala * (W / r.width), y: vista.cy + (py - r.top - r.height / 2) / vista.escala * (H / r.height) }
  }
  function zoom(factor, px, py) {
    const antes = aMundo(px, py)
    vista.escala = Math.min(3, Math.max(0.2, vista.escala * factor))
    const despues = aMundo(px, py)
    vista.cx += antes.x - despues.x
    vista.cy += antes.y - despues.y
    manual = true
    aplicarVista()
  }
  lienzo.addEventListener('wheel', ev => {
    ev.preventDefault()
    zoom(Math.exp(-ev.deltaY * 0.0015), ev.clientX, ev.clientY)
  }, { passive: false })
  let pulsado = null
  lienzo.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 || ev.target.closest('.g-controles, .fo-cuerpo')) return
    pulsado = { x: ev.clientX, y: ev.clientY, cx: vista.cx, cy: vista.cy }
    arrastrado = false
  })
  window.addEventListener('pointermove', ev => {
    if (!pulsado) return
    const dx = ev.clientX - pulsado.x
    const dy = ev.clientY - pulsado.y
    if (!arrastrado && Math.hypot(dx, dy) < 5) return
    if (!arrastrado) { arrastrado = true; lienzo.classList.add('moviendo'); tip.style.opacity = 0 }
    vista.cx = pulsado.cx - dx / vista.escala
    vista.cy = pulsado.cy - dy / vista.escala
    manual = true
    aplicarVista()
  })
  window.addEventListener('pointerup', () => {
    pulsado = null
    lienzo.classList.remove('moviendo')
    setTimeout(() => { arrastrado = false }, 0)
  })
  lienzo.querySelector('.g-controles').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-zoom]')
    if (!b) return
    const { W, H } = tam()
    const r = lienzo.getBoundingClientRect()
    if (b.dataset.zoom === 'ajustar') { manual = false; if (cajaAjuste) ajustar(cajaAjuste) }
    else zoom(b.dataset.zoom === 'mas' ? 1.25 : 0.8, r.left + W / 2, r.top + H / 2)
  })
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => (manual || !cajaAjuste ? aplicarVista() : ajustar(cajaAjuste))).observe(lienzo)
  aplicarVista()

  // ---- las fases del plan (la sección "Paso actual") ----
  const barra = montaje.querySelector('#g-barra')
  const nombres = montaje.querySelector('#g-nombres')
  FASES_PLAN.forEach(nombre => {
    barra.appendChild(document.createElement('span'))
    const n = document.createElement('div')
    n.textContent = nombre
    nombres.appendChild(n)
  })

  // ---- dibujar: crea lo que falta, mide, coloca y actualiza textos ----
  let firmaCaja = ''
  function dibujar(d) {
    ultimoD = d
    const grupos = gruposDe(d)
    const pend = new Map((d.pendientes ?? []).map(p => [p.id, p]))
    const gruposVivos = new Set()
    const nodosVivos = new Set()

    const medidas = grupos.map(gr => {
      gruposVivos.add(gr.id)
      const dom = gruposDom.get(gr.id) ?? crearGrupo(gr)
      const items = gr.tarjetas.map(t => {
        nodosVivos.add(t.id)
        const rec = nodosDom.get(t.id) ?? crearNodo(dom, t)
        if (rec.pos.parentNode !== dom.nodos) dom.nodos.appendChild(rec.pos)
        const forma = formaDe(t, pend.get(t.id))
        rec.forma = forma
        rec.alarma = t.alarma
        return { w: forma.w, h: forma.h, t, rec }
      })
      const r = rejilla(items.map(i => ({ w: i.w, h: i.h })), { cabecera: CABECERA, margen: MARGEN, hueco: HUECO, anchoMinimo: 276 })
      return { gr, dom, items, r }
    })

    // Lo que ya no está en los datos se quita (con sus aristas).
    for (const [id, dom] of gruposDom) if (!gruposVivos.has(id)) { dom.grupo.remove(); gruposDom.delete(id) }
    for (const [id, rec] of nodosDom) if (!nodosVivos.has(id)) {
      rec.pos.remove(); nodosDom.delete(id); abiertos.delete(id)
      caminos['jefe-' + id]?.remove(); delete caminos['jefe-' + id]
    }

    const col = colocarGrupos(medidas.map(m => ({ id: m.gr.id, w: m.r.w, h: m.r.h, activo: m.gr.activo })), { radio: JEFE_R + 30 })
    const centros = new Map(col.posiciones.map(p => [p.id, p]))

    for (const { gr, dom, items, r } of medidas) {
      const c = centros.get(gr.id)
      const x0 = c.x - r.w / 2
      const y0 = c.y - r.h / 2
      dom.grupo.setAttribute('transform', `translate(${x0} ${y0})`)
      dom.grupo.setAttribute('class', `grupo${gr.activo ? '' : ' atenuado'}${gr.actual ? ' actual' : ''}`)
      dom.caja.setAttribute('width', r.w)
      dom.caja.setAttribute('height', r.h)
      dom.titulo.textContent = corto(gr.objetivo, Math.max(14, Math.floor((r.w - 130) / 7.6)))
      dom.cuenta.setAttribute('x', r.w - 18)
      dom.cuenta.textContent = `${gr.tarjetas.length} ${gr.tarjetas.length === 1 ? 'agente' : 'agentes'}`
      dom.fase.textContent = `${gr.fase.nombre}${gr.fase.indice === 2 ? ` · ${gr.progreso.hechas}/${gr.progreso.total} subtareas` : ''}`
      // La línea de tiempo va sobre el borde de arriba: los puntos hasta la fase actual se rellenan.
      const xa = 28
      const xb = r.w - 28
      const paso = (xb - xa) / (FASES_PLAN.length - 1)
      dom.puntos.forEach((p, i) => {
        p.setAttribute('cx', xa + paso * i)
        p.setAttribute('cy', 0)
        p.setAttribute('class', `punto-fase ${i < gr.fase.indice ? 'pasada' : i === gr.fase.indice ? 'actual' : 'futura'}`)
        p.setAttribute('r', i === gr.fase.indice ? 6.5 : 4.5)
      })
      dom.linea.setAttribute('d', `M${xa} 0 L${xa + paso * gr.fase.indice} 0`)
      // Con espacio, cada punto lleva el nombre de su fase; si el cuadrado es estrecho, solo se lee en el tooltip y en la segunda línea.
      dom.etiquetas.forEach((e, i) => {
        e.setAttribute('x', xa + paso * i)
        e.style.display = paso >= 64 ? '' : 'none'
        e.setAttribute('class', `etq-fase${i === gr.fase.indice ? ' actual' : ''}`)
      })
      dom.vacio.style.display = items.length ? 'none' : ''
      items.forEach((it, i) => {
        const { t, rec, w, h } = it
        const p = r.posiciones[i]
        rec.pos.setAttribute('transform', `translate(${p.x} ${p.y})`)
        rec.rect.setAttribute('width', w)
        rec.rect.setAttribute('height', h)
        rec.nombre.textContent = corto(nombreDe(t.agente), 13)
        rec.punto.setAttribute('class', `punto-estado ${t.estado === 'corriendo' ? 'trabajando' : t.estado === 'listo' ? 'listo' : 'error'}`)
        rec.insignia.setAttribute('x', w - 10)
        rec.insignia.textContent = t.alarma ? ALARMA[t.alarma].etiqueta : ''
        rec.insignia.setAttribute('class', `insignia${t.alarma === 'pregunta' || t.alarma === 'permiso' ? ' ' + t.alarma : ''}`)
        const clases = ['nodo', 'sub', 'card']
        if (t.estado === 'corriendo') clases.push('activo')
        else if (t.estado === 'listo') clases.push('hecho')
        else clases.push('falla')
        if (t.alarma) clases.push(`alarma-${t.alarma}`)
        if (rec.forma.tipo !== 'cerrado') clases.push('abierto')
        if (rec.dentro.classList.contains('card-entra')) clases.push('card-entra')
        rec.dentro.setAttribute('class', clases.join(' '))
        rec.dentro.dataset.nombre = nombreDe(t.agente)
        rec.dentro.dataset.info = `${INFO[t.agente]?.rol ?? ''} · ${t.estado === 'corriendo' ? 'trabajando' : t.estado === 'listo' ? 'terminó' : 'falló'}${t.titulo ? ' · ' + t.titulo : ''}`
        if (!rec.tip) { rec.tip = true; ponerTooltip(rec.dentro); rec.dentro.setAttribute('tabindex', '0') }
        // El contenido agrandado solo se rehace si cambia la forma o la consulta: así no se pierde lo que se está escribiendo.
        const pe = pend.get(t.id)
        const firma = `${rec.forma.tipo}|${pe?.consulta ?? ''}|${rec.forma.tipo === 'detalles' ? t.segundos + t.estado + (t.puntaje ?? '') + (t.lineas?.[t.lineas.length - 1] ?? '') : ''}`
        if (rec.forma.tipo === 'cerrado') {
          rec.fo.style.display = 'none'
          rec.firma = ''
          if (rec.fo.firstChild) rec.fo.replaceChildren()
        } else {
          rec.fo.style.display = ''
          rec.fo.setAttribute('width', w - 16)
          rec.fo.setAttribute('height', h - 40)
          if (rec.forma.tipo === 'silencio' && rec.firma.startsWith('silencio|')) {
            const aviso = rec.fo.querySelector('[data-silencio]')
            if (aviso) aviso.textContent = `Lleva ${segundos(t.callado ?? t.segundos)} sin escribir.`
          } else if (firma !== rec.firma) {
            rec.firma = firma
            const cuerpo =
              rec.forma.tipo === 'detalles' ? contenidoDetalles(t).cuerpo
              : rec.forma.tipo === 'silencio' ? contenidoSilencio(t)
              : contenidoConsulta(t, pe)
            rec.fo.replaceChildren(cuerpo)
          }
          if (rec.forma.tipo === 'silencio') rec.firma = 'silencio|' + (pe?.consulta ?? '')
        }
        // La arista del jefe a este nodo (del centro de Claude al centro del nodo).
        const nx = x0 + p.x + w / 2
        const ny = y0 + p.y + h / 2
        const dEdge = `M0 0 L${nx} ${ny}`
        if (caminos['jefe-' + t.id]) caminos['jefe-' + t.id].setAttribute('d', dEdge)
        else arista('jefe-' + t.id, dEdge, 'arista')
        caminos['jefe-' + t.id].classList.toggle('tenue', !gr.activo)
      })
    }

    // El jefe, el contador y el rótulo de arriba.
    const todas = grupos.flatMap(gr => gr.tarjetas)
    const resumen = resumenDe(todas)
    const actual = grupos[0]
    const listo = !!actual && actual.fase.indice === FASES_PLAN.length - 1
    jefeNombre.textContent = d.jefe ?? 'Claude'
    contador.textContent = String(resumen.activos)
    contadorTexto.textContent = `${resumen.activos === 1 ? 'agente activo' : 'agentes activos'}${resumen.alarmas ? ` · ⚠ ${resumen.alarmas} ${resumen.alarmas === 1 ? 'alarma' : 'alarmas'}` : ''}`
    contadorTexto.setAttribute('class', `rol${resumen.alarmas ? ' con-alarma' : ''}`)
    jefe.classList.toggle('activo', resumen.activos > 0)
    rotuloVivo.textContent = !grupos.length ? 'EN REPOSO' : listo ? '✓ TODO LISTO' : `${resumen.activos} TRABAJANDO · ${d.jefe ?? 'Claude'} DE JEFE${resumen.alarmas ? ` · ${resumen.alarmas} ${resumen.alarmas === 1 ? 'ALARMA' : 'ALARMAS'}` : ''}`

    // El "Paso actual" cuenta la fase del plan en curso.
    montaje.querySelector('#g-num').textContent = actual ? `FASE ${actual.fase.indice + 1} / ${FASES_PLAN.length}` : 'REPOSO'
    montaje.querySelector('#g-titulo').textContent = actual ? actual.fase.nombre : REPOSO.titulo
    montaje.querySelector('#g-texto').textContent = actual ? TEXTOS_FASE[actual.fase.indice] : REPOSO.texto
    ;[...barra.children].forEach((s, i) => { s.className = actual ? (i < actual.fase.indice ? 'pasada' : i === actual.fase.indice ? 'actual' : '') : '' })

    // En pantallas estrechas el grafo se esconde (CSS) y esta lista cuenta lo mismo: una fila por agente.
    const lista = montaje.querySelector('#g-lista')
    lista.replaceChildren(...todas.map(t => {
      const fila = document.createElement('div')
      fila.className = `g-fila${t.estado === 'corriendo' ? ' activo' : ''}${t.estado === 'error' ? ' falla' : ''}${t.alarma ? ' alarma-' + t.alarma : ''}`
      const estado = t.estado === 'corriendo' ? '● trabajando' : t.estado === 'listo' ? '✓ terminó' : '✗ falló'
      const cab = document.createElement('div')
      cab.className = 'g-cab'
      const nombre = document.createElement('b')
      nombre.textContent = nombreDe(t.agente)
      const st = document.createElement('span')
      st.textContent = `${estado}${t.alarma ? ` · ${ALARMA[t.alarma].etiqueta}` : ''}${t.puntaje !== undefined ? ` · ${t.puntaje}/10` : ''}`
      cab.append(nombre, st)
      const sub = document.createElement('small')
      sub.textContent = corto(`${t.modelo || ''}${t.titulo ? ' · ' + t.titulo : ''}`, 60)
      const pre = document.createElement('pre')
      pre.textContent = (t.lineas ?? []).map(l => corto(l, 48)).join('\n')
      fila.append(cab, sub, pre)
      return fila
    }))

    // Ajustar el encuadre mientras el usuario no haya movido el lienzo.
    const caja = { x0: Math.min(col.caja.x0, -120), y0: Math.min(col.caja.y0, tuY - 60), x1: Math.max(col.caja.x1, 120), y1: Math.max(col.caja.y1, JEFE_R + 120) }
    cajaAjuste = caja
    const f = [caja.x0, caja.y0, caja.x1, caja.y1].map(v => Math.round(v / 20)).join(',')
    if (!manual && f !== firmaCaja) ajustar(caja)
    firmaCaja = f
  }

  // ---- actualizar con una lectura nueva ----
  function actualizar(d) {
    dibujar(d)
    // Eventos: lo que acaba de pasar entre las dos lecturas se ve como partículas.
    for (const ev of eventosEntre(anterior, d)) {
      if (ev.tipo === 'plan') [0, 0.3, 0.6].forEach(r => retrasar(r, () => particula('tu-jefe', GRIS, 1.1)))
      if (ev.tipo === 'encargo' && caminos['jefe-' + ev.id]) particula('jefe-' + ev.id, GRIS, 1.2)
      if (ev.tipo === 'cambio') {
        avisoCambio.textContent = `✗ ${ev.de} falló → pasa a ${ev.agente}`
        avisoCambio.style.opacity = 1
        clearTimeout(actualizar.silenciar)
        actualizar.silenciar = setTimeout(() => { avisoCambio.style.opacity = 0 }, 7000)
      }
      if (ev.tipo === 'resultado') particula('jefe-' + ev.id, ev.ok ? GRIS : VINO, 1.3, 4, true)
      if (ev.tipo === 'nota') particula('jefe-' + ev.id, VINO, 1.3, 4.5, true)
    }
    // Una alarma nueva: una partícula vino hasta el jefe y un aviso para el lector de pantalla.
    const alarmas = new Map()
    for (const gr of gruposDe(d)) for (const t of gr.tarjetas) if (t.alarma) alarmas.set(t.id, { alarma: t.alarma, agente: t.agente })
    for (const [id, a] of alarmas) {
      if (alarmasVistas.get(id) === a.alarma) continue
      alarmasVistas.set(id, a.alarma)
      particula('jefe-' + id, VINO, 1.2, 5, true)
      alerta.textContent = `${nombreDe(a.agente)} ${ALARMA[a.alarma].aviso}`
    }
    for (const id of [...alarmasVistas.keys()]) if (!alarmas.has(id)) alarmasVistas.delete(id)
    anterior = d
  }

  // ---- bucle de animación ----
  let ultimo = performance.now()
  const siguiente = cb => {
    let hecho = false
    const una = t => { if (!hecho) { hecho = true; cb(t) } }
    requestAnimationFrame(una)
    setTimeout(() => una(performance.now()), 100)
  }
  function bucle(ahora) {
    const dt = Math.min(0.1, (ahora - ultimo) / 1000)
    ultimo = ahora
    reloj += dt
    for (let i = particulas.length - 1; i >= 0; i--) {
      const p = particulas[i]
      const t = (reloj - p.t0) / p.dur
      if (t >= 1) { p.punto.remove(); p.brillo.remove(); particulas.splice(i, 1); continue }
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      const pt = p.camino.getPointAtLength((p.reversa ? 1 - e : e) * p.largo)
      p.punto.setAttribute('cx', pt.x)
      p.punto.setAttribute('cy', pt.y)
      p.brillo.setAttribute('cx', pt.x)
      p.brillo.setAttribute('cy', pt.y)
    }
    siguiente(bucle)
  }
  siguiente(bucle)

  return { actualizar }
}

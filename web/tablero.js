// El tablero: un lienzo infinito donde el grafo principal, las tareas del plan y las terminales de cada agente son tarjetas
// que se arrastran, con líneas que las unen. Las tareas cuelgan del jefe; las terminales cuelgan de las tareas.
// Doble clic en una terminal o una tarea abre su detalle en vivo. Arrastrando el punto de una terminal hasta una tarea
// se unen, y entonces puedes escribirle a esa terminal qué quieres que haga de esa tarea.
// Los datos son los mismos del chat (se leen de la página normal cada 2 s).
import { crearGrafo } from './grafo.js'
import { AGENTES, agenteDe, estadoAgente } from './grafo-logica.js'

const NOMBRES = { opencode: 'OpenCode', ollama: 'Ollama', hermes: 'Hermes', aider: 'Aider', codex: 'Codex', claude: 'Claude headless' }
const lienzo = document.getElementById('lienzo')
const mundo = document.getElementById('mundo')
const lineas = document.getElementById('lineas')
const barra = document.getElementById('barra')
const hud = document.getElementById('hud')
const NS = 'http://www.w3.org/2000/svg'
const chat = new URLSearchParams(location.search).get('s') ?? 'sin-chat'
const CLAVE_GUARDADO = `tablero2:${chat}`

// ---------- datos de ejemplo: un plan a medias con todos los estados, para probar el tablero sin trabajo real ----------
function ejemplo(ahora) {
  const t = (id, trabajador, subtarea, estado, hace, ms, extra = {}) => ({ id, trabajador, subtarea, estado, inicio: ahora - hace * 1000, ms: ms && ms * 1000, categoria: 'ejemplo', ...extra })
  const sub = (n, titulo, estado, quien, puntaje, espera) => ({ n, titulo, estado, quien, puntaje, espera })
  return {
    ejemplo: true,
    jefe: 'Claude',
    ahora,
    plan: {
      objetivo: 'Calculadora completa hecha por varios agentes (ejemplo)',
      subtareas: [
        sub(1, 'Función cubo en productos.py', 'hecha', 'opencode:ollama/gpt-oss:120b-cloud', 9),
        sub(2, 'Resumen del README', 'hecha', 'hermes:ollama-local/beam:cloud', 8),
        sub(3, 'Tests de la calculadora', 'en curso', 'aider:ollama_chat/gemma4:31b-cloud'),
        sub(4, 'Función raíz con validación', 'en curso', 'opencode:ollama/gpt-oss:120b-cloud'),
        sub(5, 'Revisar y entregar', 'pendiente', undefined, undefined, [3, 4]),
      ],
    },
    trabajos: [
      t('a', 'opencode:ollama/gpt-oss:120b-cloud', 1, 'listo', 60, 11, { puntaje: 9, tokensIn: 24000, tokensOut: 300, instruccion: 'En productos.py añade una función cubo(x) que devuelva x ** 3. Edita solo productos.py.', salida: '› editando productos.py\n› python test_calc.py\nok: 4 pass' }),
      t('b', 'ollama:gpt-oss:120b-cloud', 2, 'error', 58, 4, { tokensIn: 100, tokensOut: 0, instruccion: 'Resume el README en tres frases.', salida: 'escribiendo…\n✗ 429: sin cupo' }),
      t('e', 'hermes:ollama-local/beam:cloud', 2, 'listo', 52, 13, { puntaje: 8, tokensIn: 52000, tokensOut: 900, instruccion: 'Resume el README en tres frases.\n\nContexto: esto es parte de la subtarea 2 del plan.', salida: '› relevo: subtarea 2\n› leyendo README.md\nok' }),
      t('c', 'aider:ollama_chat/gemma4:31b-cloud', 3, 'corriendo', 14, undefined, { instruccion: 'Escribe tests en test_calc.py para suma, resta, multiplica y divide.', salida: '› test_calc.py\nApplied edit to test_calc.py\nTokens: 1.2k sent' }),
      t('d', 'opencode:ollama/gpt-oss:120b-cloud', 4, 'corriendo', 6, undefined, { instruccion: 'Añade raiz(x) con ValueError si x < 0.', salida: '› rehaciendo raiz()\n› python test_calc.py' }),
    ],
    agentes: ['opencode', 'ollama', 'hermes', 'aider', 'codex', 'claude'].map(n => ({ nombre: n, ok: n !== 'codex', nota: n === 'codex' ? 'sin sesión · usa Ollama' : 'disponible' })),
    modelos: { opencode: ['ollama/gpt-oss:120b-cloud'], ollama: ['gpt-oss:120b-cloud'], hermes: ['ollama-local/gpt-oss:120b-cloud'], aider: ['ollama_chat/gemma4:31b-cloud'], codex: ['chatgpt'], claude: ['haiku'] },
  }
}

// ---------- estado guardado (posiciones, terminales abiertas, enlaces hechos a mano, vista) ----------
let guardado = { vista: { x: 40, y: 70, k: 0.5 }, pos: {}, terminales: [], enlaces: [] }
try {
  guardado = { ...guardado, ...JSON.parse(localStorage.getItem(CLAVE_GUARDADO) ?? '{}') }
} catch {}
const guardar = () => { try { localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(guardado)) } catch {} }
const el = (tag, clase, texto) => { const e = document.createElement(tag); if (clase) e.className = clase; if (texto !== undefined) e.textContent = texto; return e }

// ---------- vista: mover el lienzo y hacer zoom ----------
const vista = guardado.vista
const aMundo = (cx, cy) => [(cx - vista.x) / vista.k, (cy - vista.y) / vista.k]
function aplicarVista() {
  mundo.style.transform = `translate(${vista.x}px, ${vista.y}px) scale(${vista.k})`
  lienzo.style.backgroundSize = `${28 * vista.k}px ${28 * vista.k}px`
  lienzo.style.backgroundPosition = `${vista.x}px ${vista.y}px`
  mundo.classList.toggle('lejos', vista.k < 0.4)
  hud.textContent = `${modoEjemplo ? 'DATOS DE EJEMPLO · ' : ''}zoom ${Math.round(vista.k * 100)}%`
}
lienzo.addEventListener('wheel', ev => {
  ev.preventDefault()
  const k = Math.min(2.5, Math.max(0.12, vista.k * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)))
  vista.x = ev.clientX - ((ev.clientX - vista.x) / vista.k) * k
  vista.y = ev.clientY - ((ev.clientY - vista.y) / vista.k) * k
  vista.k = k
  aplicarVista()
  guardar()
}, { passive: false })
lienzo.addEventListener('pointerdown', ev => {
  if (ev.target !== lienzo && ev.target !== mundo && ev.target !== lineas) return
  lienzo.setPointerCapture(ev.pointerId)
  lienzo.classList.add('arrastrando')
  const inicio = { x: ev.clientX - vista.x, y: ev.clientY - vista.y }
  const mover = e => { vista.x = e.clientX - inicio.x; vista.y = e.clientY - inicio.y; aplicarVista() }
  const soltar = () => { lienzo.classList.remove('arrastrando'); lienzo.removeEventListener('pointermove', mover); lienzo.removeEventListener('pointerup', soltar); guardar() }
  lienzo.addEventListener('pointermove', mover)
  lienzo.addEventListener('pointerup', soltar)
})

// ---------- tarjetas ----------
const tarjetas = new Map() // id → { el, x, y, tipo, ... }
let cima = 10
function crearTarjeta(id, tipo, titulo, inicial, clases = '') {
  const e = el('div', `tarjeta-t ${clases}`)
  const cab = el('div', 'cab')
  const t = el('b', '', titulo)
  const estado = el('span')
  cab.append(t, estado)
  const cuerpo = el('div', 'cuerpo')
  e.append(cab, cuerpo)
  mundo.appendChild(e)
  const p = guardado.pos[id] ?? inicial
  const tar = { id, tipo, el: e, cab, cuerpo, estado, titulo: t, x: p[0], y: p[1] }
  e.style.left = `${tar.x}px`
  e.style.top = `${tar.y}px`
  cab.addEventListener('pointerdown', ev => {
    if (ev.target.closest('button')) return
    ev.preventDefault()
    cab.setPointerCapture(ev.pointerId)
    const o = { x: ev.clientX, y: ev.clientY, tx: tar.x, ty: tar.y }
    e.style.zIndex = String(++cima)
    const mover = m => {
      tar.x = o.tx + (m.clientX - o.x) / vista.k
      tar.y = o.ty + (m.clientY - o.y) / vista.k
      e.style.left = `${tar.x}px`
      e.style.top = `${tar.y}px`
      trazar()
    }
    const soltar = () => { cab.removeEventListener('pointermove', mover); cab.removeEventListener('pointerup', soltar); guardado.pos[id] = [Math.round(tar.x), Math.round(tar.y)]; guardar() }
    cab.addEventListener('pointermove', mover)
    cab.addEventListener('pointerup', soltar)
  })
  // Doble clic: el detalle en vivo de la terminal o de la tarea.
  e.addEventListener('dblclick', ev => {
    if (ev.target.closest('input,button,.puerto')) return
    if (tipo === 'terminal') abrirDetalle({ tipo, clave: tar.agente })
    if (tipo === 'tarea') abrirDetalle({ tipo, clave: tar.n })
  })
  // El punto para unir terminales con tareas.
  if (tipo === 'terminal' || tipo === 'tarea') {
    const puerto = el('div', `puerto ${tipo === 'tarea' ? 'abajo' : 'arriba'}`)
    puerto.title = tipo === 'tarea' ? 'Arrastra hasta una terminal para unirlas' : 'Arrastra hasta una tarea para unirlas'
    puerto.addEventListener('pointerdown', ev => empezarEnlace(ev, tar))
    e.appendChild(puerto)
  }
  tarjetas.set(id, tar)
  return tar
}
const quitar = id => { tarjetas.get(id)?.el.remove(); tarjetas.delete(id) }

// ---------- líneas entre tarjetas ----------
let conexiones = [] // { de, a, vertical?, viva?, clase? }
// El jefe vive dentro del grafo (un SVG): su posición se lee del dibujo, así las líneas lo siguen aunque muevas la tarjeta.
function anclaJefe() {
  const anillo = tarjetas.get('grafo')?.cuerpo.querySelector('.anillo')
  if (!anillo) return null
  const r = anillo.getBoundingClientRect()
  const m = mundo.getBoundingClientRect()
  return { x: (r.left - m.left) / vista.k, y: (r.top - m.top) / vista.k, el: { offsetWidth: r.width / vista.k, offsetHeight: r.height / vista.k } }
}
function borde(tar, lado) {
  const w = tar.el.offsetWidth
  const h = tar.el.offsetHeight
  return lado === 'der' ? [tar.x + w, tar.y + h / 2] : lado === 'izq' ? [tar.x, tar.y + h / 2] : lado === 'abajo' ? [tar.x + w / 2, tar.y + h] : [tar.x + w / 2, tar.y]
}
function trazar() {
  lineas.replaceChildren()
  for (const c of conexiones) {
    const A = c.de === 'jefe' ? anclaJefe() : tarjetas.get(c.de)
    const B = tarjetas.get(c.a)
    if (!A || !B) continue
    const aDerecha = B.x >= A.x + A.el.offsetWidth - 20
    const [x1, y1] = borde(A, c.vertical ? 'abajo' : aDerecha ? 'der' : 'izq')
    const [x2, y2] = borde(B, c.vertical ? 'arriba' : aDerecha ? 'izq' : 'der')
    const dx = c.vertical ? 0 : Math.max(60, Math.abs(x2 - x1) / 2) * (aDerecha ? 1 : -1)
    const dy = c.vertical ? Math.max(40, Math.abs(y2 - y1) / 2) : 0
    const p = document.createElementNS(NS, 'path')
    p.setAttribute('d', `M${x1} ${y1} C ${x1 + dx} ${y1 + dy}, ${x2 - dx} ${y2 - dy}, ${x2} ${y2}`)
    p.setAttribute('class', `${c.clase ?? ''}${c.viva ? ' viva' : ''}`.trim())
    lineas.appendChild(p)
  }
}
setInterval(trazar, 400) // el grafo se mueve solo (animaciones): las líneas del jefe se reajustan

// Unir a mano: se arrastra desde el punto de una tarjeta hasta otra.
function empezarEnlace(ev, origen) {
  ev.stopPropagation()
  ev.preventDefault()
  const temp = document.createElementNS(NS, 'path')
  temp.setAttribute('class', 'temp')
  lineas.appendChild(temp)
  const [x1, y1] = borde(origen, origen.tipo === 'tarea' ? 'abajo' : 'arriba')
  const mover = e => { const [x, y] = aMundo(e.clientX, e.clientY); temp.setAttribute('d', `M${x1} ${y1} L${x} ${y}`) }
  const soltar = e => {
    window.removeEventListener('pointermove', mover)
    temp.remove()
    const destino = [...tarjetas.values()].find(t => t.el === document.elementFromPoint(e.clientX, e.clientY)?.closest('.tarjeta-t'))
    if (destino && destino !== origen && destino.tipo !== origen.tipo && ['tarea', 'terminal'].includes(destino.tipo)) {
      const tarea = origen.tipo === 'tarea' ? origen : destino
      const term = origen.tipo === 'terminal' ? origen : destino
      if (!guardado.enlaces.some(l => l.a === term.agente && l.n === tarea.n)) guardado.enlaces.push({ a: term.agente, n: tarea.n })
      guardar()
      sincronizar()
      term.enviarCaja?.querySelector('input')?.focus()
    }
  }
  window.addEventListener('pointermove', mover)
  window.addEventListener('pointerup', soltar, { once: true })
}

// ---------- contenido de cada tipo de tarjeta ----------
function pintarTerminal(tar, d) {
  const e = estadoAgente(d, tar.agente)
  tar.el.className = `tarjeta-t terminal-t${e.activo ? ' activo' : ''}${e.falla ? ' falla' : ''}${e.apartado ? ' apartado' : ''}${e.hecho && !e.activo ? ' hecha' : ''}`
  tar.estado.textContent = e.apartado ? '○ apartado' : e.activo ? '● trabajando' : e.falla ? '✗ falló' : e.hecho ? '✓ terminó' : 'en espera'
  const info = (d.agentes ?? []).find(a => a.nombre === tar.agente)
  const vivo = tar.vivo
  vivo.replaceChildren()
  const modelo = el('small', '', `${e.apartado || e.modelo || d.modelos?.[tar.agente]?.[0] || ''}${info && !info.ok && !e.apartado ? ` · ${info.nota}` : ''}`)
  const pre = el('pre', '', e.lineas.length ? e.lineas.join('\n') : e.apartado ? '' : '› en espera')
  vivo.append(modelo, pre)
  if (e.ultimo && e.activo && e.ultimo.subtarea !== undefined) vivo.append(el('div', 'estado', `haciendo la tarea ${e.ultimo.subtarea}`))
  if (e.nota !== undefined) vivo.append(el('div', `estado nota${e.nota < 6 ? ' mal' : ''}`, `última nota ${e.nota}/10`))
  if (e.activo && e.ultimo) {
    const b = el('button', 'cancelar', '■ Cancelar')
    b.onclick = () => enviar({ tipo: 'cancelar', id: e.ultimo.id }, b)
    vivo.append(b)
  }
  // Las tareas unidas a esta terminal (con ✕ para soltarlas).
  tar.enlazadas.replaceChildren()
  const mias = guardado.enlaces.filter(l => l.a === tar.agente)
  const subs = d.plan?.subtareas ?? []
  for (const l of mias) {
    const chip = el('span', 'chip')
    chip.append(el('span', '', `→ tarea ${l.n}${subs.find(s => s.n === l.n) ? `: ${subs.find(s => s.n === l.n).titulo.slice(0, 22)}` : ''}`))
    const x = el('button', '', '✕')
    x.title = 'Soltar esta tarea'
    x.onclick = () => { guardado.enlaces = guardado.enlaces.filter(o => o !== l); guardar(); sincronizar() }
    chip.append(x)
    tar.enlazadas.append(chip)
  }
  const input = tar.enviarCaja.querySelector('input')
  input.placeholder = mias.length ? `¿Qué debe hacer ${NOMBRES[tar.agente]} de la tarea ${mias[mias.length - 1].n}?` : 'Une esta terminal a una tarea (arrastra su punto) para escribirle'
  input.disabled = !mias.length
  tar.enviarCaja.querySelector('button').disabled = !mias.length
}
function crearTerminal(a, i) {
  const tar = crearTarjeta(`term-${a}`, 'terminal', NOMBRES[a], [i * 380, TY], 'terminal-t')
  tar.agente = a
  tar.vivo = el('div', 'vivo')
  tar.enlazadas = el('div', 'enlazadas')
  tar.enviarCaja = el('form', 'enviar')
  const input = el('input')
  input.type = 'text'
  input.maxLength = 2000
  const ir = el('button', '', 'Enviar')
  ir.type = 'submit'
  tar.enviarCaja.append(input, ir)
  tar.enviarCaja.addEventListener('submit', async ev => {
    ev.preventDefault()
    const texto = input.value.trim()
    const mias = guardado.enlaces.filter(l => l.a === a)
    if (!texto || !mias.length) return
    const n = mias[mias.length - 1].n
    input.value = ''
    ir.textContent = 'enviado ✓'
    await enviar({ tipo: 'encargar', agente: a, n, texto })
    setTimeout(() => { ir.textContent = 'Enviar' }, 2500)
  })
  tar.cuerpo.append(tar.vivo, tar.enlazadas, tar.enviarCaja)
  return tar
}
function pintarTarea(tar, s) {
  tar.el.className = `tarjeta-t tarea ${s.estado === 'hecha' ? 'hecha' : s.estado === 'en curso' ? 'en-curso' : ''}`
  tar.n = s.n
  tar.estado.textContent = s.estado
  tar.cuerpo.replaceChildren()
  tar.cuerpo.append(el('p', 'titulo', s.titulo), el('div', 'estado', [s.quien ? `con ${s.quien.split(':')[0]}` : 'sin asignar', s.puntaje !== undefined ? `nota ${s.puntaje}/10` : '', s.espera?.length ? `espera a ${s.espera.join(', ')}` : ''].filter(Boolean).join(' · ')))
}

async function enviar(accion, boton) {
  if (modoEjemplo) { if (boton) boton.textContent = 'solo es un ejemplo'; return }
  if (boton) { boton.disabled = true; boton.textContent = 'enviando…' }
  try { await fetch('/accion' + location.search, { method: 'POST', body: JSON.stringify(accion) }) } catch {}
}

// ---------- el panel de detalle (doble clic) ----------
const detalle = el('aside', '')
detalle.id = 'detalle'
document.body.appendChild(detalle)
let abierto = null
function abrirDetalle(que) { abierto = que; pintarDetalle() }
function cerrarDetalle() { abierto = null; detalle.classList.remove('visible') }
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') cerrarDetalle() })
const seg = ms => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${Math.round((ms ?? 0) / 1000)} s`)
function filaTrabajo(t, ahora) {
  const f = el('div', `trabajo${t.estado === 'error' ? ' mal' : ''}`)
  f.append(el('div', 'linea', `${t.estado === 'corriendo' ? '●' : t.estado === 'error' ? '✗' : '✓'} ${t.trabajador}${t.subtarea !== undefined ? ` · tarea ${t.subtarea}` : ''} · ${seg(t.ms ?? ahora - t.inicio)}${t.puntaje !== undefined ? ` · nota ${t.puntaje}/10` : ''}`))
  if (t.instruccion) f.append(el('div', 'rotulo', 'Instrucción'), el('pre', 'instruccion', t.instruccion))
  if (t.salida) f.append(el('div', 'rotulo', t.estado === 'corriendo' ? 'En vivo' : 'Salida'), el('pre', 'salida', t.salida))
  return f
}
function pintarDetalle() {
  const d = ultimo
  if (!abierto || !d) return
  const arriba = detalle.scrollTop
  const alFondo = detalle.scrollHeight - detalle.scrollTop - detalle.clientHeight < 40
  detalle.replaceChildren()
  const cab = el('div', 'cab-detalle')
  const x = el('button', '', '✕')
  x.onclick = cerrarDetalle
  const ahora = d.ahora ?? Date.now()
  if (abierto.tipo === 'terminal') {
    const a = abierto.clave
    const e = estadoAgente(d, a)
    cab.append(el('b', '', `Terminal · ${NOMBRES[a]}`), el('span', '', e.apartado ? '○ apartado' : e.activo ? '● trabajando' : e.falla ? '✗ falló' : e.hecho ? '✓ terminó' : 'en espera'), x)
    detalle.append(cab)
    const subs = d.plan?.subtareas ?? []
    const suyos = d.trabajos.filter(t => agenteDe(t) === a)
    const actual = suyos.filter(t => t.estado === 'corriendo').pop()
    detalle.append(el('div', 'rotulo', 'Qué está ejecutando'))
    if (actual) {
      const s = subs.find(o => o.n === actual.subtarea)
      detalle.append(el('p', 'titulo', s ? `Tarea ${s.n}: ${s.titulo}` : actual.tarea ?? 'Encargo suelto'))
    } else detalle.append(el('p', 'vacio', e.apartado ? e.apartado : 'Nada ahora mismo.'))
    for (const t of [...suyos].reverse().slice(0, 6)) detalle.append(filaTrabajo(t, ahora))
  } else {
    const s = (d.plan?.subtareas ?? []).find(o => o.n === abierto.clave)
    if (!s) { cerrarDetalle(); return }
    cab.append(el('b', '', `Tarea ${s.n}`), el('span', '', s.estado), x)
    detalle.append(cab, el('p', 'titulo', s.titulo))
    detalle.append(el('div', 'estado', [s.quien ? `con ${s.quien}` : 'sin asignar', s.puntaje !== undefined ? `nota ${s.puntaje}/10` : 'sin nota', s.espera?.length ? `espera a ${s.espera.join(', ')}` : 'no espera a nadie'].join(' · ')))
    const suyos = d.trabajos.filter(t => t.subtarea === s.n)
    detalle.append(el('div', 'rotulo', `${suyos.length} intento${suyos.length === 1 ? '' : 's'}`))
    if (!suyos.length) detalle.append(el('p', 'vacio', 'Aún no la ha tomado ningún agente.'))
    for (const t of [...suyos].reverse()) detalle.append(filaTrabajo(t, ahora))
  }
  detalle.classList.add('visible')
  detalle.scrollTop = alFondo && abierto.tipo === 'terminal' && false ? detalle.scrollHeight : arriba
  // Las salidas en vivo se quedan mirando al final.
  detalle.querySelectorAll('pre.salida').forEach(p => { p.scrollTop = p.scrollHeight })
}

// ---------- la barra de abajo ----------
function pintarBarra() {
  barra.replaceChildren()
  const crear = (texto, fn, clase = '') => { const b = el('button', clase, texto); b.onclick = fn; barra.appendChild(b) }
  for (const a of AGENTES) {
    const abierta = guardado.terminales.includes(a)
    crear(`${abierta ? '✓' : '+'} ${NOMBRES[a]}`, () => alternarTerminal(a), abierta ? 'abierto' : '')
  }
  barra.append(el('span', 'sep'))
  crear('+ Todos', () => { guardado.terminales = [...AGENTES]; guardar(); sincronizar() })
  crear(modoEjemplo ? '✓ Ejemplo' : 'Ejemplo', () => { guardado.ejemplo = !guardado.ejemplo; guardar(); ultimo = null; leerYa() }, modoEjemplo ? 'abierto' : '')
  crear('Reordenar', reordenar)
  crear('Centrar', centrar)
  crear('■ Cancelar todo', () => ultimo?.trabajos.filter(t => t.estado === 'corriendo').forEach(t => enviar({ tipo: 'cancelar', id: t.id })))
}
function alternarTerminal(a) {
  guardado.terminales = guardado.terminales.includes(a) ? guardado.terminales.filter(x => x !== a) : [...guardado.terminales, a]
  if (!guardado.terminales.includes(a)) guardado.enlaces = guardado.enlaces.filter(l => l.a !== a)
  guardar()
  sincronizar()
}
function reordenar() {
  guardado.pos = {}
  for (const id of [...tarjetas.keys()]) if (id !== 'grafo') quitar(id)
  guardar()
  sincronizar()
  centrar()
}
function centrar() {
  vista.k = Math.min(1, Math.max(0.2, innerWidth / 2400))
  vista.x = 40
  vista.y = 70
  aplicarVista()
  guardar()
}

// ---------- sincronizar las tarjetas con los datos ----------
let ultimo = null
let modoEjemplo = false
let temporizador
const grafoTar = crearTarjeta('grafo', 'grafo', 'Grafo principal', [0, 0], 'grafo-t')
grafoTar.cuerpo.id = 'grafo-montaje'
const grafo = crearGrafo(grafoTar.cuerpo)
// El tooltip del grafo usa position:fixed, que dentro de un lienzo con transform se descoloca: va al documento.
const tip = grafoTar.cuerpo.querySelector('#g-tip')
if (tip) document.body.appendChild(tip)
// Las tareas cuelgan debajo del grafo, y las terminales debajo de las tareas.
const GH = grafoTar.el.offsetHeight || 900
const FILA_TAREAS = GH + 150
const TY = FILA_TAREAS + 300

function sincronizar() {
  const d = ultimo
  if (!d) return
  const subs = d.plan?.subtareas ?? []
  const ids = new Set(subs.map(s => `tarea-${s.n}`))
  for (const id of [...tarjetas.keys()]) if (id.startsWith('tarea-') && !ids.has(id)) quitar(id)
  subs.forEach((s, i) => {
    const tar = tarjetas.get(`tarea-${s.n}`) ?? crearTarjeta(`tarea-${s.n}`, 'tarea', `Tarea ${s.n}`, [i * 340, FILA_TAREAS])
    pintarTarea(tar, s)
  })
  for (const id of [...tarjetas.keys()]) if (id.startsWith('term-') && !guardado.terminales.includes(id.slice(5))) quitar(id)
  guardado.terminales.forEach((a, i) => {
    const tar = tarjetas.get(`term-${a}`) ?? crearTerminal(a, i)
    pintarTerminal(tar, d)
  })
  // Líneas: el jefe con cada tarea, las dependencias entre tareas, y cada tarea con las terminales que la hacen (o que unió el usuario).
  conexiones = []
  const manual = new Set(guardado.enlaces.map(l => `${l.n}|${l.a}`))
  for (const s of subs) {
    conexiones.push({ de: 'jefe', a: `tarea-${s.n}`, vertical: true, clase: 'jefe' })
    for (const e of s.espera ?? []) conexiones.push({ de: `tarea-${e}`, a: `tarea-${s.n}`, clase: 'dep' })
    const suyos = d.trabajos.filter(t => t.subtarea === s.n)
    const t = suyos[suyos.length - 1]
    if (t) {
      const agente = agenteDe(t)
      if (tarjetas.has(`term-${agente}`) && !manual.has(`${s.n}|${agente}`)) conexiones.push({ de: `tarea-${s.n}`, a: `term-${agente}`, vertical: true, viva: t.estado === 'corriendo' })
    }
  }
  for (const l of guardado.enlaces) if (tarjetas.has(`tarea-${l.n}`) && tarjetas.has(`term-${l.a}`)) conexiones.push({ de: `tarea-${l.n}`, a: `term-${l.a}`, vertical: true, clase: 'manual', viva: estadoAgente(d, l.a).activo })
  trazar()
  pintarBarra()
  pintarDetalle()
}

// ---------- leer los datos del chat ----------
async function leer() {
  clearTimeout(temporizador)
  try {
    const r = await fetch(`/${location.search}`, { cache: 'no-store' })
    if (!r.ok) throw new Error(String(r.status))
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html')
    let datos = JSON.parse(doc.getElementById('datos').textContent)
    // Sin plan real (o si lo pides con el botón), se enseñan datos de ejemplo: ni se mandan órdenes ni se guardan.
    const real = (datos.plan?.subtareas ?? []).length > 0
    if (guardado.ejemplo || !real) datos = ejemplo(Date.now())
    hud.textContent = `${datos.ejemplo ? 'DATOS DE EJEMPLO · ' : ''}zoom ${Math.round(vista.k * 100)}%`
    modoEjemplo = !!datos.ejemplo
    const antes = ultimo
    ultimo = datos
    grafo.actualizar(datos)
    if (!antes && !guardado.terminales.length) guardado.terminales = AGENTES.filter(a => estadoAgente(datos, a).ultimo).slice(0, 4)
    sincronizar()
  } catch {}
  temporizador = setTimeout(leer, 2000)
}
const leerYa = () => leer()
document.getElementById('volver').href = `/${location.search}`
aplicarVista()
pintarBarra()
leer()

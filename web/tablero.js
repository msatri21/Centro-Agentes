// El tablero: un lienzo infinito donde el grafo principal, las terminales de cada agente y las tareas del plan son tarjetas
// que se arrastran, con líneas que las unen. Los datos son los mismos del chat (se leen de la página normal cada 2 s).
import { crearGrafo } from './grafo.js'
import { AGENTES, estadoAgente } from './grafo-logica.js'

const NOMBRES = { opencode: 'OpenCode', ollama: 'Ollama', hermes: 'Hermes', aider: 'Aider', codex: 'Codex', claude: 'Claude headless' }
const lienzo = document.getElementById('lienzo')
const mundo = document.getElementById('mundo')
const lineas = document.getElementById('lineas')
const barra = document.getElementById('barra')
const hud = document.getElementById('hud')
const NS = 'http://www.w3.org/2000/svg'
const chat = new URLSearchParams(location.search).get('s') ?? 'sin-chat'
const CLAVE_GUARDADO = `tablero:${chat}`

// ---------- estado guardado (posiciones, terminales abiertas, vista) ----------
let guardado = { vista: { x: 40, y: 70, k: 0.55 }, pos: {}, terminales: [] }
try {
  guardado = { ...guardado, ...JSON.parse(localStorage.getItem(CLAVE_GUARDADO) ?? '{}') }
} catch {}
const guardar = () => { try { localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(guardado)) } catch {} }

// ---------- vista: mover el lienzo y hacer zoom ----------
const vista = guardado.vista
function aplicarVista() {
  mundo.style.transform = `translate(${vista.x}px, ${vista.y}px) scale(${vista.k})`
  lienzo.style.backgroundSize = `${28 * vista.k}px ${28 * vista.k}px`
  lienzo.style.backgroundPosition = `${vista.x}px ${vista.y}px`
  mundo.classList.toggle('lejos', vista.k < 0.45)
  hud.textContent = `zoom ${Math.round(vista.k * 100)}%`
}
lienzo.addEventListener('wheel', ev => {
  ev.preventDefault()
  const k = Math.min(2.5, Math.max(0.12, vista.k * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)))
  // El punto bajo el cursor se queda donde está.
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
const tarjetas = new Map() // id → { el, x, y, tipo, ...datos }
function crearTarjeta(id, tipo, titulo, inicial, clases = '') {
  const el = document.createElement('div')
  el.className = `tarjeta-t ${clases}`
  const cab = document.createElement('div')
  cab.className = 'cab'
  const t = document.createElement('b')
  t.textContent = titulo
  const estado = document.createElement('span')
  cab.append(t, estado)
  const cuerpo = document.createElement('div')
  cuerpo.className = 'cuerpo'
  el.append(cab, cuerpo)
  mundo.appendChild(el)
  const p = guardado.pos[id] ?? inicial
  const tar = { id, tipo, el, cab, cuerpo, estado, titulo: t, x: p[0], y: p[1] }
  el.style.left = `${tar.x}px`
  el.style.top = `${tar.y}px`
  cab.addEventListener('pointerdown', ev => {
    if (ev.target.closest('button')) return
    ev.preventDefault()
    cab.setPointerCapture(ev.pointerId)
    const o = { x: ev.clientX, y: ev.clientY, tx: tar.x, ty: tar.y }
    el.style.zIndex = String(++cima)
    const mover = e => {
      tar.x = o.tx + (e.clientX - o.x) / vista.k
      tar.y = o.ty + (e.clientY - o.y) / vista.k
      el.style.left = `${tar.x}px`
      el.style.top = `${tar.y}px`
      trazar()
    }
    const soltar = () => { cab.removeEventListener('pointermove', mover); cab.removeEventListener('pointerup', soltar); guardado.pos[id] = [Math.round(tar.x), Math.round(tar.y)]; guardar() }
    cab.addEventListener('pointermove', mover)
    cab.addEventListener('pointerup', soltar)
  })
  tarjetas.set(id, tar)
  return tar
}
let cima = 10
const quitar = id => { tarjetas.get(id)?.el.remove(); tarjetas.delete(id) }

// ---------- líneas entre tarjetas ----------
let conexiones = [] // { de, a, viva }
function borde(tar, lado) {
  const w = tar.el.offsetWidth
  const h = tar.el.offsetHeight
  return lado === 'der' ? [tar.x + w, tar.y + h / 2] : lado === 'izq' ? [tar.x, tar.y + h / 2] : lado === 'abajo' ? [tar.x + w / 2, tar.y + h] : [tar.x + w / 2, tar.y]
}
function trazar() {
  lineas.replaceChildren()
  for (const c of conexiones) {
    const A = tarjetas.get(c.de)
    const B = tarjetas.get(c.a)
    if (!A || !B) continue
    const aDerecha = B.x >= A.x + A.el.offsetWidth - 20
    const [x1, y1] = borde(A, c.vertical ? 'abajo' : aDerecha ? 'der' : 'izq')
    const [x2, y2] = borde(B, c.vertical ? 'arriba' : aDerecha ? 'izq' : 'der')
    const dx = c.vertical ? 0 : Math.max(60, Math.abs(x2 - x1) / 2) * (aDerecha ? 1 : -1)
    const dy = c.vertical ? Math.max(40, Math.abs(y2 - y1) / 2) : 0
    const p = document.createElementNS(NS, 'path')
    p.setAttribute('d', `M${x1} ${y1} C ${x1 + dx} ${y1 + dy}, ${x2 - dx} ${y2 - dy}, ${x2} ${y2}`)
    if (c.viva) p.setAttribute('class', 'viva')
    lineas.appendChild(p)
  }
}

// ---------- contenido de cada tipo de tarjeta ----------
function pintarTerminal(tar, d) {
  const e = estadoAgente(d, tar.agente)
  tar.el.className = `tarjeta-t terminal-t${e.activo ? ' activo' : ''}${e.falla ? ' falla' : ''}${e.apartado ? ' apartado' : ''}${e.hecho && !e.activo ? ' hecha' : ''}`
  tar.estado.textContent = e.apartado ? '○ apartado' : e.activo ? '● trabajando' : e.falla ? '✗ falló' : e.hecho ? '✓ terminó' : 'en espera'
  const info = (d.agentes ?? []).find(a => a.nombre === tar.agente)
  const modelo = e.apartado || e.modelo || d.modelos?.[tar.agente]?.[0] || ''
  const lineasTexto = e.lineas.length ? e.lineas.join('\n') : e.apartado ? '' : '› en espera'
  tar.cuerpo.replaceChildren()
  const small = document.createElement('small')
  small.textContent = `${modelo}${info && !info.ok && !e.apartado ? ` · ${info.nota}` : ''}`
  const pre = document.createElement('pre')
  pre.textContent = lineasTexto
  tar.cuerpo.append(small, pre)
  if (e.nota !== undefined) {
    const n = document.createElement('div')
    n.className = `estado nota${e.nota < 6 ? ' mal' : ''}`
    n.textContent = `última nota ${e.nota}/10`
    tar.cuerpo.append(n)
  }
  if (e.activo && e.ultimo) {
    const b = document.createElement('button')
    b.className = 'cancelar'
    b.textContent = '■ Cancelar'
    b.onclick = () => enviar({ tipo: 'cancelar', id: e.ultimo.id }, b)
    tar.cuerpo.append(b)
  }
}
function pintarTarea(tar, s) {
  tar.el.className = `tarjeta-t tarea ${s.estado === 'hecha' ? 'hecha' : s.estado === 'en curso' ? 'en-curso' : ''}`
  tar.estado.textContent = s.estado
  tar.cuerpo.replaceChildren()
  const t = document.createElement('p')
  t.className = 'titulo'
  t.textContent = s.titulo
  const detalle = document.createElement('div')
  detalle.className = 'estado'
  detalle.textContent = [s.quien ? `con ${s.quien.split(':')[0]}` : 'sin asignar', s.puntaje !== undefined ? `nota ${s.puntaje}/10` : '', s.espera?.length ? `espera a ${s.espera.join(', ')}` : ''].filter(Boolean).join(' · ')
  tar.cuerpo.append(t, detalle)
}

async function enviar(accion, boton) {
  if (boton) { boton.disabled = true; boton.textContent = 'enviando…' }
  try { await fetch('/accion' + location.search, { method: 'POST', body: JSON.stringify(accion) }) } catch {}
}

// ---------- la barra de abajo ----------
const botones = new Map()
function pintarBarra() {
  barra.replaceChildren()
  const crear = (texto, fn, clase = '') => { const b = document.createElement('button'); b.textContent = texto; b.className = clase; b.onclick = fn; barra.appendChild(b); return b }
  for (const a of AGENTES) {
    const abierto = guardado.terminales.includes(a)
    botones.set(a, crear(`${abierto ? '✓' : '+'} ${NOMBRES[a]}`, () => alternarTerminal(a), abierto ? 'abierto' : ''))
  }
  const sep = document.createElement('span'); sep.className = 'sep'; barra.appendChild(sep)
  crear('+ Todos', () => { guardado.terminales = [...AGENTES]; guardar(); sincronizar() })
  crear('Reordenar', reordenar)
  crear('Centrar', centrar)
  crear('■ Cancelar todo', () => ultimo?.trabajos.filter(t => t.estado === 'corriendo').forEach(t => enviar({ tipo: 'cancelar', id: t.id })))
}
function alternarTerminal(a) {
  guardado.terminales = guardado.terminales.includes(a) ? guardado.terminales.filter(x => x !== a) : [...guardado.terminales, a]
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
  vista.k = Math.min(1, Math.max(0.2, innerWidth / 3100))
  vista.x = 40
  vista.y = 70
  aplicarVista()
  guardar()
}

// ---------- sincronizar las tarjetas con los datos ----------
let ultimo = null
const grafoTar = crearTarjeta('grafo', 'grafo', 'Grafo principal', [0, 0], 'grafo-t')
grafoTar.cuerpo.id = 'grafo-montaje'
const grafo = crearGrafo(grafoTar.cuerpo)
// El tooltip del grafo usa position:fixed, que dentro de un lienzo con transform se descoloca: va al documento.
const tip = grafoTar.cuerpo.querySelector('#g-tip')
if (tip) document.body.appendChild(tip)

function sincronizar() {
  const d = ultimo
  if (!d) return
  // Tareas: una tarjeta por subtarea, en columna a la derecha del grafo.
  const subs = d.plan?.subtareas ?? []
  const ids = new Set(subs.map(s => `tarea-${s.n}`))
  for (const id of [...tarjetas.keys()]) if (id.startsWith('tarea-') && !ids.has(id)) quitar(id)
  subs.forEach((s, i) => {
    const id = `tarea-${s.n}`
    const tar = tarjetas.get(id) ?? crearTarjeta(id, 'tarea', `#${s.n}`, [1180, i * 150])
    tar.titulo.textContent = `Tarea ${s.n}`
    pintarTarea(tar, s)
  })
  // Terminales abiertas: una tarjeta por agente.
  for (const id of [...tarjetas.keys()]) if (id.startsWith('term-') && !guardado.terminales.includes(id.slice(5))) quitar(id)
  guardado.terminales.forEach((a, i) => {
    const id = `term-${a}`
    const tar = tarjetas.get(id) ?? crearTarjeta(id, 'terminal', NOMBRES[a], [1540 + (i % 2) * 380, Math.floor(i / 2) * 290])
    tar.agente = a
    pintarTerminal(tar, d)
  })
  // Líneas: dependencias entre tareas, y cada tarea con la terminal del agente que la hace.
  conexiones = []
  for (const s of subs) {
    for (const e of s.espera ?? []) conexiones.push({ de: `tarea-${e}`, a: `tarea-${s.n}`, vertical: true })
    const suyos = d.trabajos.filter(t => t.subtarea === s.n)
    const t = suyos[suyos.length - 1]
    if (t) {
      const agente = String(t.trabajador).split(':')[0]
      if (tarjetas.has(`term-${agente}`)) conexiones.push({ de: `tarea-${s.n}`, a: `term-${agente}`, viva: t.estado === 'corriendo' })
    }
  }
  trazar()
  pintarBarra()
}

// ---------- leer los datos del chat ----------
async function leer() {
  try {
    const r = await fetch(`/${location.search}`, { cache: 'no-store' })
    if (!r.ok) throw new Error(String(r.status))
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html')
    const datos = JSON.parse(doc.getElementById('datos').textContent)
    const antes = ultimo
    ultimo = datos
    grafo.actualizar(datos)
    // Con el plan nuevo se abren solas las terminales de los agentes que ya trabajan, la primera vez.
    if (!antes && !guardado.terminales.length) guardado.terminales = AGENTES.filter(a => estadoAgente(datos, a).ultimo).slice(0, 4)
    sincronizar()
  } catch {}
  setTimeout(leer, 2000)
}
document.getElementById('volver').href = `/${location.search}`
aplicarVista()
pintarBarra()
leer()

// El tablero: un lienzo infinito con piezas sueltas que se arrastran. En el centro, el círculo "Tú", siempre unido al círculo
// "Claude" (el jefe); de Claude salen las tareas y de las tareas las terminales de los agentes.
// Un clic en Tú abre tus ajustes (cuenta, tiempo de sesión, tema y acento); doble clic en el jefe te deja escribirle a la sesión.
// Doble clic en una terminal o una tarea abre su detalle en vivo. Arrastrando el punto de una terminal hasta una tarea se unen,
// y entonces puedes escribirle a esa terminal qué quieres que haga de esa tarea.
// Los datos son los mismos del chat (se leen de la página normal cada 2 s).
import { AGENTES, FASES, agenteDe, estadoAgente, eventosEntre, faseDe } from './grafo-logica.js'

const NOMBRES = { opencode: 'OpenCode', ollama: 'Ollama', hermes: 'Hermes', aider: 'Aider', codex: 'Codex', claude: 'Claude headless' }
const lienzo = document.getElementById('lienzo')
const mundo = document.getElementById('mundo')
const lineas = document.getElementById('lineas')
const barra = document.getElementById('barra')
const hud = document.getElementById('hud')
const NS = 'http://www.w3.org/2000/svg'
const chat = new URLSearchParams(location.search).get('s') ?? 'sin-chat'
const CLAVE_GUARDADO = `tablero3:${chat}`
const CLAVE_AJUSTES = 'tablero-ajustes'
const abiertoEn = Date.now()
const el = (tag, clase, texto) => { const e = document.createElement(tag); if (clase) e.className = clase; if (texto !== undefined) e.textContent = texto; return e }

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
    agentes: AGENTES.map(n => ({ nombre: n, ok: n !== 'codex', nota: n === 'codex' ? 'sin sesión · usa Ollama' : 'disponible' })),
    modelos: { opencode: ['ollama/gpt-oss:120b-cloud'], ollama: ['gpt-oss:120b-cloud'], hermes: ['ollama-local/gpt-oss:120b-cloud'], aider: ['ollama_chat/gemma4:31b-cloud'], codex: ['chatgpt'], claude: ['haiku'] },
  }
}

// ---------- ajustes (tema y acento valen para todos los chats) y estado guardado de este chat ----------
const ACENTOS = {
  vinotinto: ['#9e2a3a', '#c4485a', '#5c1822', 'Vinotinto'],
  azul: ['#1f4e8c', '#4b86d6', '#14305a', 'Azul oscuro'],
  verde: ['#2f7d4f', '#4fb176', '#1d4a2f', 'Verde'],
  amarillo: ['#c9a227', '#e6c55a', '#6b5612', 'Amarillo'],
}
const ajustes = { tema: 'oscuro', acento: 'vinotinto', nombre: '', cuenta: '' }
try { Object.assign(ajustes, JSON.parse(localStorage.getItem(CLAVE_AJUSTES) ?? '{}')) } catch {}
function aplicarAjustes() {
  document.documentElement.dataset.tema = ajustes.tema === 'claro' ? 'claro' : 'oscuro'
  const [a, b, c] = ACENTOS[ajustes.acento] ?? ACENTOS.vinotinto
  const r = document.documentElement.style
  r.setProperty('--acento', a)
  r.setProperty('--acento-claro', b)
  r.setProperty('--acento-oscuro', c)
}
const guardarAjustes = () => { try { localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(ajustes)) } catch {} }
aplicarAjustes()

let guardado = { vista: null, pos: {}, terminales: [], enlaces: [], mensajes: [] }
try { guardado = { ...guardado, ...JSON.parse(localStorage.getItem(CLAVE_GUARDADO) ?? '{}') } } catch {}
const guardar = () => { try { localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(guardado)) } catch {} }

// ---------- vista: mover el lienzo y hacer zoom ----------
const vista = guardado.vista ?? { x: 0, y: 0, k: 0.5 }
let modoEjemplo = false
const aMundo = (cx, cy) => [(cx - vista.x) / vista.k, (cy - vista.y) / vista.k]
function aplicarVista() {
  mundo.style.transform = `translate(${vista.x}px, ${vista.y}px) scale(${vista.k})`
  lienzo.style.backgroundSize = `${28 * vista.k}px ${28 * vista.k}px`
  lienzo.style.backgroundPosition = `${vista.x}px ${vista.y}px`
  mundo.classList.toggle('lejos', vista.k < 0.4)
  hud.textContent = `${modoEjemplo ? 'DATOS DE EJEMPLO · ' : ''}zoom ${Math.round(vista.k * 100)}%`
}
function centrar() {
  // Encuadra todas las piezas en la pantalla (deja sitio arriba para la cabecera y abajo para la barra).
  const ps = [...piezas.values()]
  const x0 = Math.min(...ps.map(p => p.x)), y0 = Math.min(...ps.map(p => p.y))
  const x1 = Math.max(...ps.map(p => p.x + p.el.offsetWidth)), y1 = Math.max(...ps.map(p => p.y + p.el.offsetHeight))
  vista.k = Math.min(1, Math.max(0.15, Math.min((innerWidth - 80) / (x1 - x0), (innerHeight - 200) / (y1 - y0))))
  vista.x = (innerWidth - (x1 - x0) * vista.k) / 2 - x0 * vista.k
  vista.y = 70 + (innerHeight - 200 - (y1 - y0) * vista.k) / 2 - y0 * vista.k
  aplicarVista()
  guardar()
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

// ---------- piezas sueltas ----------
const piezas = new Map() // id → { el, x, y, tipo, ... }
let cima = 10
function crearPieza(id, tipo, clase, inicial) {
  const e = el('div', `pieza ${clase}`)
  mundo.appendChild(e)
  const p = guardado.pos[id] ?? inicial
  const tar = { id, tipo, el: e, x: p[0], y: p[1] }
  e.style.left = `${tar.x}px`
  e.style.top = `${tar.y}px`
  piezas.set(id, tar)
  return tar
}
const quitar = id => { piezas.get(id)?.el.remove(); piezas.delete(id) }
// Arrastrar por el asa; si no se movió, cuenta como clic.
function arrastrable(tar, asa, alClic) {
  asa.addEventListener('pointerdown', ev => {
    if (ev.target.closest('button,input,textarea,.puerto')) return
    ev.preventDefault()
    asa.setPointerCapture(ev.pointerId)
    const o = { x: ev.clientX, y: ev.clientY, tx: tar.x, ty: tar.y }
    let movio = false
    tar.el.style.zIndex = String(++cima)
    const mover = m => {
      if (Math.hypot(m.clientX - o.x, m.clientY - o.y) > 4) movio = true
      tar.x = o.tx + (m.clientX - o.x) / vista.k
      tar.y = o.ty + (m.clientY - o.y) / vista.k
      tar.el.style.left = `${tar.x}px`
      tar.el.style.top = `${tar.y}px`
      trazar()
    }
    const soltar = () => {
      asa.removeEventListener('pointermove', mover)
      asa.removeEventListener('pointerup', soltar)
      if (movio) { guardado.pos[tar.id] = [Math.round(tar.x), Math.round(tar.y)]; guardar() } else alClic?.()
    }
    asa.addEventListener('pointermove', mover)
    asa.addEventListener('pointerup', soltar)
  })
}
// Una pieza con cabecera (título + estado) y cuerpo: las tareas, las terminales y el paso actual.
function conCabecera(tar, titulo) {
  tar.cab = el('div', 'cab')
  tar.titulo = el('b', '', titulo)
  tar.estado = el('span')
  tar.cab.append(tar.titulo, tar.estado)
  tar.cuerpo = el('div', 'cuerpo')
  tar.el.append(tar.cab, tar.cuerpo)
  arrastrable(tar, tar.cab)
  return tar
}
function conPuerto(tar, lado) {
  const puerto = el('div', `puerto ${lado}`)
  puerto.title = lado === 'abajo' ? 'Arrastra hasta una terminal para unirlas' : 'Arrastra hasta una tarea para unirlas'
  puerto.addEventListener('pointerdown', ev => empezarEnlace(ev, tar))
  tar.el.appendChild(puerto)
}

// ---------- líneas y partículas ----------
const gLineas = document.createElementNS(NS, 'g')
const gParticulas = document.createElementNS(NS, 'g')
lineas.append(gLineas, gParticulas)
let conexiones = [] // { de, a, vertical?, subir?, viva?, clase? }
function geometria(c) {
  const A = piezas.get(c.de)
  const B = piezas.get(c.a)
  if (!A || !B) return null
  const w = t => t.el.offsetWidth
  const h = t => t.el.offsetHeight
  let x1, y1, x2, y2, dx = 0, dy = 0
  if (c.vertical || c.subir) {
    const abajo = !c.subir
    x1 = A.x + w(A) / 2; y1 = A.y + (abajo ? h(A) : 0)
    x2 = B.x + w(B) / 2; y2 = B.y + (abajo ? 0 : h(B))
    dy = Math.max(40, Math.abs(y2 - y1) / 2) * (abajo ? 1 : -1)
  } else {
    const der = B.x >= A.x + w(A) - 20
    x1 = A.x + (der ? w(A) : 0); y1 = A.y + h(A) / 2
    x2 = B.x + (der ? 0 : w(B)); y2 = B.y + h(B) / 2
    dx = Math.max(60, Math.abs(x2 - x1) / 2) * (der ? 1 : -1)
  }
  return `M${x1} ${y1} C ${x1 + dx} ${y1 + dy}, ${x2 - dx} ${y2 - dy}, ${x2} ${y2}`
}
function trazar() {
  gLineas.replaceChildren()
  for (const c of conexiones) {
    const d = geometria(c)
    if (!d) continue
    const p = document.createElementNS(NS, 'path')
    p.setAttribute('d', d)
    p.setAttribute('class', `${c.clase ?? ''}${c.viva ? ' viva' : ''}`.trim())
    gLineas.appendChild(p)
  }
}
// Partículas: lo que pasa de verdad (un encargo que sale, un resultado, una nota) viaja por las líneas.
const particulas = []
function particula(c, color, dur = 1.3, r = 5) {
  const d = geometria(c)
  if (!d) return
  const medida = document.createElementNS(NS, 'path')
  medida.setAttribute('d', d)
  medida.style.fill = 'none'
  medida.style.stroke = 'none'
  gParticulas.appendChild(medida)
  const brillo = document.createElementNS(NS, 'circle')
  const punto = document.createElementNS(NS, 'circle')
  brillo.setAttribute('r', String(r * 2.6)); brillo.style.fill = color; brillo.style.opacity = '0.2'
  punto.setAttribute('r', String(r)); punto.style.fill = color
  gParticulas.append(brillo, punto)
  particulas.push({ medida, largo: medida.getTotalLength(), t0: performance.now(), dur: dur * 1000, punto, brillo })
}
function animar(ahora) {
  for (let i = particulas.length - 1; i >= 0; i--) {
    const p = particulas[i]
    const t = (ahora - p.t0) / p.dur
    if (t >= 1) { p.medida.remove(); p.punto.remove(); p.brillo.remove(); particulas.splice(i, 1); continue }
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    const pt = p.medida.getPointAtLength(e * p.largo)
    for (const c of [p.punto, p.brillo]) { c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y) }
  }
  requestAnimationFrame(animar)
}
requestAnimationFrame(animar)
const despues = (s, fn) => setTimeout(fn, s * 1000)
const GRIS = 'var(--t2)'
const ACENTO = 'var(--acento-claro)'
function particulasDe(eventos) {
  for (const ev of eventos) {
    if (ev.tipo === 'plan') [0, 0.3, 0.6].forEach(r => despues(r, () => particula({ de: 'yo', a: 'jefe' }, GRIS, 1.1)))
    if (ev.tipo === 'encargo' && ev.subtarea !== undefined) {
      particula({ de: 'jefe', a: `tarea-${ev.subtarea}` }, GRIS, 1.1)
      despues(1.1, () => particula({ de: `tarea-${ev.subtarea}`, a: `term-${ev.agente}` }, GRIS, 1.1))
    }
    if (ev.tipo === 'cambio') particula({ de: `term-${ev.de}`, a: `term-${ev.agente}` }, ACENTO, 1.4, 6)
    if (ev.tipo === 'resultado') {
      particula({ de: `term-${ev.agente}`, a: 'pipe-verificar' }, ev.ok ? GRIS : ACENTO, 1.3)
      if (ev.ok) despues(1.3, () => particula({ de: 'pipe-verificar', a: 'pipe-auditoria' }, GRIS, 0.9))
    }
    if (ev.tipo === 'nota') particula({ de: 'pipe-auditoria', a: 'jefe', subir: true }, ACENTO, 1.3, 5.5)
    if (ev.tipo === 'cierre') particula({ de: 'pipe-auditoria', a: 'pipe-juntar' }, ACENTO, 0.9)
  }
}

// Unir a mano: se arrastra desde el punto de una tarjeta hasta otra.
function empezarEnlace(ev, origen) {
  ev.stopPropagation()
  ev.preventDefault()
  const temp = document.createElementNS(NS, 'path')
  temp.setAttribute('class', 'temp')
  gParticulas.appendChild(temp)
  const x1 = origen.x + origen.el.offsetWidth / 2
  const y1 = origen.y + (origen.tipo === 'tarea' ? origen.el.offsetHeight : 0)
  const mover = e => { const [x, y] = aMundo(e.clientX, e.clientY); temp.setAttribute('d', `M${x1} ${y1} L${x} ${y}`) }
  const soltar = e => {
    window.removeEventListener('pointermove', mover)
    temp.remove()
    const destino = [...piezas.values()].find(t => t.el === document.elementFromPoint(e.clientX, e.clientY)?.closest('.pieza'))
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

// ---------- las piezas fijas: Tú, el jefe, el paso actual y la tubería ----------
const yo = crearPieza('yo', 'yo', 'circulo yo', [-65, -65])
yo.el.append(el('span', 'etq', 'Usuario'), el('b', '', 'Tú'), el('small', '', 'pides con /mst'))
yo.el.title = 'Clic: tu cuenta, el tema y el acento'
arrastrable(yo, yo.el, () => abrirDetalle({ tipo: 'yo' }))
const jefe = crearPieza('jefe', 'jefe', 'circulo jefe', [240, -105])
jefe.etq = el('span', 'etq', 'Jefe')
jefe.nombre = el('b', '', 'Claude')
jefe.fase = el('small', '', 'planifica · reparte · verifica')
jefe.el.append(jefe.etq, jefe.nombre, jefe.fase)
jefe.el.title = 'Doble clic: escríbele a la sesión del jefe'
arrastrable(jefe, jefe.el)
jefe.el.addEventListener('dblclick', () => abrirDetalle({ tipo: 'jefe' }))
const paso = conCabecera(crearPieza('paso', 'paso', 'paso-t', [-120, -340]), 'Paso actual')
paso.fasesBarra = el('div', 'fases')
FASES.forEach(() => paso.fasesBarra.appendChild(document.createElement('span')))
const PIPES = [
  { id: 'pipe-verificar', nombre: 'Verificar (tests)', rol: 'en la carpeta de cada agente', pos: [-40, 330] },
  { id: 'pipe-auditoria', nombre: 'Auditoría 1-10', rol: '≥6 hecha · <6 se rehace', pos: [245, 330] },
  { id: 'pipe-juntar', nombre: 'Juntar', rol: 'ramas o carpeta compartida', pos: [520, 330] },
  { id: 'pipe-informe', nombre: 'Informe + aviso', rol: 'Markdown · ntfy al móvil', pos: [520, 450] },
]
for (const p of PIPES) {
  const t = crearPieza(p.id, 'pipe', 'pipe', p.pos)
  t.el.append(el('b', '', p.nombre), el('small', '', p.rol))
  arrastrable(t, t.el)
}

// ---------- contenido de cada tipo de pieza ----------
function pintarFijas(d, fase) {
  jefe.nombre.textContent = d.jefe ?? 'Claude'
  jefe.fase.textContent = fase.indice < 0 ? 'en reposo' : fase.nombre.toLowerCase()
  jefe.el.classList.toggle('activo', fase.indice === 1 || fase.indice === 6)
  yo.el.querySelector('b').textContent = ajustes.nombre.trim() || 'Tú'
  paso.estado.textContent = fase.indice < 0 ? 'reposo' : `fase ${fase.indice + 1} / 8`
  paso.cuerpo.replaceChildren(el('h3', '', fase.titulo), el('p', '', fase.texto), paso.fasesBarra)
  ;[...paso.fasesBarra.children].forEach((s, i) => { s.className = i < fase.indice ? 'pasada' : i === fase.indice ? 'actual' : '' })
  piezas.get('pipe-verificar').el.classList.toggle('activo', fase.indice === 5)
  piezas.get('pipe-auditoria').el.classList.toggle('activo', fase.indice === 5)
  piezas.get('pipe-juntar').el.classList.toggle('activo', fase.indice === 6)
  piezas.get('pipe-informe').el.classList.toggle('activo', fase.indice === 7)
}
function pintarTerminal(tar, d) {
  const e = estadoAgente(d, tar.agente)
  tar.el.className = `pieza terminal-t${e.activo ? ' activo' : ''}${e.falla ? ' falla' : ''}${e.apartado ? ' apartado' : ''}${e.hecho && !e.activo ? ' hecha' : ''}`
  tar.estado.textContent = e.apartado ? '○ apartado' : e.activo ? '● trabajando' : e.falla ? '✗ falló' : e.hecho ? '✓ terminó' : 'en espera'
  const info = (d.agentes ?? []).find(a => a.nombre === tar.agente)
  tar.vivo.replaceChildren()
  const modelo = el('small', '', `${e.apartado || e.modelo || d.modelos?.[tar.agente]?.[0] || ''}${info && !info.ok && !e.apartado ? ` · ${info.nota}` : ''}`)
  const pre = el('pre', '', e.lineas.length ? e.lineas.join('\n') : e.apartado ? '' : '› en espera')
  tar.vivo.append(modelo, pre)
  if (e.ultimo && e.activo && e.ultimo.subtarea !== undefined) tar.vivo.append(el('div', 'estado', `haciendo la tarea ${e.ultimo.subtarea}`))
  if (e.nota !== undefined) tar.vivo.append(el('div', `estado nota${e.nota < 6 ? ' mal' : ''}`, `última nota ${e.nota}/10`))
  if (e.activo && e.ultimo) {
    const b = el('button', 'cancelar', '■ Cancelar')
    b.onclick = () => enviar({ tipo: 'cancelar', id: e.ultimo.id }, b)
    tar.vivo.append(b)
  }
  tar.enlazadas.replaceChildren()
  const mias = guardado.enlaces.filter(l => l.a === tar.agente)
  const subs = d.plan?.subtareas ?? []
  for (const l of mias) {
    const chip = el('span', 'chip')
    const s = subs.find(o => o.n === l.n)
    chip.append(el('span', '', `→ tarea ${l.n}${s ? `: ${s.titulo.slice(0, 22)}` : ''}`))
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
  const tar = conCabecera(crearPieza(`term-${a}`, 'terminal', 'terminal-t', [1180 + (i % 2) * 380, Math.floor(i / 2) * 390 - 230]), NOMBRES[a])
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
    input.value = ''
    ir.textContent = 'enviado ✓'
    await enviar({ tipo: 'encargar', agente: a, n: mias[mias.length - 1].n, texto })
    setTimeout(() => { ir.textContent = 'Enviar' }, 2500)
  })
  tar.cuerpo.append(tar.vivo, tar.enlazadas, tar.enviarCaja)
  tar.el.addEventListener('dblclick', ev => { if (!ev.target.closest('input,button,.puerto')) abrirDetalle({ tipo: 'terminal', clave: a }) })
  conPuerto(tar, 'arriba')
  return tar
}
function crearTarea(s, i, n) {
  const tar = conCabecera(crearPieza(`tarea-${s.n}`, 'tarea', 'tarea', [760, (i - (n - 1) / 2) * 170 - 60]), `Tarea ${s.n}`)
  tar.n = s.n
  tar.el.addEventListener('dblclick', ev => { if (!ev.target.closest('input,button,.puerto')) abrirDetalle({ tipo: 'tarea', clave: s.n }) })
  conPuerto(tar, 'abajo')
  return tar
}
function pintarTarea(tar, s) {
  tar.el.className = `pieza tarea ${s.estado === 'hecha' ? 'hecha' : s.estado === 'en curso' ? 'en-curso' : ''}`
  tar.estado.textContent = s.estado
  tar.cuerpo.replaceChildren(el('p', 'titulo', s.titulo), el('div', 'estado', [s.quien ? `con ${s.quien.split(':')[0]}` : 'sin asignar', s.puntaje !== undefined ? `nota ${s.puntaje}/10` : '', s.espera?.length ? `espera a ${s.espera.join(', ')}` : ''].filter(Boolean).join(' · ')))
}

async function enviar(accion, boton) {
  if (modoEjemplo) { if (boton) boton.textContent = 'solo es un ejemplo'; return }
  if (boton) { boton.disabled = true; boton.textContent = 'enviando…' }
  try { await fetch('/accion' + location.search, { method: 'POST', body: JSON.stringify(accion) }) } catch {}
}

// ---------- el panel lateral ----------
const detalle = el('aside')
detalle.id = 'detalle'
document.body.appendChild(detalle)
let abierto = null
let refs = null
const seg = ms => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${Math.round((ms ?? 0) / 1000)} s`)
function cabecera(titulo, estado) {
  const cab = el('div', 'cab-detalle')
  const x = el('button', '', '✕')
  x.onclick = cerrarDetalle
  cab.append(el('b', '', titulo), el('span', '', estado ?? ''), x)
  return cab
}
function abrirDetalle(que) {
  abierto = que
  refs = null
  if (que.tipo === 'yo') construirYo()
  else if (que.tipo === 'jefe') construirJefe()
  pintarDetalle()
}
function cerrarDetalle() { abierto = null; refs = null; detalle.classList.remove('visible') }
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') cerrarDetalle() })
const hms = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }

// Tú: cuenta, tiempo de la sesión, tema y acento. Se construye una vez (tiene campos de texto) y solo se refresca el reloj.
function construirYo() {
  detalle.replaceChildren(cabecera('Tú'))
  const campo = (rotulo, clave, ayuda) => {
    const f = el('div', 'fila')
    const i = el('input')
    i.type = 'text'
    i.value = ajustes[clave]
    i.placeholder = ayuda
    i.oninput = () => { ajustes[clave] = i.value; guardarAjustes(); pintarFijas(ultimo, faseDe(ultimo)) }
    f.append(el('label', '', rotulo), i)
    return f
  }
  detalle.append(el('div', 'rotulo', 'Mi cuenta'), campo('Nombre', 'nombre', 'Cómo te llamas'), campo('Cuenta', 'cuenta', 'Tu correo o usuario'))
  detalle.append(el('div', 'estado', 'Se guardan solo en este navegador.'))
  detalle.append(el('div', 'rotulo', 'Tiempo de la sesión'))
  refs = { tiempo: el('p', 'titulo', '0:00:00'), origen: el('div', 'estado'), datos: el('div', 'estado') }
  detalle.append(refs.tiempo, refs.origen, refs.datos)
  detalle.append(el('div', 'rotulo', 'Tema'))
  const tema = el('div', 'opciones')
  for (const t of ['oscuro', 'claro']) {
    const b = el('button', ajustes.tema === t ? 'elegido' : '', t === 'oscuro' ? 'Oscuro' : 'Claro')
    b.onclick = () => { ajustes.tema = t; guardarAjustes(); aplicarAjustes(); tema.querySelectorAll('button').forEach(o => o.classList.toggle('elegido', o === b)) }
    tema.append(b)
  }
  detalle.append(tema, el('div', 'rotulo', 'Acento'))
  const acentos = el('div', 'opciones')
  for (const [clave, [color, , , nombre]] of Object.entries(ACENTOS)) {
    const b = el('button', `muestra${ajustes.acento === clave ? ' elegido' : ''}`)
    b.style.background = color
    b.title = nombre
    b.onclick = () => { ajustes.acento = clave; guardarAjustes(); aplicarAjustes(); acentos.querySelectorAll('button').forEach(o => o.classList.toggle('elegido', o === b)); acentoNombre.textContent = nombre }
    acentos.append(b)
  }
  const acentoNombre = el('div', 'estado', ACENTOS[ajustes.acento]?.[3] ?? '')
  detalle.append(acentos, acentoNombre)
}
function refrescarYo(d) {
  const inicios = (d.trabajos ?? []).map(t => t.inicio)
  const desde = inicios.length ? Math.min(...inicios) : abiertoEn
  refs.tiempo.textContent = hms(Date.now() - desde)
  refs.origen.textContent = inicios.length ? 'Desde el primer trabajo de este chat.' : 'Desde que abriste el tablero (este chat aún no tiene trabajos).'
  refs.datos.textContent = `Chat ${chat.slice(0, 18)} · jefe ${d.jefe ?? 'Claude'}${d.ejemplo ? ' · datos de ejemplo' : ''}`
}

// El jefe: se le escribe a la sesión de Claude en vivo. Se construye una vez (tiene un cuadro de texto).
function construirJefe() {
  detalle.replaceChildren()
  refs = { cab: cabecera('Jefe'), titulo: el('p', 'titulo'), texto: el('div', 'estado'), nota: el('div', 'estado'), lista: el('div') }
  const area = el('textarea')
  area.maxLength = 2000
  area.placeholder = 'Escríbele al jefe: cambia el plan, pídele que revise algo, que repita una tarea…'
  const ir = el('button', 'accion', 'Enviar al jefe')
  const mandar = async () => {
    const texto = area.value.trim()
    if (!texto) return
    if (modoEjemplo) { ir.textContent = 'solo es un ejemplo'; return }
    guardado.mensajes = [...(guardado.mensajes ?? []), { t: Date.now(), texto }].slice(-20)
    guardar()
    area.value = ''
    ir.textContent = 'enviado ✓'
    setTimeout(() => { ir.textContent = 'Enviar al jefe' }, 2500)
    await enviar({ tipo: 'jefe', texto })
    refrescarJefe(ultimo)
  }
  ir.onclick = mandar
  area.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) mandar() })
  detalle.append(refs.cab, el('div', 'rotulo', 'Qué hace ahora'), refs.titulo, refs.texto, el('div', 'rotulo', 'Escríbele a la sesión'), area, el('div', 'fila'), refs.nota, el('div', 'rotulo', 'Lo que le has escrito'), refs.lista)
  detalle.querySelector('.fila').append(ir, el('span', 'estado', 'Ctrl+Enter también envía'))
}
function refrescarJefe(d) {
  const fase = faseDe(d)
  refs.cab.querySelector('b').textContent = `Jefe · ${d.jefe ?? 'Claude'}`
  refs.cab.querySelector('span').textContent = fase.indice < 0 ? 'en reposo' : `fase ${fase.indice + 1} / 8`
  refs.titulo.textContent = fase.titulo
  refs.texto.textContent = fase.texto
  refs.nota.textContent = (d.jefe ?? 'Claude') === 'Claude'
    ? 'El mensaje entra en tu sesión de Claude Code como si lo escribieras en el chat (espera a que la sesión esté libre). La respuesta aparece allí.'
    : 'OpenCode no recibe mensajes en vivo: el mensaje le llega en su siguiente llamada al centro.'
  const mensajes = guardado.mensajes ?? []
  refs.lista.replaceChildren(...(mensajes.length ? [...mensajes].reverse().map(m => { const f = el('div', 'mensaje', m.texto); f.prepend(el('small', '', new Date(m.t).toLocaleTimeString())); return f }) : [el('p', 'vacio', 'Todavía no le has escrito.')]))
}

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
  if (abierto.tipo === 'yo') refrescarYo(d)
  else if (abierto.tipo === 'jefe') refrescarJefe(d)
  else {
    const arriba = detalle.scrollTop
    detalle.replaceChildren()
    const ahora = d.ahora ?? Date.now()
    if (abierto.tipo === 'terminal') {
      const a = abierto.clave
      const e = estadoAgente(d, a)
      detalle.append(cabecera(`Terminal · ${NOMBRES[a]}`, e.apartado ? '○ apartado' : e.activo ? '● trabajando' : e.falla ? '✗ falló' : e.hecho ? '✓ terminó' : 'en espera'))
      const suyos = d.trabajos.filter(t => agenteDe(t) === a)
      const actual = suyos.filter(t => t.estado === 'corriendo').pop()
      detalle.append(el('div', 'rotulo', 'Qué está ejecutando'))
      if (actual) {
        const s = (d.plan?.subtareas ?? []).find(o => o.n === actual.subtarea)
        detalle.append(el('p', 'titulo', s ? `Tarea ${s.n}: ${s.titulo}` : actual.tarea ?? 'Encargo suelto'))
      } else detalle.append(el('p', 'vacio', e.apartado ? e.apartado : 'Nada ahora mismo.'))
      for (const t of [...suyos].reverse().slice(0, 6)) detalle.append(filaTrabajo(t, ahora))
    } else {
      const s = (d.plan?.subtareas ?? []).find(o => o.n === abierto.clave)
      if (!s) { cerrarDetalle(); return }
      detalle.append(cabecera(`Tarea ${s.n}`, s.estado), el('p', 'titulo', s.titulo))
      detalle.append(el('div', 'estado', [s.quien ? `con ${s.quien}` : 'sin asignar', s.puntaje !== undefined ? `nota ${s.puntaje}/10` : 'sin nota', s.espera?.length ? `espera a ${s.espera.join(', ')}` : 'no espera a nadie'].join(' · ')))
      const suyos = d.trabajos.filter(t => t.subtarea === s.n)
      detalle.append(el('div', 'rotulo', `${suyos.length} intento${suyos.length === 1 ? '' : 's'}`))
      if (!suyos.length) detalle.append(el('p', 'vacio', 'Aún no la ha tomado ningún agente.'))
      for (const t of [...suyos].reverse()) detalle.append(filaTrabajo(t, ahora))
    }
    detalle.scrollTop = arriba
    detalle.querySelectorAll('pre.salida').forEach(p => { p.scrollTop = p.scrollHeight })
  }
  detalle.classList.add('visible')
}
setInterval(() => { if (abierto?.tipo === 'yo' && refs && ultimo) refrescarYo(ultimo) }, 1000)

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
  crear(modoEjemplo ? '✓ Ejemplo' : 'Ejemplo', () => { guardado.ejemplo = !guardado.ejemplo; guardar(); ultimo = null; leer() }, modoEjemplo ? 'abierto' : '')
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
  for (const t of [...piezas.values()]) {
    if (t.tipo === 'tarea' || t.tipo === 'terminal') quitar(t.id)
    else if (t.tipo !== 'yo') {}
  }
  const base = { yo: [-65, -65], jefe: [240, -105], paso: [-120, -340] }
  for (const p of PIPES) base[p.id] = p.pos
  for (const [id, [x, y]] of Object.entries(base)) { const t = piezas.get(id); if (t) { t.x = x; t.y = y; t.el.style.left = `${x}px`; t.el.style.top = `${y}px` } }
  guardar()
  sincronizar()
  centrar()
}

// ---------- sincronizar las piezas con los datos ----------
let ultimo = null
function sincronizar() {
  const d = ultimo
  if (!d) return
  const fase = faseDe(d)
  pintarFijas(d, fase)
  const subs = d.plan?.subtareas ?? []
  const ids = new Set(subs.map(s => `tarea-${s.n}`))
  for (const id of [...piezas.keys()]) if (id.startsWith('tarea-') && !ids.has(id)) quitar(id)
  subs.forEach((s, i) => pintarTarea(piezas.get(`tarea-${s.n}`) ?? crearTarea(s, i, subs.length), s))
  for (const id of [...piezas.keys()]) if (id.startsWith('term-') && !guardado.terminales.includes(id.slice(5))) quitar(id)
  guardado.terminales.forEach((a, i) => pintarTerminal(piezas.get(`term-${a}`) ?? crearTerminal(a, i), d))
  // Líneas: Tú ↔ jefe (fija), el jefe con cada tarea, las dependencias, cada tarea con las terminales que la hacen o que unió el usuario,
  // y la tubería (terminales → verificar → auditoría → notas al jefe, y → juntar → informe).
  conexiones = [{ de: 'yo', a: 'jefe', clase: 'fija' }]
  const manual = new Set(guardado.enlaces.map(l => `${l.n}|${l.a}`))
  for (const s of subs) {
    conexiones.push({ de: 'jefe', a: `tarea-${s.n}`, clase: 'jefe' })
    for (const e of s.espera ?? []) conexiones.push({ de: `tarea-${e}`, a: `tarea-${s.n}`, vertical: true, clase: 'dep' })
    const suyos = d.trabajos.filter(t => t.subtarea === s.n)
    const t = suyos[suyos.length - 1]
    if (t) {
      const agente = agenteDe(t)
      if (piezas.has(`term-${agente}`) && !manual.has(`${s.n}|${agente}`)) conexiones.push({ de: `tarea-${s.n}`, a: `term-${agente}`, viva: t.estado === 'corriendo' })
    }
  }
  for (const l of guardado.enlaces) if (piezas.has(`tarea-${l.n}`) && piezas.has(`term-${l.a}`)) conexiones.push({ de: `tarea-${l.n}`, a: `term-${l.a}`, clase: 'manual', viva: estadoAgente(d, l.a).activo })
  for (const a of guardado.terminales) conexiones.push({ de: `term-${a}`, a: 'pipe-verificar', clase: 'bus' })
  conexiones.push({ de: 'pipe-verificar', a: 'pipe-auditoria', clase: 'flujo' }, { de: 'pipe-auditoria', a: 'jefe', subir: true, clase: 'notas' }, { de: 'pipe-auditoria', a: 'pipe-juntar', clase: 'flujo' }, { de: 'pipe-juntar', a: 'pipe-informe', vertical: true, clase: 'flujo' })
  trazar()
  pintarBarra()
  pintarDetalle()
}

// ---------- leer los datos del chat ----------
let temporizador
async function leer() {
  clearTimeout(temporizador)
  try {
    const r = await fetch(`/${location.search}`, { cache: 'no-store' })
    if (!r.ok) throw new Error(String(r.status))
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html')
    let datos = JSON.parse(doc.getElementById('datos').textContent)
    // Sin plan real (o si lo pides con el botón), se enseñan datos de ejemplo: ni se mandan órdenes ni se guardan.
    if (guardado.ejemplo || !(datos.plan?.subtareas ?? []).length) datos = ejemplo(Date.now())
    modoEjemplo = !!datos.ejemplo
    const antes = ultimo
    ultimo = datos
    if (!antes && !guardado.terminales.length) guardado.terminales = AGENTES.filter(a => estadoAgente(datos, a).ultimo).slice(0, 4)
    sincronizar()
    aplicarVista()
    particulasDe(eventosEntre(antes, datos))
  } catch {}
  temporizador = setTimeout(leer, 2000)
}
document.getElementById('volver').href = `/${location.search}`
pintarBarra()
leer().then(() => { if (!guardado.vista) { guardado.vista = vista; centrar() } else aplicarVista() })

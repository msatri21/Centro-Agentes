// El grafo grande del centro: dibuja a los agentes y cómo se hablan entre sí, alimentado con los datos reales del chat.
// Se crea una vez y se actualiza con cada lectura (cada 2 s), sin recargar la página: así las animaciones no se cortan.
import { AGENTES, FASES, estadoAgente, eventosEntre, faseDe } from './grafo-logica.js'

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
const corto = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

const JEFE = { x: 380, y: 400 }
const INFO = {
  opencode: { nombre: 'OpenCode', rol: 'edita código en su carpeta', info: 'Agente de código: abre, edita y crea archivos. Usa los modelos de la nube de Ollama, sin clave.' },
  ollama: { nombre: 'Ollama', rol: 'modelos de texto', info: 'Modelos de texto puros: redactan, resumen y analizan. No tocan archivos, así que no se usan para editar ni verificar.' },
  hermes: { nombre: 'Hermes', rol: 'terminal · archivos · web', info: 'Hermes Agent (Nous Research): generalista con sus propias herramientas. Puede ejecutar comandos, leer la web y editar archivos.' },
  aider: { nombre: 'Aider', rol: 'programación por parejas', info: 'Aider edita los archivos que nombra la tarea con cambios mínimos y precisos.' },
  codex: { nombre: 'Codex', rol: 'agente de OpenAI', info: 'Codex (OpenAI): edita y ejecuta comandos. Usa el cupo gratis de tu cuenta de ChatGPT y, si no hay sesión, tu Ollama.' },
  claude: { nombre: 'Claude headless', rol: 'último recurso · gasta del plan', info: 'Claude sin interfaz. Solo entra si los agentes gratis rinden claramente peor, con un tope de tokens por chat.' },
}
const DERECHA = [
  { id: 'verificar', nombre: 'Verificar (tests)', rol: 'en la carpeta de cada agente', y: 90, info: 'El centro ejecuta tu comando de verificación (por ejemplo npm test) donde trabajó el agente y se lo pasa al jefe.' },
  { id: 'auditoria', nombre: 'Auditoría 1-10', rol: '≥6 hecha · <6 se rehace', y: 250, info: 'El jefe revisa los cambios y pone una nota. Con 6 o más la subtarea queda hecha; si no, la rehace otro modelo sabiendo qué falló.' },
  { id: 'juntar', nombre: 'Juntar', rol: 'ramas o carpeta compartida', y: 410, info: 'Cada agente dejó su trabajo en su propia rama, o en archivos suyos de una carpeta compartida. El jefe lo junta y cierra el plan.' },
  { id: 'informe', nombre: 'Informe + aviso', rol: 'Markdown · ntfy al móvil', y: 570, info: 'Al terminar se guarda el informe (quién hizo qué, notas, ahorro) y te llega un aviso al celular.' },
]

export function crearGrafo(montaje) {
  const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches
  montaje.innerHTML = `<div class="lienzo"><svg viewBox="0 0 1400 840" role="img" aria-label="Grafo animado del Centro de agentes MST: el usuario, el jefe, los agentes, verificación, auditoría, juntar e informe"></svg></div>
<section class="paso" aria-live="polite"><div><p class="rotulo">Paso actual</p><h2><i id="g-num">REPOSO</i><span id="g-titulo"></span></h2></div>
<div><p id="g-texto"></p><div class="fases" id="g-barra"></div><div class="fases-nombres" id="g-nombres"></div></div></section><div id="g-tip" role="tooltip"></div>`
  const svg = montaje.querySelector('svg')
  const tip = montaje.querySelector('#g-tip')
  const g = nombre => el('g', { id: nombre }, svg)
  const defs = el('defs', {}, svg)
  const flecha = el('marker', { id: 'g-flecha', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs)
  el('path', { d: 'M0 0 L10 5 L0 10 z', fill: '#555' }, flecha)
  const patron = el('pattern', { id: 'g-puntos', width: 28, height: 28, patternUnits: 'userSpaceOnUse' }, defs)
  el('circle', { cx: 1, cy: 1, r: 1, fill: '#1e1e1e' }, patron)
  el('rect', { width: 1400, height: 840, fill: 'url(#g-puntos)' }, svg)
  texto(svg, 24, 30, 'Fig 1 · cómo se hablan los agentes', 'rotulo-svg')
  const rotuloVivo = texto(svg, 1376, 30, 'EN REPOSO', 'rotulo-svg', 'end')
  const capaAristas = g('g-aristas')
  const capaNodos = g('g-nodos')
  const capaParticulas = g('g-particulas')
  const capaEncima = g('g-encima')

  // ---- aristas ----
  const caminos = {}
  const arista = (id, d, clase, marca) => {
    const p = el('path', { d, class: clase || 'arista' }, capaAristas)
    if (marca) p.setAttribute('marker-end', 'url(#g-flecha)')
    caminos[id] = p
  }
  const ay = i => 60 + i * 110
  const AX = 650
  arista('tu-jefe', 'M180 400 L292 400', 'arista', true)
  texto(capaAristas, 236, 386, '/mst <tarea>', 'rotulo-arista', 'middle')
  AGENTES.forEach((a, i) => {
    const y = ay(i) + 32
    arista('jefe-' + a, `M466 400 C 540 400, ${AX - 70} ${y}, ${AX} ${y}`, 'arista', true)
    arista('ver-' + a, `M${AX + 250 + 12 + 250} ${y} C ${AX + 560} ${y}, 1140 125, 1170 125`, 'arista')
    if (a !== 'claude') arista('nube-' + a, `M640 786 L640 ${y} L${AX} ${y}`, 'bus')
  })
  arista('ver-aud', 'M1275 160 L1275 250', 'arista', true)
  arista('aud-jefe', 'M1170 285 C 1000 -40, 600 -40, 430 330', 'arista', true)
  texto(capaAristas, 800, 62, 'notas de vuelta al jefe', 'rotulo-arista', 'middle')
  arista('aud-jun', 'M1275 320 L1275 410', 'arista', true)
  arista('jun-inf', 'M1275 480 L1275 570', 'arista', true)
  AGENTES.forEach((a, i) => {
    for (let k = 0; k < AGENTES.length; k++) if (k !== i) arista(`cambio-${a}-${AGENTES[k]}`, `M${AX + 20} ${ay(i) + 64} C ${AX - 60} ${(ay(i) + ay(k)) / 2 + 32}, ${AX - 60} ${(ay(i) + ay(k)) / 2 + 32}, ${AX + 20} ${ay(k)}`, 'cambio')
  })

  // ---- nodos ----
  const nodos = {}
  const tooltips = []
  const info = (grupo, nombre, texto) => { grupo.dataset.nombre = nombre; grupo.dataset.info = texto; grupo.setAttribute('tabindex', '0'); tooltips.push(grupo) }
  const tu = el('g', { class: 'nodo' }, capaNodos)
  el('rect', { x: 30, y: 358, width: 150, height: 84 }, tu)
  texto(tu, 46, 380, 'USUARIO', 'etiqueta')
  texto(tu, 46, 408, 'Tú', 'nombre')
  texto(tu, 46, 428, 'pides con /mst', 'rol')
  info(tu, 'Tú', 'Escribes /mst <tarea> en cualquier chat de Claude Code o de OpenCode. Sigues el progreso aquí y recibes el aviso al final.')

  const jefe = el('g', { class: 'nodo' }, capaNodos)
  el('circle', { cx: JEFE.x, cy: JEFE.y, r: 86, class: 'halo' }, jefe)
  el('circle', { cx: JEFE.x, cy: JEFE.y, r: 104, class: 'anillo' }, jefe)
  el('circle', { cx: JEFE.x, cy: JEFE.y, r: 86, class: 'cuerpo' }, jefe)
  texto(jefe, JEFE.x, JEFE.y - 18, 'JEFE', 'jefe-sub', 'middle')
  const jefeNombre = texto(jefe, JEFE.x, JEFE.y + 12, 'Claude', 'jefe-titulo', 'middle')
  texto(jefe, JEFE.x, JEFE.y + 34, 'planifica · reparte', 'jefe-desc', 'middle')
  texto(jefe, JEFE.x, JEFE.y + 50, 'verifica · rehace', 'jefe-desc', 'middle')
  info(jefe, 'JEFE', 'No hace el trabajo: lo divide en subtareas, las reparte en paralelo, comprueba cada resultado con una nota del 1 al 10 y manda rehacer lo que saca menos de 6.')
  nodos.jefe = jefe
  const capaTarjetas = el('g', {}, capaNodos)
  texto(capaNodos, JEFE.x, 580, 'subtareas del plan', 'rotulo-svg', 'middle')

  const terminales = {}
  const notas = {}
  const modelos = {}
  const marcas = {}
  AGENTES.forEach((a, i) => {
    const y = ay(i)
    const n = el('g', { class: 'nodo' }, capaNodos)
    el('rect', { x: AX, y, width: 220, height: 64 }, n)
    texto(n, AX + 14, y + 24, INFO[a].nombre, 'nombre')
    texto(n, AX + 14, y + 42, INFO[a].rol, 'rol')
    modelos[a] = texto(n, AX + 14, y + 57, '', 'modelo')
    marcas[a] = texto(n, AX + 206, y + 57, '', 'modelo vino', 'end')
    info(n, INFO[a].nombre, INFO[a].info)
    nodos[a] = n
    const t = el('g', { class: 'terminal' }, capaNodos)
    el('rect', { x: AX + 232, y, width: 250, height: 64 }, t)
    terminales[a] = [0, 1, 2].map(k => texto(t, AX + 242, y + 19 + k * 18, '', ''))
    notas[a] = texto(capaEncima, AX + 206, y + 25, '', 'nota', 'end')
  })
  DERECHA.forEach(d => {
    const n = el('g', { class: 'nodo' }, capaNodos)
    el('rect', { x: 1170, y: d.y, width: 210, height: 70 }, n)
    texto(n, 1184, d.y + 30, d.nombre, 'nombre')
    texto(n, 1184, d.y + 52, d.rol, 'rol')
    info(n, d.nombre, d.info)
    nodos[d.id] = n
  })
  const nube = el('g', { class: 'nodo' }, capaNodos)
  el('rect', { x: 460, y: 786, width: 360, height: 44 }, nube)
  texto(nube, 476, 806, 'Ollama cloud · gratis', 'nombre')
  texto(nube, 476, 822, 'gpt-oss · beam · gemma4 · nemotron', 'modelo')
  info(nube, 'Ollama cloud · gratis', 'Los modelos de la nube del plan Free de Ollama. OpenCode, Ollama, Hermes, Aider y Codex los usan a través de tu Ollama local, sin claves que caduquen.')
  const movil = el('g', { class: 'movil' }, capaEncima)
  el('rect', { x: 1300, y: 690, width: 36, height: 62, rx: 6 }, movil)
  el('rect', { x: 1306, y: 700, width: 24, height: 38, rx: 2 }, movil)
  texto(movil, 1318, 774, 'aviso', 'rotulo-svg', 'middle')
  const listo = el('text', { x: JEFE.x, y: 700, class: 'listo-svg', 'text-anchor': 'middle' }, capaEncima)
  listo.innerHTML = '<tspan>✓</tspan> Todo listo'
  const avisoCambio = texto(capaEncima, 360, 700, '', 'aviso-falla')

  // ---- partículas ----
  const particulas = []
  let reloj = 0
  const GRIS = '#d4d4d4'
  const GRIS2 = '#8a8a8a'
  const VINO = '#c4485a'
  const particula = (id, color, dur, radio) => {
    const camino = caminos[id]
    if (!camino || sinMovimiento) return
    const brillo = el('circle', { r: (radio || 4) * 2.6, fill: color, opacity: 0.18 }, capaParticulas)
    const punto = el('circle', { r: radio || 4, fill: color }, capaParticulas)
    particulas.push({ camino, largo: camino.getTotalLength(), t0: reloj, dur: dur || 1.3, punto, brillo })
    camino.classList.add('viva')
    setTimeout(() => camino.classList.remove('viva'), (dur || 1.3) * 1000 + 400)
  }
  const retrasar = (s, fn) => setTimeout(fn, s * 1000)

  // ---- fases ----
  const barra = montaje.querySelector('#g-barra')
  const nombres = montaje.querySelector('#g-nombres')
  FASES.forEach(f => {
    barra.appendChild(document.createElement('span'))
    const n = document.createElement('div')
    n.textContent = f.nombre
    nombres.appendChild(n)
  })

  // ---- actualizar con una lectura nueva ----
  let anterior = null
  let destelloRepeticion = 0
  function actualizar(d) {
    const fase = faseDe(d)
    montaje.querySelector('#g-num').textContent = fase.indice < 0 ? 'REPOSO' : `FASE ${fase.indice + 1} / 8`
    montaje.querySelector('#g-titulo').textContent = fase.titulo
    montaje.querySelector('#g-texto').textContent = fase.texto
    ;[...barra.children].forEach((s, i) => { s.className = i < fase.indice ? 'pasada' : i === fase.indice ? 'actual' : '' })
    rotuloVivo.textContent = fase.indice < 0 ? 'EN REPOSO' : `${d.trabajos.filter(t => t.estado === 'corriendo').length} TRABAJANDO · ${d.jefe ?? 'Claude'} DE JEFE`
    jefeNombre.textContent = d.jefe ?? 'Claude'
    nodos.jefe.classList.toggle('activo', fase.indice === 1 || fase.indice === 6)
    nodos.verificar.classList.toggle('activo', fase.indice === 5)
    nodos.auditoria.classList.toggle('activo', fase.indice === 5)
    nodos.juntar.classList.toggle('activo', fase.indice === 6)
    nodos.informe.classList.toggle('activo', fase.indice === 7)
    listo.style.opacity = fase.indice === 7 ? 1 : 0
    movil.classList.toggle('vibra', fase.indice === 7 && !sinMovimiento)

    // Tarjetas de subtareas junto al jefe.
    const subs = (d.plan?.subtareas ?? []).slice(0, 12)
    capaTarjetas.innerHTML = ''
    subs.forEach((s, i) => {
      const x = JEFE.x - ((Math.min(subs.length, 6) * 42) / 2) + (i % 6) * 42
      const y = 500 + Math.floor(i / 6) * 40
      const c = el('g', { class: `tarjeta ${s.estado === 'hecha' ? 'lista' : s.estado === 'en curso' ? 'asignada' : ''}` }, capaTarjetas)
      el('rect', { x, y, width: 34, height: 34 }, c)
      texto(c, x + 17, y + 22, String(s.n), '', 'middle')
      c.dataset.nombre = `Subtarea ${s.n}`
      c.dataset.info = `${s.titulo} · ${s.estado}${s.quien ? ` · ${s.quien}` : ''}${s.puntaje !== undefined ? ` · nota ${s.puntaje}/10` : ''}${s.espera?.length ? ` · espera a ${s.espera.join(', ')}` : ''}`
      ponerTooltip(c)
    })

    AGENTES.forEach(a => {
      const e = estadoAgente(d, a)
      nodos[a].classList.toggle('activo', e.activo)
      nodos[a].classList.toggle('falla', e.falla)
      nodos[a].classList.toggle('hecho', e.hecho && !e.activo)
      nodos[a].classList.toggle('apartado', !!e.apartado)
      modelos[a].textContent = corto(e.modelo || (d.modelos?.[a]?.[0] ?? ''), 30)
      marcas[a].textContent = e.skills ? '✦ skills' : ''
      let lineas = e.lineas.map(l => corto(l.replace(/^›\s*/, '› '), 36))
      if (e.apartado) lineas = ['○ apartado', corto(e.apartado, 36)]
      else if (!lineas.length) lineas = a === 'claude' ? ['› en espera', '  solo si los gratis', '  rinden peor'] : ['› en espera']
      else if (e.ultimo?.estado === 'error' && !e.activo && !lineas.some(l => l.startsWith('✗'))) lineas = [...lineas.slice(-2), '✗ falló']
      terminales[a].forEach((t, i) => {
        const s = lineas[i] ?? ''
        t.textContent = s
        t.setAttribute('class', s.startsWith('✗') || s.startsWith('○') ? 'mal' : s.startsWith('ok') ? 'ok' : '')
      })
      notas[a].textContent = e.nota !== undefined ? `${e.nota}/10` : ''
      notas[a].setAttribute('class', e.nota !== undefined && e.nota < 6 ? 'nota vino' : 'nota')
      notas[a].style.opacity = e.nota !== undefined ? 1 : 0
    })

    // Eventos: lo que acaba de pasar entre las dos lecturas se ve como partículas.
    for (const ev of eventosEntre(anterior, d)) {
      if (ev.tipo === 'plan') [0, 0.3, 0.6].forEach(r => retrasar(r, () => particula('tu-jefe', GRIS, 1.1)))
      if (ev.tipo === 'encargo' && caminos['jefe-' + ev.agente]) particula('jefe-' + ev.agente, GRIS, 1.2)
      if (ev.tipo === 'cambio') {
        particula(`cambio-${ev.de}-${ev.agente}`, VINO, 1.4, 5)
        avisoCambio.textContent = `✗ ${ev.de} falló → pasa a ${ev.agente}`
        avisoCambio.style.opacity = 1
        clearTimeout(destelloRepeticion)
        destelloRepeticion = setTimeout(() => { avisoCambio.style.opacity = 0 }, 7000)
      }
      if (ev.tipo === 'resultado') {
        particula('ver-' + ev.agente, ev.ok ? GRIS : VINO, 1.3)
        if (ev.ok) retrasar(1.2, () => particula('ver-aud', GRIS, 0.6))
      }
      if (ev.tipo === 'nota') particula('aud-jefe', VINO, 1.3, 4.5)
      if (ev.tipo === 'cierre') particula('aud-jun', VINO, 0.8, 4)
    }
    if (fase.indice === 7 && anterior && faseDe(anterior).indice !== 7) {
      particula('aud-jun', VINO, 0.8, 4)
      retrasar(0.8, () => particula('jun-inf', VINO, 0.9, 5))
    }
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
      const pt = p.camino.getPointAtLength(e * p.largo)
      p.punto.setAttribute('cx', pt.x)
      p.punto.setAttribute('cy', pt.y)
      p.brillo.setAttribute('cx', pt.x)
      p.brillo.setAttribute('cy', pt.y)
    }
    siguiente(bucle)
  }
  siguiente(bucle)

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
  tooltips.forEach(ponerTooltip)

  return { actualizar }
}

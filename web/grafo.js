// El grafo grande del centro: dibuja al jefe, a los agentes (una card por cada encargo) y cómo se hablan entre sí, alimentado con los datos reales del chat.
// Se crea una vez y se actualiza con cada lectura (cada 2 s), sin recargar la página: así las animaciones no se cortan.
import { ALARMAS, FASES, eventosEntre, faseDe, resumenDe, tarjetasDe } from './grafo-logica.js'

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
// Los tokens se leen como 12k→1k, como en las gráficas de la página.
const miles = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

const JEFE = { x: 380, y: 400 }
const INFO = {
  opencode: { nombre: 'OpenCode', rol: 'edita código en su carpeta', info: 'Agente de código: abre, edita y crea archivos. Usa modelos gratis de OpenCode, sin clave.' },
  ollama: { nombre: 'Ollama', rol: 'modelos de texto', info: 'Modelos de texto puros de Ollama: redactan, resumen y analizan. No tocan archivos, así que no se usan para editar ni verificar.' },
  hermes: { nombre: 'Hermes', rol: 'terminal · archivos · web', info: 'Hermes Agent (Nous Research): generalista con sus propias herramientas. Usa modelos gratis de Nous con tu cuenta; puede ejecutar comandos, leer la web y editar archivos.' },
  aider: { nombre: 'Aider', rol: 'programación por parejas', info: 'Aider edita los archivos que nombra la tarea con cambios mínimos y precisos.' },
  codex: { nombre: 'Codex', rol: 'agente de OpenAI', info: 'Codex (OpenAI): edita y ejecuta comandos. Usa el cupo gratis de tu cuenta de ChatGPT.' },
  claude: { nombre: 'Claude headless', rol: 'último recurso · gasta del plan', info: 'Claude sin interfaz. Solo entra si los agentes gratis rinden claramente peor, con un tope de tokens por chat.' },
}
const DERECHA = [
  { id: 'verificar', nombre: 'Verificar (tests)', rol: 'en la carpeta de cada agente', y: 90, info: 'El centro ejecuta tu comando de verificación (por ejemplo npm test) donde trabajó el agente y se lo pasa al jefe.' },
  { id: 'auditoria', nombre: 'Auditoría 1-10', rol: '≥6 hecha · <6 se rehace', y: 250, info: 'El jefe revisa los cambios y pone una nota. Con 6 o más la subtarea queda hecha; si no, la rehace otro modelo sabiendo qué falló.' },
  { id: 'juntar', nombre: 'Juntar', rol: 'ramas o carpeta compartida', y: 410, info: 'Cada agente dejó su trabajo en su propia rama, o en archivos suyos de una carpeta compartida. El jefe lo junta y cierra el plan.' },
  { id: 'informe', nombre: 'Informe + aviso', rol: 'Markdown · ntfy al móvil', y: 570, info: 'Al terminar se guarda el informe (quién hizo qué, notas, ahorro) y te llega un aviso al celular.' },
]
// Las tres alarmas de una card: la etiqueta de la insignia y lo que se le dice al jefe.
const ALARMA = {
  silencio: { etiqueta: 'SILENCIO', aviso: 'lleva callado' },
  pregunta: { etiqueta: 'PREGUNTA', aviso: 'necesita tu respuesta' },
  permiso: { etiqueta: 'PERMISO', aviso: 'pide permiso' },
}
// Las cards van en la zona de la derecha del jefe: una columna si hay pocas, dos si se acumulan.
const CARD_X = 650
const CARD_X2 = 890
const CARD_ANCHO = 300
const CARD_ANCHO_DOS = 230
const CARD_ALTO = 100
const CARD_FILA = 112   // alto de la card + separación entre filas
const CARD_MAX_UNA_COLUMNA = 7

export function crearGrafo(montaje) {
  const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches
  montaje.innerHTML = `<div class="lienzo"><svg viewBox="0 0 1400 840" role="img" aria-label="Grafo animado del Centro de agentes MST: el usuario, el jefe, una card por agente desplegado, verificación, auditoría, juntar e informe"></svg></div>
<div id="g-lista" class="g-lista"></div>
<section class="paso" aria-live="polite"><div><p class="rotulo">Paso actual</p><h2><i id="g-num">REPOSO</i><span id="g-titulo"></span></h2></div>
<div><p id="g-texto"></p><div class="fases" id="g-barra"></div><div class="fases-nombres" id="g-nombres"></div></div></section><div id="g-tip" role="tooltip"></div><div id="g-alerta" class="solo-lectores" role="status" aria-live="assertive" style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"></div>`
  const svg = montaje.querySelector('svg')
  const tip = montaje.querySelector('#g-tip')
  const gTexto = montaje.querySelector('#g-texto')
  const zonaAlerta = montaje.querySelector('#g-alerta')
  const g = nombre => el('g', { id: nombre }, svg)
  const defs = el('defs', {}, svg)
  const flecha = el('marker', { id: 'g-flecha', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs)
  el('path', { d: 'M0 0 L10 5 L0 10 z', fill: '#555' }, flecha)
  const patron = el('pattern', { id: 'g-puntos', width: 28, height: 28, patternUnits: 'userSpaceOnUse' }, defs)
  el('circle', { cx: 1, cy: 1, r: 1, fill: '#1e1e1e' }, patron)
  const fondo = el('rect', { width: 1400, height: 840, fill: 'url(#g-puntos)' }, svg)
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
  arista('tu-jefe', 'M180 400 L292 400', 'arista', true)
  texto(capaAristas, 236, 386, '/mst <tarea>', 'rotulo-arista', 'middle')
  arista('ver-aud', 'M1275 160 L1275 250', 'arista', true)
  arista('aud-jefe', 'M1170 285 C 1000 -40, 600 -40, 430 330', 'arista', true)
  texto(capaAristas, 800, 62, 'notas de vuelta al jefe', 'rotulo-arista', 'middle')
  arista('aud-jun', 'M1275 320 L1275 410', 'arista', true)
  arista('jun-inf', 'M1275 480 L1275 570', 'arista', true)

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
  // Contador de agentes en marcha, encima del jefe.
  const capaContador = el('g', { class: 'nodo' }, capaNodos)
  const contador = texto(capaContador, JEFE.x, 250, '0', 'contador-agentes', 'middle')
  const contadorLinea = texto(capaContador, JEFE.x, 272, 'agentes activos', 'rol', 'middle')
  DERECHA.forEach(d => {
    const n = el('g', { class: 'nodo' }, capaNodos)
    el('rect', { x: 1170, y: d.y, width: 210, height: 70 }, n)
    texto(n, 1184, d.y + 30, d.nombre, 'nombre')
    texto(n, 1184, d.y + 52, d.rol, 'rol')
    info(n, d.nombre, d.info)
    nodos[d.id] = n
  })
  // Las cards: una por cada encargo (trabajo) que está en marcha o ya terminó.
  const capaCards = el('g', { id: 'g-cards' }, capaNodos)
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

  // ---- cards: una por encargo ----
  const cards = {}   // id -> la card del DOM
  const crearCard = ancho => {
    const grupo = el('g', { class: 'nodo card card-entra' }, capaCards)
    // La posición va en el grupo (style.transform) y la animación de entrada en un grupo por dentro: si la animación
    // estuviera en el mismo grupo, su transform pisaría el translate de la posición y la card saltaría a la esquina.
    grupo.style.animation = 'none'
    if (!sinMovimiento) grupo.style.transition = 'transform .35s ease'
    const dentro = el('g', { class: 'card-entra' }, grupo)
    const rect = el('rect', { x: 0, y: 0, width: ancho, height: CARD_ALTO }, dentro)
    const tNombre = el('text', { x: 12, y: 22, class: 'nombre' }, dentro)
    const parte = el('tspan', {}, tNombre)
    const numSub = el('tspan', { class: 'rol', dx: 6 }, tNombre)
    const tModelo = texto(dentro, 12, 40, '', 'modelo')
    const tTitulo = texto(dentro, 12, 57, '', 'rol')
    const tEstado = texto(dentro, 12, 74, '', 'rol')
    const tSalida = texto(dentro, 12, 90, '', 'modelo')
    const tInsignia = texto(dentro, ancho - 12, 16, '', 'insignia', 'end')
    return { grupo, dentro, rect, parte, numSub, tModelo, tTitulo, tEstado, tSalida, tInsignia, x: 0, y: 0, ancho, alarma: '' }
  }
  // Pinta las cards del estado actual: crea las nuevas, actualiza las viejas y borra las que ya no están.
  const pintarCards = lista => {
    const columnas = lista.length > CARD_MAX_UNA_COLUMNA ? 2 : 1
    const ancho = columnas === 2 ? CARD_ANCHO_DOS : CARD_ANCHO
    const xs = columnas === 2 ? [CARD_X, CARD_X2] : [CARD_X]
    const filas = Math.ceil(lista.length / columnas)
    // El lienzo crece en alto si las cards necesitan más sitio.
    const alto = Math.max(840, 70 + filas * CARD_FILA + 60)
    svg.setAttribute('viewBox', `0 0 1400 ${alto}`)
    fondo.setAttribute('height', alto)
    const nuevasAlarmas = []
    const vivos = new Set()
    lista.forEach((c, i) => {
      vivos.add(c.id)
      const x = xs[i % columnas]
      const y = 70 + Math.floor(i / columnas) * CARD_FILA
      let card = cards[c.id]
      const nueva = !card
      if (nueva) { card = crearCard(ancho); cards[c.id] = card }
      if (card.ancho !== ancho) { card.rect.setAttribute('width', ancho); card.tInsignia.setAttribute('x', ancho - 12); card.ancho = ancho }
      if (nueva || card.x !== x || card.y !== y) {
        card.grupo.style.transform = `translate(${x}px, ${y}px)`
        card.x = x
        card.y = y
      }
      // Textos: la card se actualiza, no se recrea, para que las animaciones no se corten.
      const nombre = INFO[c.agente]?.nombre ?? c.agente
      card.parte.textContent = nombre
      card.numSub.textContent = c.subtarea === undefined || c.subtarea === null ? '' : `#${c.subtarea}`
      card.tModelo.textContent = corto(c.modelo || '', 30)
      card.tTitulo.textContent = c.titulo ? corto(c.titulo, 34) : (INFO[c.agente]?.rol ?? '')
      let estado = '✗ falló'
      if (c.estado === 'corriendo') estado = `● trabajando ${c.segundos} s`
      else if (c.estado === 'listo') estado = `✓ listo ${c.segundos} s` + (c.puntaje !== undefined ? ` · ${c.puntaje}/10` : '')
      if (c.tokensIn) estado += ` · ${miles(c.tokensIn)}→${miles(c.tokensOut ?? 0)}`
      card.tEstado.textContent = corto(estado, ancho < 260 ? 32 : 40)
      const ultima = c.lineas?.length ? c.lineas[c.lineas.length - 1] : ''
      card.tSalida.textContent = ultima ? corto(ultima, 34) : ''
      card.tInsignia.textContent = c.alarma ? (ALARMA[c.alarma]?.etiqueta ?? '') : ''
      card.tInsignia.setAttribute('class', c.alarma === 'pregunta' || c.alarma === 'permiso' ? `insignia ${c.alarma}` : 'insignia')
      // Clases del grupo.
      const clases = ['nodo', 'card']
      if (c.estado === 'corriendo') clases.push('activo')
      else if (c.estado === 'listo') clases.push('hecho')
      else if (c.estado === 'error') clases.push('falla')
      if (c.alarma && ALARMAS.includes(c.alarma)) clases.push(`alarma-${c.alarma}`)
      if (nueva) clases.push('card-entra')
      card.grupo.setAttribute('class', clases.join(' '))
      if (nueva) setTimeout(() => { card.grupo.classList.remove('card-entra'); card.dentro.classList.remove('card-entra') }, 400)
      // Tooltip de la card.
      card.grupo.dataset.nombre = nombre
      card.grupo.dataset.info = `${c.titulo || (INFO[c.agente]?.rol ?? '')} · ${c.modelo || ''} · ${c.estado}` + (c.tokensIn ? ` · ${miles(c.tokensIn)}→${miles(c.tokensOut ?? 0)} tokens` : '')
      if (nueva) ponerTooltip(card.grupo)
      // Aristas: del jefe a la card, y de la card a Verificar cuando ya terminó.
      const yMedio = y + CARD_ALTO / 2
      const dJefe = `M466 400 C 540 400, ${x - 70} ${yMedio}, ${x} ${yMedio}`
      if (caminos['jefe-' + c.id]) caminos['jefe-' + c.id].setAttribute('d', dJefe)
      else arista('jefe-' + c.id, dJefe, 'arista', true)
      if (c.estado === 'listo' || c.estado === 'error') {
        const xr = x + ancho
        const dVer = `M${xr} ${yMedio} C ${xr + (1170 - xr) / 2} ${yMedio}, 1140 125, 1170 125`
        if (caminos['ver-' + c.id]) caminos['ver-' + c.id].setAttribute('d', dVer)
        else arista('ver-' + c.id, dVer, 'arista')
      }
      // Alarma nueva: la card que antes no avisaba y ahora sí.
      const antes = card.alarma
      card.alarma = c.alarma
      if (c.alarma && !antes) nuevasAlarmas.push(c)
    })
    // Las cards que se van: fuera su grupo y sus aristas.
    for (const id of Object.keys(cards)) {
      if (vivos.has(id)) continue
      cards[id].grupo.remove()
      delete cards[id]
      for (const k of ['jefe-' + id, 'ver-' + id]) {
        const p = caminos[k]
        if (p) { p.remove(); delete caminos[k] }
      }
    }
    return nuevasAlarmas
  }

  // ---- actualizar con una lectura nueva ----
  let anterior = null
  let destelloRepeticion = 0
  function actualizar(d) {
    const fase = faseDe(d)
    const lista = tarjetasDe(d)
    const resumen = resumenDe(lista)
    montaje.querySelector('#g-num').textContent = fase.indice < 0 ? 'REPOSO' : `FASE ${fase.indice + 1} / 8`
    montaje.querySelector('#g-titulo').textContent = fase.titulo
    gTexto.textContent = fase.texto
    ;[...barra.children].forEach((s, i) => { s.className = i < fase.indice ? 'pasada' : i === fase.indice ? 'actual' : '' })
    rotuloVivo.textContent = fase.indice < 0 ? 'EN REPOSO' : `${resumen.activos} TRABAJANDO · ${d.jefe ?? 'Claude'} DE JEFE` + (resumen.alarmas ? ` · ${resumen.alarmas} ALARMAS` : '')
    jefeNombre.textContent = d.jefe ?? 'Claude'
    nodos.jefe.classList.toggle('activo', fase.indice === 1 || fase.indice === 6)
    nodos.verificar.classList.toggle('activo', fase.indice === 5)
    nodos.auditoria.classList.toggle('activo', fase.indice === 5)
    nodos.juntar.classList.toggle('activo', fase.indice === 6)
    nodos.informe.classList.toggle('activo', fase.indice === 7)
    listo.style.opacity = fase.indice === 7 ? 1 : 0
    movil.classList.toggle('vibra', fase.indice === 7 && !sinMovimiento)
    contador.textContent = String(resumen.activos)
    contadorLinea.textContent = resumen.alarmas ? `agentes activos · ⚠ ${resumen.alarmas} alarma${resumen.alarmas === 1 ? '' : 's'}` : 'agentes activos'

    // En pantallas estrechas el grafo se esconde (CSS) y esta lista cuenta lo mismo: una fila por card.
    const listaMovil = montaje.querySelector('#g-lista')
    listaMovil.replaceChildren(...lista.map(c => {
      const fila = document.createElement('div')
      fila.className = `g-fila${c.estado === 'corriendo' ? ' activo' : ''}${c.estado === 'error' ? ' falla' : ''}${c.alarma ? ` alarma-${c.alarma}` : ''}`
      let estado = 'en espera'
      if (c.estado === 'corriendo') estado = `● trabajando ${c.segundos} s`
      else if (c.estado === 'listo') estado = `✓ listo ${c.segundos} s`
      else if (c.estado === 'error') estado = '✗ falló'
      const cab = document.createElement('div')
      cab.className = 'g-cab'
      const nombre = document.createElement('b')
      nombre.textContent = INFO[c.agente]?.nombre ?? c.agente
      const st = document.createElement('span')
      st.textContent = `${estado}${c.puntaje !== undefined ? ` · ${c.puntaje}/10` : ''}${c.alarma ? ` · ⚠ ${ALARMA[c.alarma]?.etiqueta ?? ''}` : ''}`
      cab.append(nombre, st)
      const sub = document.createElement('small')
      sub.textContent = corto(c.modelo || '', 40)
      const pre = document.createElement('pre')
      pre.textContent = (c.lineas ?? []).map(l => corto(l, 48)).join('\n')
      fila.append(cab, sub, pre)
      return fila
    }))

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

    // Las cards: una por encargo, conectadas al jefe.
    const nuevasAlarmas = pintarCards(lista)
    for (const c of nuevasAlarmas) {
      const aviso = `${INFO[c.agente]?.nombre ?? c.agente} ${ALARMA[c.alarma]?.aviso ?? 'avisa'}`
      zonaAlerta.textContent = aviso
      if (fase.indice < 0) gTexto.textContent = aviso
      particula('jefe-' + c.id, VINO, 1.3, 4.5)
    }

    // Eventos: lo que acaba de pasar entre las dos lecturas se ve como partículas.
    for (const ev of eventosEntre(anterior, d)) {
      if (ev.tipo === 'plan') [0, 0.3, 0.6].forEach(r => retrasar(r, () => particula('tu-jefe', GRIS, 1.1)))
      if (ev.tipo === 'encargo') particula('jefe-' + ev.id, GRIS, 1.2)
      if (ev.tipo === 'cambio') {
        avisoCambio.textContent = `✗ ${ev.de} falló → pasa a ${ev.agente}`
        avisoCambio.style.opacity = 1
        clearTimeout(destelloRepeticion)
        destelloRepeticion = setTimeout(() => { avisoCambio.style.opacity = 0 }, 7000)
        particula('jefe-' + ev.id, VINO, 1.3, 4.5)
      }
      if (ev.tipo === 'resultado') {
        particula('ver-' + ev.id, ev.ok ? GRIS : VINO, 1.3)
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

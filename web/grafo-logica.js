// Lógica pura del grafo del centro: qué fase de la historia toca y qué cosas pasaron entre dos lecturas de los datos.
// No toca el DOM: la usan web/grafo.js en el navegador y los tests.

export const AGENTES = ['opencode', 'ollama', 'hermes', 'aider', 'codex', 'claude']
export const agenteDe = t => String(t.trabajador).split(':')[0]
export const modeloDe = t => String(t.trabajador).split(':').slice(1).join(':')

// Las 8 fases de una tarea. Índice -1 = reposo (sin plan).
export const FASES = [
  { nombre: 'Tarea', titulo: 'Llega la tarea', texto: 'Escribes /mst con lo que necesitas. La tarea llega al jefe.' },
  { nombre: 'Plan', titulo: 'El jefe planifica', texto: 'Divide la tarea en subtareas lo más independientes posible y las registra en el plan.' },
  { nombre: 'Reparto', titulo: 'Reparto en paralelo', texto: 'Lanza las subtareas a la vez. El centro elige el mejor modelo libre de cada agente según su historial.' },
  { nombre: 'Trabajo', titulo: 'Los agentes trabajan', texto: 'Cada agente trabaja en su copia o en sus archivos, sin pisarse. Sus terminales se ven en vivo.' },
  { nombre: 'Fallo', titulo: 'Un modelo falla', texto: 'Un modelo falló (sin red, sin cupo, o respuesta inválida). El centro lo aparta y pasa la subtarea a otro, sin que tengas que hacer nada.' },
  { nombre: 'Verificar', titulo: 'Verificación y notas', texto: 'El centro ejecuta los tests y el jefe revisa y pone nota a cada trabajo. Con menos de 6 se rehace.' },
  { nombre: 'Juntar', titulo: 'Juntar y rematar', texto: 'El jefe junta el trabajo de los agentes y cierra lo que falta del plan.' },
  { nombre: 'Listo', titulo: 'Todo listo', texto: 'Plan completo: se guarda el informe y te llega el aviso al móvil.' },
]
const REPOSO = { indice: -1, nombre: 'Reposo', titulo: 'Esperando una tarea', texto: 'Escribe /mst <tarea> en tu chat: el jefe planifica, reparte entre los agentes, verifica y te lo entrega.' }

const fin = t => (t.ms !== undefined ? t.inicio + t.ms : undefined)

// Qué fase es ahora, a partir del plan y de los trabajos.
export function faseDe(d) {
  const subs = d.plan?.subtareas ?? []
  const trabajos = d.trabajos ?? []
  const ahora = d.ahora ?? Date.now()
  const poner = i => ({ indice: i, ...FASES[i] })
  if (!subs.length) return REPOSO
  if (subs.every(s => s.estado === 'solucionado')) return poner(7)
  const corriendo = trabajos.filter(t => t.estado === 'corriendo')
  // Un fallo reciente al que otro agente ya está tomando el relevo (o que sigue sin resolver).
  const hayRelevo = trabajos.some(e => e.estado === 'error' && (fin(e) ?? 0) > ahora - 15_000 && (trabajos.some(n => n.subtarea === e.subtarea && n.inicio > e.inicio) || !corriendo.length))
  if (hayRelevo) return poner(4)
  if (corriendo.length) {
    const primero = Math.min(...corriendo.map(t => t.inicio))
    const nadaTerminado = trabajos.every(t => t.estado === 'corriendo')
    return poner(nadaTerminado && ahora - primero < 6000 ? 2 : 3)
  }
  if (!trabajos.length) return poner(1)
  if (trabajos.some(t => t.estado === 'listo' && t.puntaje === undefined)) return poner(5)
  return poner(6)
}

// Lo que pasó entre dos lecturas: la base de las partículas y los destellos del grafo. Sin lectura previa, nada (evita una ráfaga al abrir).
export function eventosEntre(antes, despues) {
  if (!antes || !despues) return []
  const previos = new Map((antes.trabajos ?? []).map(t => [t.id, t]))
  const eventos = []
  for (const t of despues.trabajos ?? []) {
    const p = previos.get(t.id)
    if (!p) {
      eventos.push({ tipo: 'encargo', agente: agenteDe(t), subtarea: t.subtarea, id: t.id })
      const fallo = (despues.trabajos ?? []).filter(e => e.estado === 'error' && e.subtarea === t.subtarea && e.inicio < t.inicio && agenteDe(e) !== agenteDe(t)).pop()
      if (fallo && t.subtarea !== undefined) eventos.push({ tipo: 'cambio', de: agenteDe(fallo), agente: agenteDe(t), subtarea: t.subtarea, id: t.id })
    } else {
      if (p.estado === 'corriendo' && t.estado !== 'corriendo') eventos.push({ tipo: 'resultado', agente: agenteDe(t), ok: t.estado === 'listo', subtarea: t.subtarea, id: t.id })
      if (p.puntaje === undefined && t.puntaje !== undefined) eventos.push({ tipo: 'nota', agente: agenteDe(t), puntaje: t.puntaje, subtarea: t.subtarea, id: t.id })
    }
  }
  const subsAntes = new Map((antes.plan?.subtareas ?? []).map(s => [s.n, s]))
  for (const s of despues.plan?.subtareas ?? []) {
    const p = subsAntes.get(s.n)
    if (p && p.estado !== 'solucionado' && s.estado === 'solucionado' && s.quien === 'jefe') eventos.push({ tipo: 'cierre', subtarea: s.n })
  }
  if (!(antes.plan?.subtareas ?? []).length && (despues.plan?.subtareas ?? []).length) eventos.push({ tipo: 'plan' })
  return eventos
}

// El estado visual de cada agente: qué trabajo muestra su terminal, si trabaja, falló, terminó o está apartado.
export function estadoAgente(d, nombre) {
  const suyos = (d.trabajos ?? []).filter(t => agenteDe(t) === nombre).sort((a, b) => a.inicio - b.inicio)
  const ahora = d.ahora ?? Date.now()
  const activo = suyos.filter(t => t.estado === 'corriendo').pop()
  const ultimo = activo ?? suyos[suyos.length - 1]
  const info = (d.agentes ?? []).find(a => a.nombre === nombre)
  const apartado = info && !info.ok ? info.nota : ''
  const falla = !!ultimo && ultimo.estado === 'error' && (fin(ultimo) ?? 0) > ahora - 8000
  const hecho = !!ultimo && ultimo.estado === 'listo'
  const nota = [...suyos].reverse().find(t => t.puntaje !== undefined)?.puntaje
  const lineas = ultimo ? String(ultimo.salida ?? '').split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean).slice(-3) : []
  return { activo: !!activo, falla, hecho, apartado, nota, ultimo, lineas, skills: !!ultimo?.skills?.length, modelo: ultimo ? modeloDe(ultimo) : '' }
}

// Las tres alarmas de una card: el trabajo lleva callado, o espera que el jefe conteste.
export const ALARMAS = ['silencio', 'pregunta', 'permiso']

// Cuántos trabajos ya terminados se guardan como card. Los que están corriendo entran siempre.
const LIMITE_TERMINADOS = 20

// Las últimas líneas no vacías de la salida de un trabajo.
const ultimasLineas = salida => String(salida ?? '').split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean).slice(-3)

// Una card por trabajo (encargo), en orden cronológico: los corriendo siempre, y de los terminados solo los 20 más recientes.
// Cada card trae su alarma: '' si nada; 'pregunta' o 'permiso' si el jefe tiene algo pendiente de ese trabajo; 'silencio' si lleva demasiado callado.
export function tarjetasDe(d) {
  const ahora = d.ahora ?? Date.now()
  const espera = d.esperaSilencioMs ?? 60_000
  const trabajos = d.trabajos ?? []
  const pendientes = d.pendientes ?? []
  const titulos = new Map((d.plan?.subtareas ?? []).map(s => [s.n, s.titulo]))
  const corriendo = trabajos.filter(t => t.estado === 'corriendo')
  const terminados = trabajos
    .filter(t => t.estado === 'listo' || t.estado === 'error')
    .sort((a, b) => b.inicio - a.inicio)
    .slice(0, LIMITE_TERMINADOS)
  return [...corriendo, ...terminados]
    .sort((a, b) => a.inicio - b.inicio)
    .map(t => {
      const activa = t.estado === 'corriendo'
      const pendiente = pendientes.find(p => p.id === t.id)
      const ultima = t.ultimaActividad ?? t.inicio
      const alarma = !activa ? '' : pendiente ? pendiente.tipo : ahora - ultima > espera ? 'silencio' : ''
      return {
        id: t.id,
        agente: agenteDe(t),
        modelo: modeloDe(t),
        subtarea: t.subtarea,
        titulo: titulos.get(t.subtarea) ?? '',
        estado: t.estado,
        alarma,
        // Cuánto lleva sin escribir (solo tiene sentido mientras trabaja).
        callado: activa ? Math.max(0, Math.round((ahora - ultima) / 1000)) : 0,
        segundos: activa ? Math.max(0, Math.round((ahora - t.inicio) / 1000)) : Math.round((t.ms ?? 0) / 1000),
        tokensIn: t.tokensIn,
        tokensOut: t.tokensOut,
        lineas: ultimasLineas(t.salida),
        puntaje: t.puntaje,
        skills: !!t.skills?.length,
        clasificacion: t.clasificacion,
      }
    })
}

// El resumen de las cards: cuántas van activas, cuántas avisan, el reparto por agente y qué ids tienen alarma.
export function resumenDe(tarjetas) {
  const lista = tarjetas ?? []
  const porAgente = {}
  const conAlarma = []
  let activos = 0
  let alarmas = 0
  for (const c of lista) {
    if (c.estado === 'corriendo') {
      activos++
      porAgente[c.agente] = (porAgente[c.agente] ?? 0) + 1
    }
    if (c.alarma) {
      alarmas++
      conAlarma.push(c.id)
    }
  }
  return { activos, alarmas, porAgente, conAlarma }
}

// ===== NUEVO: lógica del grafo con planes múltiples =====

export const FASES_PLAN = ['Planeación', 'Reparto', 'En proceso', 'Verificación', 'Auditoría', 'Juntar', 'Informe']

function normalizarObjetivo(obj) {
  return String(obj ?? '').trim()
}

export function gruposDe(d) {
  const ahora = d.ahora ?? Date.now()
  const planActual = d.plan
  const planesAnteriores = d.planes ?? []
  const trabajos = d.trabajos ?? []

  // Mapa de objetivo -> grupo
  const gruposMap = new Map()

  // Primero: plan actual (si existe)
  if (planActual && planActual.objetivo) {
    const objetivo = normalizarObjetivo(planActual.objetivo)
    const subtareas = planActual.subtareas ?? []
    const hechas = subtareas.filter(s => s.estado === 'solucionado').length
    const total = subtareas.length
    gruposMap.set(objetivo, {
      id: objetivo,
      objetivo,
      actual: true,
      subtareas,
      hechas,
      total,
      trabajos: [],
      tarjetas: [],
      corriendo: 0,
      alarmas: 0,
      ultima: 0,
      activo: true, // el actual siempre es activo
    })
  }

  // Planes anteriores: solo los que tengan objetivo distinto al actual
  const objetivoActual = planActual ? normalizarObjetivo(planActual.objetivo) : null
  for (const p of planesAnteriores) {
    if (!p?.objetivo) continue
    const objetivo = normalizarObjetivo(p.objetivo)
    if (objetivoActual && objetivo === objetivoActual) continue // el actual manda
    if (gruposMap.has(objetivo)) continue
    const subtareas = p.subtareas ?? []
    const hechas = subtareas.filter(s => s.estado === 'solucionado').length
    const total = subtareas.length
    gruposMap.set(objetivo, {
      id: objetivo,
      objetivo,
      actual: false,
      subtareas,
      hechas,
      total,
      trabajos: [],
      tarjetas: [],
      corriendo: 0,
      alarmas: 0,
      ultima: 0,
      activo: false, // se recalcula después
    })
  }

  // Grupo (sin plan) para trabajos sin plan y sin plan actual
  let grupoSinPlan = null
  if (!objetivoActual) {
    grupoSinPlan = {
      id: '(sin plan)',
      objetivo: '(sin plan)',
      actual: false,
      subtareas: [],
      hechas: 0,
      total: 0,
      trabajos: [],
      tarjetas: [],
      corriendo: 0,
      alarmas: 0,
      ultima: 0,
      activo: false,
    }
    gruposMap.set('(sin plan)', grupoSinPlan)
  }

  // Asignar trabajos a sus grupos (y crear grupos para objetivos que solo aparecen en trabajos)
  const objetivosEnTrabajos = new Set()
  for (const t of trabajos) {
    const objetivoTrabajo = normalizarObjetivo(t.plan)
    if (objetivoTrabajo) {
      objetivosEnTrabajos.add(objetivoTrabajo)
    }
  }

  // Crear grupos para objetivos que solo están en trabajos (no en plan actual ni planes anteriores)
  for (const objetivo of objetivosEnTrabajos) {
    if (!gruposMap.has(objetivo)) {
      gruposMap.set(objetivo, {
        id: objetivo,
        objetivo,
        actual: false,
        subtareas: [], // no se conocen las subtareas
        hechas: 0,
        total: 0,
        trabajos: [],
        tarjetas: [],
        corriendo: 0,
        alarmas: 0,
        ultima: 0,
        activo: false, // se recalcula después
      })
    }
  }

  // Asignar trabajos a sus grupos
  for (const t of trabajos) {
    const objetivoTrabajo = normalizarObjetivo(t.plan)
    let grupo = objetivoTrabajo ? gruposMap.get(objetivoTrabajo) : null
    if (!grupo) {
      if (objetivoActual) {
        grupo = gruposMap.get(objetivoActual)
      } else {
        grupo = grupoSinPlan
      }
    }
    if (grupo) {
      grupo.trabajos.push(t)
    }
  }

  // En la vista de todos los chats no hay un plan actual común: el grupo "(sin plan)" general no pinta nada si está vacío.
  if (grupoSinPlan && d.omitirSinPlanVacio && !grupoSinPlan.trabajos.length) gruposMap.delete('(sin plan)')

  // Calcular campos derivados por grupo
  const grupos = []
  for (const grupo of gruposMap.values()) {
    const trabajosGrupo = grupo.trabajos
    const corriendo = trabajosGrupo.filter(t => t.estado === 'corriendo').length
    // Los títulos de las cards salen de las subtareas de SU plan (las del actual no sirven para un plan anterior).
    const tarjetas = tarjetasDe({ ...d, plan: { objetivo: grupo.objetivo, subtareas: grupo.subtareas }, trabajos: trabajosGrupo, ahora })
    const alarmas = tarjetas.filter(c => c.alarma).length
    const ultima = trabajosGrupo.length > 0 ? Math.max(...trabajosGrupo.map(t => t.inicio)) : 0
    const activo = grupo.actual || corriendo > 0

    const fase = faseDeGrupo({ ...grupo, subtareas: grupo.subtareas, trabajos: trabajosGrupo, hechas: grupo.hechas, total: grupo.total }, ahora)

    grupos.push({
      ...grupo,
      corriendo,
      tarjetas,
      alarmas,
      ultima,
      activo,
      fase,
      progreso: { hechas: grupo.hechas, total: grupo.total },
    })
  }

  // Orden: actual primero, luego activos por ultima desc, luego atenuados por ultima desc
  grupos.sort((a, b) => {
    if (a.actual && !b.actual) return -1
    if (!a.actual && b.actual) return 1
    if (a.activo && !b.activo) return -1
    if (!a.activo && b.activo) return 1
    return b.ultima - a.ultima
  })

  return grupos
}

export function faseDeGrupo(grupo, ahora = Date.now()) {
  const { subtareas = [], trabajos = [], hechas = 0, total = subtareas.length } = grupo

  const sinSolucionar = subtareas.filter(s => s.estado !== 'solucionado')
  if (sinSolucionar.length && sinSolucionar.every(s => s.estado === 'realizado')) {
    return { indice: 3, nombre: FASES_PLAN[3] }
  }

  // Si total > 0 y hechas === total → Informe (6)
  if (total > 0 && hechas === total) {
    return { indice: 6, nombre: FASES_PLAN[6] }
  }

  // Si no hay trabajos → Planeación (0)
  if (trabajos.length === 0) {
    return { indice: 0, nombre: FASES_PLAN[0] }
  }

  const corriendo = trabajos.filter(t => t.estado === 'corriendo')

  // Si hay trabajos 'corriendo'
  if (corriendo.length > 0) {
    const masAntiguo = Math.min(...corriendo.map(t => t.inicio))
    const ningunoTerminado = trabajos.every(t => t.estado === 'corriendo')
    if (ningunoTerminado && ahora - masAntiguo < 6000) {
      return { indice: 1, nombre: FASES_PLAN[1] } // Reparto
    }
    return { indice: 2, nombre: FASES_PLAN[2] } // En proceso
  }

  // No hay ninguno corriendo
  const listos = trabajos.filter(t => t.estado === 'listo')
  const sinNota = listos.filter(t => t.puntaje === undefined).length
  const conNota = listos.filter(t => t.puntaje !== undefined).length

  if (sinNota > 0 && conNota > 0) {
    return { indice: 4, nombre: FASES_PLAN[4] } // Auditoría
  }
  if (sinNota > 0) {
    return { indice: 3, nombre: FASES_PLAN[3] } // Verificación
  }

  // Todos los 'listo' tienen nota (o no hay 'listo')
  // Mirar subtareas que NO están hechas
  const pendientes = subtareas.filter(s => s.estado !== 'solucionado')
  const algunaConTrabajos = pendientes.some(sub =>
    trabajos.some(t => t.subtarea === sub.n)
  )

  if (!algunaConTrabajos) {
    return { indice: 5, nombre: FASES_PLAN[5] } // Juntar
  }

  return { indice: 2, nombre: FASES_PLAN[2] } // En proceso
}

export function rejilla(items, opciones = {}) {
  const {
    columnas = items.length === 1 ? 1 : items.length <= 4 ? 2 : 3,
    hueco = 12,
    margen = 16,
    cabecera = 56,
    anchoMinimo = 240,
  } = opciones

  if (!items.length) {
    return {
      w: anchoMinimo,
      h: cabecera + margen,
      posiciones: [],
    }
  }

  const n = items.length
  const cols = Math.min(columnas, n)
  const filas = Math.ceil(n / cols)

  // Ancho de cada columna = max w de items en esa columna
  const anchosCol = new Array(cols).fill(0)
  const altosFil = new Array(filas).fill(0)

  for (let i = 0; i < n; i++) {
    const col = i % cols
    const fil = Math.floor(i / cols)
    anchosCol[col] = Math.max(anchosCol[col], items[i].w)
    altosFil[fil] = Math.max(altosFil[fil], items[i].h)
  }

  const posiciones = []
  let x = margen
  const xs = [margen]
  for (let c = 0; c < cols - 1; c++) {
    x += anchosCol[c] + hueco
    xs.push(x)
  }

  let y = cabecera + margen
  const ys = [cabecera + margen]
  for (let f = 0; f < filas - 1; f++) {
    y += altosFil[f] + hueco
    ys.push(y)
  }

  for (let i = 0; i < n; i++) {
    const col = i % cols
    const fil = Math.floor(i / cols)
    posiciones.push({ x: xs[col], y: ys[fil] })
  }

  const w = Math.max(anchoMinimo, margen * 2 + anchosCol.reduce((a, b) => a + b, 0) + hueco * (cols - 1))
  // Margen arriba (tras la cabecera) y abajo: el último nodo no toca el borde del cuadrado.
  const h = cabecera + margen * 2 + altosFil.reduce((a, b) => a + b, 0) + hueco * (filas - 1)

  return { w, h, posiciones }
}

export function colocarGrupos(grupos, opciones = {}) {
  const { radio = 110 } = opciones
  const huecoBase = 70
  const huecoAtenuado = 170
  const separacion = 24
  const margenCaja = 60

  // Ángulos en grados (0 = este, 90 = sur, positivo hacia abajo)
  // Saltando ±40° alrededor del norte (-90°)
  const angulosBase = [
    0, 90, 180, 45, 135, -45, -135,
    22.5, 112.5, 157.5, 67.5, -22.5, -157.5, -67.5
  ]
  // Añadir el resto de 30 en 30 desde 0, saltando los que caen a menos de 40° del norte (-90°)
  for (let a = 0; a < 360; a += 30) {
    const diff = Math.abs((a + 90 + 180) % 360 - 180) // distancia a -90°
    if (diff >= 40 && !angulosBase.some(b => Math.abs(b - a) < 1 || Math.abs(b - a) > 359)) {
      angulosBase.push(a)
    }
  }

  const posiciones = []

  for (let i = 0; i < grupos.length; i++) {
    const g = grupos[i]
    const w = g.w
    const h = g.h
    const activo = g.activo

    let angulo = angulosBase[i % angulosBase.length]
    const rad = (angulo * Math.PI) / 180

    const apoyo = Math.abs(Math.cos(rad)) * w / 2 + Math.abs(Math.sin(rad)) * h / 2
    const hueco = activo ? huecoBase : huecoAtenuado
    let d = radio + hueco + apoyo

    // Resolver choques: mientras se solape con alguno anterior, alejar
    let vueltas = 0
    while (vueltas < 300) {
      const x = d * Math.cos(rad)
      const y = d * Math.sin(rad)
      const x0 = x - w / 2
      const y0 = y - h / 2
      const x1 = x + w / 2
      const y1 = y + h / 2

      let choque = false
      for (const p of posiciones) {
        const px0 = p.x - p.w / 2 - separacion
        const py0 = p.y - p.h / 2 - separacion
        const px1 = p.x + p.w / 2 + separacion
        const py1 = p.y + p.h / 2 + separacion
        if (x0 < px1 && x1 > px0 && y0 < py1 && y1 > py0) {
          choque = true
          break
        }
      }

      if (!choque) {
        posiciones.push({ id: g.id, x, y, w, h })
        break
      }

      d += 20
      vueltas++
    }
  }

  // Calcular caja que contiene todo + círculo de Claude
  let x0 = -radio - margenCaja
  let y0 = -radio - margenCaja
  let x1 = radio + margenCaja
  let y1 = radio + margenCaja

  for (const p of posiciones) {
    x0 = Math.min(x0, p.x - p.w / 2 - margenCaja)
    y0 = Math.min(y0, p.y - p.h / 2 - margenCaja)
    x1 = Math.max(x1, p.x + p.w / 2 + margenCaja)
    y1 = Math.max(y1, p.y + p.h / 2 + margenCaja)
  }

  // Devolver solo x,y (centro de cada cuadrado)
  const posicionesOut = posiciones.map(p => ({ id: p.id, x: p.x, y: p.y }))

  return {
    posiciones: posicionesOut,
    caja: { x0, y0, x1, y1 },
  }
}

// La vista común: junta los datos de varios chats en una sola lectura para dibujarlos en el mismo grafo.
// Cada plan lleva delante el nombre de su chat; los ids de trabajos y consultas se pasan a "<chat>|<id>" para saber a qué chat va una respuesta.
export function unirChats(chats, ahora) {
  const planes = []
  const trabajos = []
  const pendientes = []
  const recientes = [...chats].sort((a, b) => (b.en ?? 0) - (a.en ?? 0))
  for (const c of chats) {
    const d = c.datos ?? {}
    const con = o => `${c.nombre} · ${o}`
    const pre = id => `${c.id}|${id}`
    const todosLosPlanes = [...(d.plan?.objetivo ? [d.plan] : []), ...(d.planes ?? []).filter(p => p?.objetivo)]
    for (const p of todosLosPlanes) planes.push({ ...p, objetivo: con(normalizarObjetivo(p.objetivo)) })
    let sinPlan = false
    for (const t of d.trabajos ?? []) {
      const objetivo = normalizarObjetivo(t.plan)
      if (!objetivo) sinPlan = true
      trabajos.push({ ...t, id: pre(t.id), plan: con(objetivo || '(sin plan)') })
    }
    if (sinPlan) planes.push({ objetivo: con('(sin plan)'), subtareas: [] })
    for (const p of d.pendientes ?? []) pendientes.push({ ...p, id: pre(p.id), consulta: pre(p.consulta) })
  }
  const base = recientes[0]?.datos ?? {}
  return { jefe: 'Claude', ahora, plan: null, omitirSinPlanVacio: true, planes, trabajos, pendientes, agentes: base.agentes ?? [], modelos: base.modelos, esperaSilencioMs: base.esperaSilencioMs ?? 60000 }
}

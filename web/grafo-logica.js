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
  if (subs.every(s => s.estado === 'hecha')) return poner(7)
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
    if (p && p.estado !== 'hecha' && s.estado === 'hecha' && s.quien === 'jefe') eventos.push({ tipo: 'cierre', subtarea: s.n })
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
        segundos: activa ? Math.max(0, Math.round((ahora - t.inicio) / 1000)) : Math.round((t.ms ?? 0) / 1000),
        tokensIn: t.tokensIn,
        tokensOut: t.tokensOut,
        lineas: ultimasLineas(t.salida),
        puntaje: t.puntaje,
        skills: !!t.skills?.length,
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

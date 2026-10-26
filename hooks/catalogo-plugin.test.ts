import { expect, mock, test } from 'claude-code/testing'

import { construir } from './catalogo'
import type { Catalogo, Fuente, ModelosPorAgente } from './catalogo'
import { ordenar } from './nucleo'
import { refrescarCatalogo, reiniciarCatalogoParaPruebas } from './register'
import { scriptFalso } from './scriptFalso'

const out = (r: any) => JSON.parse(r.result)

// Los modelos por defecto del plugin que importan a la capacidad de imagen; hermes y aider
// se dejan vacíos a propósito para que el catálogo no los invente.
const MODELOS: ModelosPorAgente = {
  ollama: ['gemma4:31b-cloud', 'gpt-oss:120b-cloud'],
  opencode: ['opencode/deepseek-v4.1-flash-free', 'opencode/big-pickle'],
  hermes: [],
  aider: [],
  codex: ['chatgpt'],
  claude: [],
}

// El catálogo mezcla las dos fuentes reales: ollama show para los modelos de Ollama y
// models.dev para los de OpenCode. big-pickle no acepta imágenes; deepseek sí.
const DATOS = {
  ollama: {
    'gemma4:31b-cloud': { capacidades: { imagen: true, herramientas: true, razonamiento: true }, contexto: 32_000 },
    // A propósito puntúa más que deepseek: sin el filtro de capacidad, el centro lo elegiría.
    'gpt-oss:120b-cloud': { capacidades: { imagen: false, herramientas: true, razonamiento: true }, contexto: 1_000_000 },
  },
  modelsDev: {
    'deepseek-v4.1-flash-free': { modalities: { input: ['text', 'image'] }, tool_call: true, reasoning: true, limit: { context: 200_000 } },
    'big-pickle': { modalities: { input: ['text'] }, tool_call: true, reasoning: false, limit: { context: 128_000 } },
  },
}

const FUENTES: Fuente[] = [
  { nombre: 'ollama', ok: true, fecha: '2026-10-25' },
  { nombre: 'models.dev', ok: true, fecha: '2026-10-25' },
]

const catalogoDe = (ahora = Date.UTC(2026, 9, 25), modelos = MODELOS) => construir(modelos, DATOS, ahora, FUENTES)

// Lo mínimo que necesita register en cada prueba: almacén, reloj y avisos.
// `run` reemplaza el simulador de process.run cuando la prueba quiere otra respuesta
// (el harness no permite registrar el mismo evento dos veces).
const base = (on: any, run?: (e: any) => any) => {
  mock.store(on)
  mock.clock(on)
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('env.get', async () => ({ value: 'C:\\Users\\Prueba' }))
  on('fs.exists', async () => ({ value: false }))
  // Salida vacía: hayRed la interpreta como "hay red" para no cortar los agentes.
  on('process.run', run ?? (async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } })))
}

// El catálogo se lee de la carpeta web del chat; el resto de lecturas no se simulan.
const conCatalogo = (on: any, catalogo: Catalogo) =>
  on('fs.read', async (_$: any, e: any) => {
    const ruta = String(e?.path ?? e)
    if (ruta.endsWith('catalogo.json')) return { value: JSON.stringify(catalogo) }
    throw new Error(`ruta no simulada: ${ruta}`)
  })

// Simula el proceso de cada agente con la salida que sabe leer su parser.
const agentes = (on: any) => {
  const vistos: { argv: string[]; input?: string }[] = []
  on('process.spawn', async function* (_$: any, e: any) {
    vistos.push({ argv: e.argv, input: e.input })
    const texto = e.argv[0] === 'codex'
      ? '{"type":"item.completed","item":{"type":"agent_message","text":"hecho"}}'
      : e.argv[0] === 'claude'
        ? '{"type":"assistant","message":{"content":[{"type":"text","text":"hecho"}]}}'
        : e.argv[0] === 'opencode' ? '{"type":"text","part":{"text":"hecho"}}' : 'hecho'
    yield { stream: 'stdout', text: texto }
    return { value: { code: 0, signal: null } }
  })
  return vistos
}

// (a) La detección de imágenes debe dejar pasar solo modelos con visión y decirlo en el resultado,
// para que el jefe no tenga que adivinar por qué eligió ese agente.
test('una tarea con capturas solo se delega a un modelo con imagen', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  conCatalogo(on, catalogoDe())
  const vistos = agentes(on)

  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { categoria: 'texto', tarea: 'Transcribe el texto de estas capturas de pantalla' } }))

  // Un solo proceso: el resto de candidatos sin imagen ni se intentan.
  expect(vistos).toHaveLength(1)
  expect(vistos[0].argv[0]).toBe('opencode')
  expect(vistos[0].argv).toContain('opencode/deepseek-v4.1-flash-free')
  expect(d.trabajador).toBe('opencode:opencode/deepseek-v4.1-flash-free')
  expect(d.exito).toBe(true)
  // Necesidad detectada, no pedida: el resultado lo marca como tal.
  expect(d.necesita).toEqual(['imagen'])
  expect(d.detectada).toBe(true)
})

// (b) Sin ningún candidato con visión no se prueba suerte: se devuelve un error que explica
// la capacidad que falta y la subtarea del plan no se reserva ni se lanza.
test('sin modelos con imagen devuelve error y la subtarea sigue pendiente', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  // Claude y Codex también entran en el catálogo para tapar la tabla del plugin y que
  // de verdad no quede ningún modelo con imagen.
  const modelos: ModelosPorAgente = { ...MODELOS, claude: ['haiku', 'sonnet', 'opus'] }
  const catalogo = catalogoDe(Date.UTC(2026, 9, 25), modelos)
  for (const e of catalogo.modelos) e.capacidades = { ...e.capacidades, imagen: false }
  conCatalogo(on, catalogo)
  let lanzados = 0
  const falso = scriptFalso(on, { agente: () => { lanzados++; return {} } })

  await $.tool.call({ tool: 'mcp__centro-agentes__planificar', input: { objetivo: 'demo', subtareas: ['mirar capturas'], cwd: 'C:/proyecto' } })
  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { categoria: 'texto', tarea: 'Transcribe estas capturas de pantalla', subtarea: 1 } }))

  expect(lanzados).toBe(0)
  expect(d.error).toContain('imagen')
  expect(d.error).toContain('Ningún modelo conocido')
  expect(falso.archivo.tareas[0].subtareas[0].estado).toBe('pendiente')
})

// (c) Si el jefe fuerza un modelo sin visión a propósito, se usa (puede que sí sirva por otra vía),
// pero el resultado avisa para que no pase desapercibido.
test('un modelo pedido sin imagen se usa con aviso_capacidad', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  conCatalogo(on, catalogoDe())
  const vistos = agentes(on)

  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'ollama', modelo: 'gpt-oss:120b-cloud', categoria: 'texto', tarea: 'Lee estas capturas de pantalla' } }))

  expect(vistos).toHaveLength(1)
  expect(vistos[0].argv).toEqual(['ollama', 'run', '--verbose', '--nowordwrap', '--hidethinking', 'gpt-oss:120b-cloud'])
  expect(d.trabajador).toBe('ollama:gpt-oss:120b-cloud')
  expect(d.necesita).toEqual(['imagen'])
  expect(d.aviso_capacidad).toContain('gpt-oss:120b-cloud')
  expect(d.aviso_capacidad).toContain('no la tiene')
})

// (d) necesita: [] es una orden explícita del jefe: no se filtra ni se vuelve a detectar,
// aunque el texto hable de imágenes.
test('necesita vacío desactiva la detección aunque la tarea mencione capturas', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  conCatalogo(on, catalogoDe())
  agentes(on)

  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { necesita: [], categoria: 'texto', tarea: 'Transcribe estas capturas de pantalla' } }))

  expect(d.exito).toBe(true)
  expect(d).not.toHaveProperty('necesita')
  expect(d).not.toHaveProperty('detectada')
})

// (e) Una tarea normal no debe arrastrar necesidades: si no hay imágenes, no se filtra nada.
test('una tarea sin imágenes no se filtra ni marca necesidades', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  conCatalogo(on, catalogoDe())
  agentes(on)

  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { categoria: 'codigo', tarea: 'Corrige la función suma' } }))

  expect(d.exito).toBe(true)
  expect(d).not.toHaveProperty('necesita')
  expect(d).not.toHaveProperty('detectada')
})

// (f) Sin catálogo solo queda la tabla fija del plugin (Claude y Codex chatgpt tienen visión);
// el resto de agentes tiene capacidad desconocida y no se elige.
test('sin catálogo una tarea de imágenes solo va a Claude o Codex', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  on('fs.read', async () => { throw new Error('no hay catálogo') })
  const vistos = agentes(on)

  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { categoria: 'texto', tarea: 'Transcribe estas capturas de pantalla' } }))

  expect(vistos).toHaveLength(1)
  expect(vistos[0].argv[0]).toBe('codex')
  expect(d.trabajador).toBe('codex:chatgpt')
  expect(d.necesita).toEqual(['imagen'])
})

// (f bis) La otra rama del caso: sin catálogo quedan Claude y Codex; si además ninguna de las dos
// responde (su host no se alcanza, según la salud de red), no se lanza ningún agente y el resultado
// trae el error que lo dice.
test('sin catálogo y sin conexión a claude ni codex devuelve el error claro', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  on('fs.read', async () => { throw new Error('no hay catálogo') })
  // La sonda de red devuelve 000 (host inalcanzable) para los hosts de Codex (chatgpt.com) y
  // de Claude (api.anthropic.com); para el resto vacía, que hayRed interpreta como alcanzado.
  const run = async (_$: any, e: any) => {
    const host = String(e.argv[e.argv.length - 1])
    const sinRed = host.includes('chatgpt.com') || host.includes('anthropic')
    return { value: { exitCode: 0, stdout: sinRed ? '000' : '', stderr: '', isStdoutTruncated: false } }
  }
  base(on, run)
  const vistos = agentes(on)

  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { categoria: 'texto', tarea: 'Transcribe estas capturas de pantalla' } }))

  expect(vistos).toHaveLength(0)
  expect(d.error).toContain('Todos los modelos posibles')
  expect(d.error).toContain('fallaron')
})

// (g) El desempate del catálogo es puro: no debe alterar el orden de siempre sin catálogo,
// y con catálogo debe preferir capacidades y luego repartir el trabajo.
test('ordenar: lista, puntos del catálogo, usos y nota, en ese orden de prioridad', () => {
  const c = (modelo: string) => ({ trabajador: 'ollama' as const, modelo })

  // Sin catálogo ni historial, el orden es exactamente el de la lista (no se reordena nada).
  expect(ordenar({}, 'x', [c('a'), c('b'), c('c')], new Set()).map(x => x.modelo)).toEqual(['a', 'b', 'c'])

  // A igual nota, gana quien más puntos suma: herramientas, razonamiento y contexto.
  const modelos: ModelosPorAgente = { ollama: ['poco', 'mucho'], opencode: [], hermes: [], aider: [], codex: [], claude: [] }
  const catalogo = construir(modelos, { ollama: {
    poco: { capacidades: { herramientas: false } },
    mucho: { capacidades: { herramientas: true, razonamiento: true }, contexto: 64_000 },
  } }, Date.UTC(2026, 9, 25), [])
  expect(ordenar({}, 'x', [c('poco'), c('mucho')], new Set(), catalogo).map(x => x.modelo)).toEqual(['mucho', 'poco'])

  // A igual nota y puntos, gana quien menos usos suma entre TODAS las categorías.
  const plano = construir({ ...modelos, ollama: ['x', 'y'] }, {}, Date.UTC(2026, 9, 25), [])
  const tabla = { uno: { 'ollama:x': { n: 3, suma: 15, msTotal: 0 } }, dos: { 'ollama:y': { n: 1, suma: 5, msTotal: 0 } } }
  expect(ordenar(tabla, 'x', [c('x'), c('y')], new Set(), plano).map(x => x.modelo)).toEqual(['y', 'x'])

  // Una nota mayor gana siempre, aunque el otro tenga más puntos y menos usos.
  const tablaNotas = { x: { 'ollama:x': { n: 1, suma: 9, msTotal: 0 }, 'ollama:y': { n: 1, suma: 7, msTotal: 0 } } }
  expect(ordenar(tablaNotas, 'x', [c('y'), c('x')], new Set(), catalogo).map(x => x.modelo)).toEqual(['x', 'y'])
})

// (h) La herramienta modelos es la vista del catálogo para el jefe: capacidades legibles,
// filtros y la nota que ya tiene guardada cada modelo.
test('la herramienta modelos lista capacidades, filtra y suma la nota guardada', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  const catalogo = catalogoDe()
  conCatalogo(on, catalogo)
  agentes(on)

  const todos = out(await $.tool.call({ tool: 'mcp__centro-agentes__modelos', input: {} }))
  expect(todos.total).toBe(catalogo.modelos.length)
  expect(todos.generado).toBe(catalogo.generado)
  const de = (agente: string, modelo: string) => todos.modelos.find((m: any) => m.agente === agente && m.modelo === modelo)
  // Las capacidades salen como 'si' | 'no' | 'desconocido', nunca como booleanos.
  expect(de('opencode', 'opencode/deepseek-v4.1-flash-free')).toMatchObject({ imagen: 'si', herramientas: 'si', razonamiento: 'si' })
  expect(de('opencode', 'opencode/big-pickle')).toMatchObject({ imagen: 'no', razonamiento: 'no' })
  expect(de('ollama', 'gpt-oss:120b-cloud')).toMatchObject({ imagen: 'no', herramientas: 'si', razonamiento: 'si' })
  // La tabla del plugin no dice si Codex razona: eso queda como 'desconocido', no como 'no'.
  expect(de('codex', 'chatgpt')).toMatchObject({ imagen: 'si', herramientas: 'si', razonamiento: 'desconocido' })

  const porAgente = out(await $.tool.call({ tool: 'mcp__centro-agentes__modelos', input: { agente: 'opencode', necesita: ['imagen'] } }))
  expect(porAgente.total).toBe(1)
  expect(porAgente.modelos.map((m: any) => m.modelo)).toEqual(['opencode/deepseek-v4.1-flash-free'])
  const porCapacidad = out(await $.tool.call({ tool: 'mcp__centro-agentes__modelos', input: { agente: 'ollama', necesita: ['imagen'] } }))
  expect(porCapacidad.modelos.map((m: any) => m.modelo)).toEqual(['gemma4:31b-cloud'])

  // Un trabajo auditado deja su nota en el almacén; modelos la resume con nota_media y veces.
  const d = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'ollama', modelo: 'gemma4:31b-cloud', categoria: 'texto', tarea: 'Corrige la función suma' } }))
  await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: d.id, puntaje: 8 } })
  const conNota = out(await $.tool.call({ tool: 'mcp__centro-agentes__modelos', input: { agente: 'ollama' } }))
  expect(conNota.modelos.find((m: any) => m.modelo === 'gemma4:31b-cloud')).toMatchObject({ nota_media: 8, veces: 1 })
  expect(conNota.modelos.find((m: any) => m.modelo === 'gpt-oss:120b-cloud')).not.toHaveProperty('nota_media')
})

// (h bis) Sin catálogo la herramienta no debe inventar modelos: avisa de que se genera al iniciar.
test('modelos sin catálogo devuelve existe falso con el aviso exacto', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  on('fs.read', async () => { throw new Error('no hay catálogo') })

  const r = out(await $.tool.call({ tool: 'mcp__centro-agentes__modelos', input: {} }))
  expect(r).toEqual({ existe: false, aviso: 'Aún no hay catálogo: se genera al iniciar la sesión (puede tardar unos segundos).' })
})

// (i) refrescarCatalogo lanza el script del catálogo con la lista de modelos por la entrada
// estándar, pasa --sin-linea según el ajuste y nunca revienta la sesión si el proceso falla.
test('refrescarCatalogo pasa los modelos y respeta --sin-linea sin lanzar excepciones', async () => {
  reiniciarCatalogoParaPruebas()
  // shortcut: el $ de las pruebas no trae $.process ni $.plugin (ese motor completo solo vive dentro
  // de los manejadores, p. ej. en tool.call), así que refrescarCatalogo prueba con un motor mínimo
  // con lo único que usa: env.get, fs.read y process.spawn.
  const vistos: { argv: string[]; input?: string }[] = []
  let fallar = false
  const motor = {
    env: { get: async () => 'C:\\Users\\Prueba' },
    fs: { read: async () => { throw new Error('no hay catálogo') } },
    process: {
      spawn: (init: any) => {
        vistos.push({ argv: init.argv, input: init.input })
        return (async function* () {
          if (fallar) throw new Error('spawn roto')
        })()
      },
    },
  } as any

  await refrescarCatalogo(motor, MODELOS, false)
  await refrescarCatalogo(motor, MODELOS, true)

  expect(vistos).toHaveLength(2)
  for (const v of vistos) {
    // Sin $.plugin la raíz queda vacía: la ruta acaba igualmente en mcp/catalogo.mjs.
    expect(v.argv[0]).toBe('node')
    expect(v.argv[1].endsWith('mcp/catalogo.mjs')).toBe(true)
    expect(v.argv[2]).toBe('actualizar')
    // La lista de modelos va entera por la entrada estándar, tal como la leerá mcp/catalogo.mjs.
    expect(JSON.parse(v.input ?? '')).toEqual(MODELOS)
  }
  expect(vistos[0].argv).toContain('--sin-linea')
  expect(vistos[1].argv).not.toContain('--sin-linea')

  // El fallo del proceso se traga: la sesión sigue y se intenta releer el catálogo.
  fallar = true
  await expect(refrescarCatalogo(motor, MODELOS, true)).resolves.toBeUndefined()
})

import { expect, mock, test } from 'claude-code/testing'

import { reiniciarCatalogoParaPruebas } from './register'

// Con el ajuste lanzadorDesacoplado el plugin no lee el stream del agente: lo lanza con mcp/lanzador.mjs y lee de disco.
// Aquí el motor simulado hace de lanzador: deja el log y el fin.json en un disco en memoria.
const out = (r: any) => JSON.parse(r.result)
const esperar = async (f: () => boolean | Promise<boolean>) => { let ok = await f(); for (let i = 0; i < 400 && !ok; i++) { await new Promise(r => setTimeout(r, 10)); ok = await f() }; expect(ok).toBe(true) }

const montar = (on: any, alLanzar: (disco: Map<string, string>, carpeta: string, id: string) => void) => {
  reiniciarCatalogoParaPruebas()
  mock.store(on); mock.clock(on)
  const disco = new Map<string, string>()
  const lanzados: string[][] = []
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('env.get', async () => ({ value: 'C:\\Users\\Prueba' }))
  on('fs.exists', async () => ({ value: false }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
  on('fs.write', async (_$: any, e: any) => { disco.set(String(e?.path).replace(/\\/g, '/'), String(e?.content ?? e?.text ?? e?.data ?? '')); return { value: undefined } })
  on('fs.read', async (_$: any, e: any) => {
    const ruta = String(e?.path ?? e).replace(/\\/g, '/')
    if (disco.has(ruta)) return { value: disco.get(ruta) }
    if (ruta.toLowerCase().endsWith('cerebro.json')) return { value: '{}' }
    throw new Error(`ruta no simulada: ${ruta}`)
  })
  on('process.spawn', async function* (_$: any, e: any) {
    const argv: string[] = e?.argv ?? []
    if (argv.some(a => String(a).includes('catalogo.mjs') || String(a).includes('servidor.js'))) return { value: { code: 0, signal: null } }
    if (argv.some(a => String(a).includes('lanzador.mjs'))) {
      lanzados.push(argv)
      const [carpeta, id] = [argv[2], argv[3]]
      // El lanzador real sale al instante y sigue por su cuenta: aquí el agente "escribe" un poco después.
      setTimeout(() => alLanzar(disco, carpeta.replace(/\\/g, '/'), id), 30)
      return { value: { code: 0, signal: null } }
    }
    throw new Error(`con el lanzador activo no debe haber otro spawn: ${argv.join(' ')}`)
  })
  return { disco, lanzados }
}
const delegar = ($: any, tarea: string, extra = {}) => $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'ollama', modelo: 'gemma4:31b-cloud', categoria: 'texto', tarea, ...extra } })
const estado = async ($: any, id: string) => out(await $.tool.call({ tool: 'mcp__centro-agentes__estado', input: { ids: [id] } })).encargos[0]
const linea = (s: 'stdout' | 'stderr', t: string) => JSON.stringify({ s, t }) + '\n'

test('el agente corre bajo el lanzador y su resultado se lee del log en disco', { options: { lanzadorDesacoplado: true } }, async ($, on) => {
  const m = montar(on, (disco, carpeta, id) => {
    disco.set(`${carpeta}/${id}.log`, linea('stdout', 'hola desde '))
    setTimeout(() => {
      disco.set(`${carpeta}/${id}.log`, linea('stdout', 'hola desde ') + linea('stdout', 'disco'))
      disco.set(`${carpeta}/${id}.fin.json`, JSON.stringify({ code: 0, signal: null, cancelado: false, fin: Date.now() }))
    }, 60)
  })
  const d = out(await delegar($, 'di hola'))
  expect(d).toMatchObject({ encargo: 'e1', estado: 'lanzado' })
  await esperar(async () => (await estado($, 'e1')).estado === 'terminado')
  expect((await estado($, 'e1')).resultado.salida).toBe('hola desde disco')
  // El lanzador recibe la carpeta, el id y --desacoplado; el argv y la tarea quedan en disco para él.
  expect(m.lanzados).toHaveLength(1)
  expect(m.lanzados[0].slice(-3)[2]).toBe('--desacoplado')
  const id = m.lanzados[0][3]
  expect(JSON.parse(m.disco.get(`${m.lanzados[0][2].replace(/\\/g, '/')}/${id}.argv.json`)!)[0]).toBe('ollama')
  expect(m.disco.get(`${m.lanzados[0][2].replace(/\\/g, '/')}/${id}.in`)).toContain('di hola')
})

test('si el agente sale con error, el encargo falla y se ve el motivo', { options: { lanzadorDesacoplado: true } }, async ($, on) => {
  montar(on, (disco, carpeta, id) => {
    disco.set(`${carpeta}/${id}.log`, linea('stderr', 'se rompió todo'))
    disco.set(`${carpeta}/${id}.fin.json`, JSON.stringify({ code: 3, signal: null, cancelado: false, fin: Date.now() }))
  })
  out(await delegar($, 'falla'))
  await esperar(async () => ['terminado', 'fallido'].includes((await estado($, 'e1')).estado))
  const e = await estado($, 'e1')
  expect(e.estado).toBe('fallido')
  expect(JSON.stringify(e.resultado)).toContain('se rompió todo')
})

test('sin el ajuste, el agente corre por el camino de siempre', { options: { lanzadorDesacoplado: false } }, async ($, on) => {
  reiniciarCatalogoParaPruebas()
  mock.store(on); mock.clock(on)
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('env.get', async () => ({ value: 'C:\\Users\\Prueba' }))
  on('fs.exists', async () => ({ value: false }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
  on('fs.read', async (_$: any, e: any) => {
    if (String(e?.path ?? e).toLowerCase().endsWith('cerebro.json')) return { value: '{}' }
    throw new Error('no simulada')
  })
  let usoLanzador = false
  on('process.spawn', async function* (_$: any, e: any) {
    const argv: string[] = e?.argv ?? []
    if (argv.some(a => String(a).includes('lanzador.mjs'))) usoLanzador = true
    if (argv.some(a => String(a).includes('catalogo.mjs') || String(a).includes('servidor.js'))) return { value: { code: 0, signal: null } }
    yield { stream: 'stdout', text: 'directo' }
    return { value: { code: 0, signal: null } }
  })
  out(await delegar($, 'tarea'))
  await esperar(async () => (await estado($, 'e1')).estado === 'terminado')
  expect((await estado($, 'e1')).resultado.salida).toBe('directo')
  expect(usoLanzador).toBe(false)
})

test('tras recargar el plugin, el agente se reencuentra por sus archivos y el jefe recibe un solo aviso', { options: { lanzadorDesacoplado: true } }, async ($, on) => {
  reiniciarCatalogoParaPruebas()
  mock.store(on); mock.clock(on)
  const hace = Date.now() - 60_000
  // El agente terminó hace ~53 s (duró 7 s), aunque el reencuentro sea ahora: la duración sale de fin.json.
  const finReal = hace + 7000
  const avisos: string[] = []
  let finEscrito = false
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('env.get', async () => ({ value: 'C:\Users\Prueba' }))
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async () => ({ value: undefined }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
  on('prompt.submit', async (_$: any, e: any) => { avisos.push(e.text); return { text: e.text } })
  on('command.register', async () => ({ value: undefined }))
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  // El plugin anterior dejó guardado un trabajo en marcha bajo su lanzador y su encargo e1; el agente sigue y acaba un rato después.
  on('fs.read', async (_$: any, e: any) => {
    const ruta = String(e?.path ?? e).replace(/\\/g, '/')
    if (ruta.endsWith('/estado.json')) {
      const carpeta = ruta.replace(/\/estado\.json$/, '/trabajos')
      return { value: JSON.stringify({
        plan: null, planes: [], encargos: [],
        trabajos: [{ id: 'tviejo', trabajador: 'ollama:gemma4:31b-cloud', categoria: 'texto', tarea: 'x', estado: 'corriendo', inicio: hace, ultimaActividad: hace, encargo: 'e1', lanzador: { carpeta, id: 'tviejo' } }],
        registro: { encargos: [{ id: 'e1', grupo: 'g1', estado: 'corriendo', escalados: [], inicio: hace }], siguienteEncargo: 2, siguienteGrupo: 2, avisados: [], fallos: [] },
      }) }
    }
    if (ruta.endsWith('/trabajos/tviejo.log')) return { value: linea('stdout', 'hecho tras recarga') }
    if (ruta.endsWith('/trabajos/tviejo.fin.json')) { if (finEscrito) return { value: JSON.stringify({ code: 0, signal: null, cancelado: false, fin: finReal }) }; throw new Error('aún no') }
    if (ruta.toLowerCase().endsWith('cerebro.json')) return { value: '{}' }
    if (ruta.endsWith('plugin.json')) return { value: '{"version":"1"}' }
    throw new Error(`ruta no simulada: ${ruta}`)
  })
  on('process.spawn', async function* () { return { value: { code: 0, signal: null } } })
  setTimeout(() => { finEscrito = true }, 120)
  // El plugin nuevo arranca la sesión y recupera lo guardado.
  await $.session.start({ cwd: 'C:/Users/Prueba/proyecto', surface: null, isInteractive: false })
  await esperar(async () => (await estado($, 'e1'))?.estado === 'terminado')
  const e = await estado($, 'e1')
  expect(e.resultado).toMatchObject({ id: 'tviejo', exito: true, salida: 'hecho tras recarga', reenganchado: true })
  // La duración es fin - inicio (7 s), no ahora - inicio (~60 s): reenganchar no alarga el trabajo.
  expect(e.resultado.segundos).toBe(7)
  // Un solo aviso, el del grupo, y el jefe sabe que no se cerró nada por él.
  await esperar(() => avisos.length > 0)
  await new Promise(r => setTimeout(r, 50))
  expect(avisos).toHaveLength(1)
  expect(avisos[0]).toContain('g1')
  expect(avisos[0]).toContain('recargar el plugin')
})

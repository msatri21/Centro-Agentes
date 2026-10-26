import { delegarYEsperar, delegarVariosYEsperar } from './ayuda-asincrona'
import { expect, mock, test } from 'claude-code/testing'

import { construir } from './catalogo'
import type { Fuente, ModelosPorAgente } from './catalogo'
import { reiniciarCatalogoParaPruebas } from './register'

const out = (r: any) => r?.result ? JSON.parse(r.result) : r
const MODELOS: ModelosPorAgente = {
  ollama: ['gemma4:31b-cloud', 'gpt-oss:120b-cloud'],
  opencode: ['opencode/deepseek-v4.1-flash-free', 'opencode/big-pickle'],
  hermes: [], aider: [], codex: ['chatgpt'], claude: [],
}
const FUENTES: Fuente[] = [
  { nombre: 'ollama', ok: true, fecha: '2026-10-25' },
  { nombre: 'models.dev', ok: true, fecha: '2026-10-25' },
]
const catalogo = construir(MODELOS, {
  ollama: {},
  modelsDev: {
    'deepseek-v4.1-flash-free': { modalities: { input: ['text'] }, tool_call: true, reasoning: true, limit: { context: 200_000 } },
    'big-pickle': { modalities: { input: ['text'] }, tool_call: true, reasoning: false, limit: { context: 128_000 } },
  },
}, Date.UTC(2026, 9, 25), FUENTES)

const base = (on: any) => {
  mock.store(on)
  mock.clock(on)
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('env.get', async () => ({ value: 'C:\\Users\\Prueba' }))
  on('fs.exists', async () => ({ value: false }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
  on('fs.read', async (_$: any, e: any) => {
    if (String(e?.path ?? e).endsWith('catalogo.json')) return { value: JSON.stringify(catalogo) }
    if (String(e?.path ?? e).endsWith('cerebro.json')) return { value: '{}' }
    throw new Error(`ruta no simulada: ${String(e?.path ?? e)}`)
  })
}
const textoBueno = (argv: string[]) => argv[0] === 'opencode'
  ? '{"type":"text","part":{"text":"hecho"}}'
  : argv[0] === 'codex' ? '{"type":"item.completed","item":{"type":"agent_message","text":"hecho"}}' : 'hecho'

test('limita a cuatro procesos simultáneos y termina los seis encargos', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  let activos = 0
  let maximo = 0
  let sueltos = false
  let avisar!: () => void
  const cuatro = new Promise<void>(resolver => { avisar = resolver })
  on('process.spawn', async function* (_$: any, e: any) {
    activos++
    maximo = Math.max(maximo, activos)
    if (maximo === 4) avisar()
    await cuatro
    while (!sueltos) await new Promise(resolver => setTimeout(resolver, 0))
    yield { stream: 'stdout', text: textoBueno(e.argv) }
    activos--
    return { value: { code: 0, signal: null } }
  })
  const pendientes = Array.from({ length: 6 }, (_, i) => delegarYEsperar($, { trabajador: 'opencode', categoria: 'texto', tarea: `encargo ${i}` }))
  await cuatro
  sueltos = true
  const resultados = await Promise.all(pendientes)
  expect(maximo).toBe(4)
  expect(resultados.map((r: any) => out(r).exito)).toEqual([true, true, true, true, true, true])
})

test('reintenta el error de arranque con el mismo modelo', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  const modelos: string[] = []
  let n = 0
  on('process.spawn', async function* (_$: any, e: any) {
    modelos.push(e.argv[e.argv.indexOf('-m') + 1])
    n++
    yield { stream: 'stdout', text: n === 1 ? 'Standalone server exited before reporting readiness' : textoBueno(e.argv) }
    return { value: { code: n === 1 ? 1 : 0, signal: null } }
  })
  const d = out(await delegarYEsperar($, { trabajador: 'opencode', modelo: MODELOS.opencode[0], categoria: 'texto', tarea: 'prueba' }))
  expect(d.exito).toBe(true)
  expect(modelos).toEqual([MODELOS.opencode[0], MODELOS.opencode[0]])
  expect(d.cambios).toContain(`opencode:${MODELOS.opencode[0]} reintento 1: error de arranque`)
})

test('no reintenta otros errores y pasa al siguiente modelo', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  const modelos: string[] = []
  on('process.spawn', async function* (_$: any, e: any) {
    const modelo = e.argv[e.argv.indexOf('-m') + 1]
    modelos.push(modelo)
    yield { stream: 'stdout', text: modelos.length === 1 ? 'fallo cualquiera' : textoBueno(e.argv) }
    return { value: { code: modelos.length === 1 ? 1 : 0, signal: null } }
  })
  const d = out(await delegarYEsperar($, { trabajador: 'opencode', modelo: MODELOS.opencode[0], categoria: 'texto', tarea: 'prueba' }))
  expect(d.exito).toBe(true)
  expect(modelos).toEqual(MODELOS.opencode)
  expect(d.cambios.some((c: string) => c.includes('reintento'))).toBe(false)
})

test('tras tres fallos de arranque pasa al siguiente modelo', async ($, on) => {
  reiniciarCatalogoParaPruebas()
  base(on)
  const modelos: string[] = []
  on('process.spawn', async function* (_$: any, e: any) {
    const modelo = e.argv[e.argv.indexOf('-m') + 1]
    modelos.push(modelo)
    // Solo el primer modelo no arranca: el segundo funciona, así la prueba no espera más reintentos.
    const arranca = modelo === MODELOS.opencode[1]
    yield { stream: 'stdout', text: arranca ? textoBueno(e.argv) : 'Standalone server exited before reporting readiness' }
    return { value: { code: arranca ? 0 : 1, signal: null } }
  })
  const d = out(await delegarYEsperar($, { trabajador: 'opencode', modelo: MODELOS.opencode[0], categoria: 'texto', tarea: 'prueba' }))
  expect(modelos).toEqual([MODELOS.opencode[0], MODELOS.opencode[0], MODELOS.opencode[0], MODELOS.opencode[1]])
  expect(d.exito).toBe(true)
  expect(d.cambios.filter((c: string) => c.includes('reintento'))).toHaveLength(2)
})

import { expect, mock, test } from 'claude-code/testing'

import { construir } from './catalogo'
import type { Fuente, ModelosPorAgente } from './catalogo'
import { reiniciarCatalogoParaPruebas } from './register'

const out = (r: any) => JSON.parse(r.result)
const modelos: ModelosPorAgente = { ollama: ['gemma4:31b-cloud', 'gpt-oss:120b-cloud'], opencode: ['opencode/deepseek-v4.1-flash-free', 'opencode/big-pickle'], hermes: [], aider: [], codex: ['chatgpt'], claude: [] }
const catalogo = construir(modelos, {
  ollama: {
    'gemma4:31b-cloud': { capacidades: { imagen: true, herramientas: true, razonamiento: true }, contexto: 32000 },
    'gpt-oss:120b-cloud': { capacidades: { imagen: false, herramientas: true, razonamiento: true }, contexto: 1000000 },
  },
  modelsDev: {
    'deepseek-v4.1-flash-free': { modalities: { input: ['text', 'image'] }, tool_call: true, reasoning: true, limit: { context: 200000 } },
    'big-pickle': { modalities: { input: ['text'] }, tool_call: true, reasoning: false, limit: { context: 128000 } },
  },
}, Date.UTC(2026, 9, 25), [{ nombre: 'ollama', ok: true, fecha: '2026-10-25' }, { nombre: 'models.dev', ok: true, fecha: '2026-10-25' }] as Fuente[])

const base = (on: any) => {
  reiniciarCatalogoParaPruebas()
  mock.store(on); mock.clock(on)
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('env.get', async () => ({ value: 'C:\\Users\\Prueba' }))
  on('fs.exists', async () => ({ value: false }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
  on('fs.read', async (_$: any, e: any) => {
    const ruta = String(e?.path ?? e).replace(/\\/g, '/')
    if (ruta.endsWith('catalogo.json')) return { value: JSON.stringify(catalogo) }
    if (ruta.toLowerCase().endsWith('cerebro.json')) return { value: '{}' }
    throw new Error(`ruta no simulada: ${ruta}`)
  })
}
const delegar = ($: any, tarea: string, extra = {}) => $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'ollama', categoria: 'texto', tarea, ...extra } })
const lote = ($: any, tareas: any[]) => $.tool.call({ tool: 'mcp__centro-agentes__delegar_varios', input: { tareas: tareas.map((t, i) => ({ trabajador: 'ollama', categoria: 'texto', tarea: `tarea ${i + 1}`, ...t })) } })
const esperar = async (f: () => boolean | Promise<boolean>) => { let ok = await f(); for (let i = 0; i < 100 && !ok; i++) { await new Promise(r => setTimeout(r, 5)); ok = await f() }; expect(ok).toBe(true) }
const esAuxiliar = (e: any) => (e?.argv ?? []).some((a: any) => String(a).includes('catalogo.mjs') || String(a).includes('servidor.js'))

test('delegar devuelve el id mientras corre; estado refleja fin y resultado', async ($, on) => {
  base(on)
  let soltar!: () => void
  const retenido = new Promise<void>(r => { soltar = r })
  on('process.spawn', async function* (_$: any, e: any) {
    if (esAuxiliar(e)) return { value: { code: 0, signal: null } }
    await retenido
    yield { stream: 'stdout', text: 'resultado único' }
    return { value: { code: 0, signal: null } }
  })
  const d = out(await delegar($, 'espera'))
  expect(d).toMatchObject({ encargo: 'e1', estado: 'lanzado' })
  expect(out(await $.tool.call({ tool: 'mcp__centro-agentes__estado', input: { ids: ['e1'] } })).encargos[0].estado).toBe('corriendo')
  soltar()
  await esperar(async () => out(await $.tool.call({ tool: 'mcp__centro-agentes__estado', input: { ids: ['e1'] } })).encargos[0].estado === 'terminado')
  const estado = out(await $.tool.call({ tool: 'mcp__centro-agentes__estado', input: { ids: ['e1'] } }))
  expect(estado.encargos[0]).toMatchObject({ estado: 'terminado', resultado: { salida: 'resultado único' } })
})

test('un lote manda un solo aviso al completar la última tarea', async ($, on) => {
  base(on)
  const sueltos = [false, false, false]
  const avisos: string[] = []
  on('prompt.submit', async (_$: any, e: any) => { avisos.push(e.text); return { text: e.text } })
  on('process.spawn', async function* (_$: any, e: any) {
    if (esAuxiliar(e)) return { value: { code: 0, signal: null } }
    const i = Number(e?.input?.split('tarea ')[1]?.[0] ?? 1) - 1
    while (!sueltos[i]) await new Promise(r => setTimeout(r, 2))
    yield { stream: 'stdout', text: `resultado-${i + 1}` }
    return { value: { code: 0, signal: null } }
  })
  const d = out(await lote($, [{}, {}, {}]))
  expect(d.encargos.map((x: any) => x.estado)).toEqual(['lanzado', 'lanzado', 'lanzado'])
  sueltos[0] = true; await new Promise(r => setTimeout(r, 20)); expect(avisos).toHaveLength(0)
  sueltos[1] = true; await new Promise(r => setTimeout(r, 20)); expect(avisos).toHaveLength(0)
  sueltos[2] = true
  await esperar(() => avisos.length === 1)
  expect(avisos[0]).toMatch(/^\[Centro de agentes MST\] Terminó el grupo/)
  for (const texto of ['resultado-1', 'resultado-2', 'resultado-3']) expect(avisos[0]).toContain(texto)
  await new Promise(r => setTimeout(r, 20)); expect(avisos).toHaveLength(1)
})

test('errores previos al proceso vuelven en la respuesta y no avisan', async ($, on) => {
  base(on)
  let procesos = 0
  const avisos: string[] = []
  on('prompt.submit', async (_$: any, e: any) => { avisos.push(e.text); return { value: undefined } })
  on('process.spawn', async function* (_$: any, e: any) {
    if (esAuxiliar(e)) return { value: { code: 0, signal: null } }
    procesos++
    yield { stream: 'stdout', text: 'ok' }
    return { value: { code: 0, signal: null } }
  })
  await $.tool.call({ tool: 'mcp__centro-agentes__planificar', input: { objetivo: 'o', subtareas: ['manual'], manuales: [1] } })
  const d = out(await lote($, [
    { trabajador: 'fantasma' },
    { subtarea: 1 },
    { trabajador: 'ollama', tarea: 'describe esta imagen', necesita: ['audio'] },
  ]))
  expect(d.encargos.map((x: any) => x.estado)).toEqual(['fallido', 'fallido', 'fallido'])
  expect(d.encargos[0].error).toContain('Trabajador desconocido')
  expect(d.encargos[1].error).toContain('es manual')
  expect(d.encargos[2].error).toContain('Ningún modelo conocido')
  expect(procesos).toBe(0)
  await new Promise(r => setTimeout(r, 30)); expect(avisos).toHaveLength(0)
})

test('la dependiente espera y arranca al terminar la previa; un fallo la deja fallida', async ($, on) => {
  base(on)
  let soltar!: () => void
  const retenido = new Promise<void>(r => { soltar = r })
  const lanzadas: string[] = []
  on('process.spawn', async function* (_$: any, e: any) {
    if (esAuxiliar(e)) return { value: { code: 0, signal: null } }
    const t = String(e?.input)
    lanzadas.push(t)
    if (t.includes('previa')) { await retenido; yield { stream: 'stdout', text: 'falló' }; return { value: { code: 1, signal: null } } }
    yield { stream: 'stdout', text: 'ok' }
    return { value: { code: 0, signal: null } }
  })
  await $.tool.call({ tool: 'mcp__centro-agentes__planificar', input: { objetivo: 'o', subtareas: ['previa', 'dependiente'], dependencias: { 2: [1] } } })
  const d = out(await lote($, [{ subtarea: 2, tarea: 'dependiente' }, { subtarea: 1, tarea: 'previa' }]))
  expect(d.encargos[0].estado).toBe('en_espera')
  await esperar(() => lanzadas.length === 1)
  expect(lanzadas.some(t => t.includes('previa'))).toBe(true)
  expect(lanzadas.some(t => t.includes('dependiente'))).toBe(false)
  soltar()
  await esperar(async () => out(await $.tool.call({ tool: 'mcp__centro-agentes__estado', input: { ids: d.encargos.map((x: any) => x.encargo) } })).encargos.every((x: any) => x.estado === 'fallido' || x.estado === 'terminado'))
  const estado = out(await $.tool.call({ tool: 'mcp__centro-agentes__estado', input: { ids: d.encargos.map((x: any) => x.encargo) } }))
  expect(estado.encargos.find((x: any) => x.subtarea === 2).resultado.error).toContain('No se lanzó: la subtarea 1 de la que depende falló')
  expect(lanzadas.some(t => t.includes('dependiente'))).toBe(false)
})

test('registrar_auditoria acepta eN solo al terminar y estado filtra grupo e ids', async ($, on) => {
  base(on)
  let soltar!: () => void
  const retenido = new Promise<void>(r => { soltar = r })
  on('process.spawn', async function* (_$: any, e: any) {
    if (esAuxiliar(e)) return { value: { code: 0, signal: null } }
    await retenido
    yield { stream: 'stdout', text: 'auditado' }
    return { value: { code: 0, signal: null } }
  })
  on('prompt.submit', async (_$: any, e: any) => ({ text: e.text }))
  const d = out(await lote($, [{ tarea: 'primero' }, { tarea: 'segundo' }]))
  const id = d.encargos[0].encargo
  expect(out(await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id, puntaje: 8 } })).error).toBe(`El encargo ${id} todavía no terminó`)
  const grupo = out(await $.tool.call({ tool: 'mcp__centro-agentes__estado', input: { grupo: d.grupo } }))
  expect(grupo.encargos).toHaveLength(2)
  const uno = out(await $.tool.call({ tool: 'mcp__centro-agentes__estado', input: { ids: [id] } }))
  expect(uno.encargos).toHaveLength(1)
  soltar()
  await esperar(async () => out(await $.tool.call({ tool: 'mcp__centro-agentes__estado', input: { ids: [id] } })).encargos[0].estado === 'terminado')
  const audit = out(await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id, puntaje: 8 } }))
  expect(audit.guardado).toBe(true)
})

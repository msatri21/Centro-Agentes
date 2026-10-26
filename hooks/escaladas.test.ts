import { expect, mock, test } from 'claude-code/testing'

import { construir } from './catalogo'
import type { Fuente, ModelosPorAgente } from './catalogo'
import { reiniciarCatalogoParaPruebas } from './register'

const modelos: ModelosPorAgente = { ollama: ['gemma4:31b-cloud', 'gpt-oss:120b-cloud'], opencode: [], hermes: [], aider: [], codex: [], claude: [] }
const catalogo = construir(modelos, { ollama: {}, modelsDev: {} }, Date.UTC(2026, 9, 25), [{ nombre: 'ollama', ok: true, fecha: '2026-10-25' }, { nombre: 'models.dev', ok: true, fecha: '2026-10-25' }] as Fuente[])
const base = (on: any) => {
  reiniciarCatalogoParaPruebas(); mock.store(on); mock.clock(on)
  on('ui.status', async () => ({ value: undefined })); on('ui.toast', async () => ({ value: undefined })); on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('env.get', async () => ({ value: 'C:\\Users\\Prueba' })); on('fs.exists', async () => ({ value: false }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
  on('fs.read', async (_$: any, e: any) => String(e?.path ?? e).endsWith('catalogo.json') ? { value: JSON.stringify(catalogo) } : { value: '{}' })
}
const delegar = ($: any, subtarea: number, tarea: string) => $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'ollama', categoria: 'texto', subtarea, tarea } })
const esperar = async (f: () => boolean | Promise<boolean>) => { let ok = await f(); for (let i = 0; i < 100 && !ok; i++) { await new Promise(r => setTimeout(r, 5)); ok = await f() }; expect(ok).toBe(true) }
const terminar = async ($: any, r: any) => {
  const id = JSON.parse(r.result).encargo
  await esperar(async () => ['fallido', 'terminado'].includes(JSON.parse((await $.tool.call({ tool: 'mcp__centro-agentes__estado', input: { ids: [id] } })).result).encargos[0].estado))
}
const esAuxiliar = (e: any) => (e?.argv ?? []).some((a: any) => String(a).includes('catalogo.mjs') || String(a).includes('servidor.js'))

test('dos fallos seguidos de la subtarea envían una escalada y una sola vez', async ($, on) => {
  base(on)
  const avisos: string[] = []
  on('prompt.submit', async (_$: any, e: any) => { avisos.push(e.text); return { text: e.text } })
  on('process.spawn', async function* (_$: any, e: any) {
    if (esAuxiliar(e)) return { value: { code: 0, signal: null } }
    yield { stream: 'stdout', text: 'falló' }
    return { value: { code: 1, signal: null } }
  })
  await terminar($, await delegar($, 71, 'fallo primero'))
  await terminar($, await delegar($, 71, 'fallo segundo'))
  await esperar(() => avisos.filter(x => x.includes('ESCALADA (fallos)')).length === 1)
  expect(avisos.filter(x => x.includes('ESCALADA (fallos)'))).toHaveLength(1)
})

test('un éxito intermedio reinicia la racha y evita la escalada', async ($, on) => {
  base(on)
  const avisos: string[] = []
  let exito = false
  on('prompt.submit', async (_$: any, e: any) => { avisos.push(e.text); return { text: e.text } })
  on('process.spawn', async function* (_$: any, e: any) {
    if (esAuxiliar(e)) return { value: { code: 0, signal: null } }
    yield { stream: 'stdout', text: exito ? 'ok' : 'falló' }
    return { value: { code: exito ? 0 : 1, signal: null } }
  })
  await terminar($, await delegar($, 72, 'fallo uno'))
  exito = true; await terminar($, await delegar($, 72, 'éxito'))
  exito = false; await terminar($, await delegar($, 72, 'fallo tras éxito'))
  expect(avisos.filter(x => x.includes('ESCALADA (fallos)'))).toHaveLength(0)
})

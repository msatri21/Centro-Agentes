import { expect, mock, test } from 'claude-code/testing'

import { reiniciarCatalogoParaPruebas } from './register'

const out = (r: any) => JSON.parse(r.result)
const esperar = async (f: () => boolean | Promise<boolean>) => { let ok = await f(); for (let i = 0; i < 400 && !ok; i++) { await new Promise(r => setTimeout(r, 10)); ok = await f() }; expect(ok).toBe(true) }

const montar = (on: any, alLanzar: (disco: Map<string, string>, carpeta: string, id: string) => void) => {
  reiniciarCatalogoParaPruebas()
  mock.store(on); mock.clock(on)
  const disco = new Map<string, string>()
  const lanzados: string[][] = []
  const statusCalls: Array<string | undefined> = []
  on('ui.status', async (_$: any, e: any) => {
    statusCalls.push(typeof e === 'string' ? e : Object.values(e ?? {}).find(v => typeof v === 'string') as string | undefined)
    return { value: undefined }
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('env.get', async () => ({ value: 'C:\\Users\\Prueba' }))
  on('fs.exists', async () => ({ value: false }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
  on('fs.write', async (_$: any, e: any) => { disco.set(String(e?.path).replace(/\\/g, '/'), String(e?.content ?? e?.text ?? e?.data ?? '')); return { value: undefined } })
  on('fs.read', async (_$: any, e: any) => {
    const ruta = String(e?.path ?? e).replace(/\\/g, '/')
    if (disco.has(ruta)) return { value: disco.get(ruta) }
    if (ruta.endsWith('/catalogo.json')) return { value: '{}' }
    if (ruta.includes('/trabajos/') && ruta.endsWith('.log')) return { value: '' }
    if (ruta.includes('/trabajos/') && ruta.endsWith('.fin.json')) throw new Error('aún no')
    if (ruta.toLowerCase().endsWith('cerebro.json')) return { value: '{}' }
    throw new Error(`ruta no simulada: ${ruta}`)
  })
  on('process.spawn', async function* (_$: any, e: any) {
    const argv: string[] = e?.argv ?? []
    if (argv.some(a => String(a).includes('catalogo.mjs') || String(a).includes('servidor.js'))) return { value: { code: 0, signal: null } }
    if (argv.some(a => String(a).includes('lanzador.mjs'))) {
      lanzados.push(argv)
      const [carpeta, id] = [argv[2], argv[3]]
      setTimeout(() => alLanzar(disco, carpeta.replace(/\\/g, '/'), id), 30)
      return { value: { code: 0, signal: null } }
    }
    throw new Error(`con el lanzador activo no debe haber otro spawn: ${argv.join(' ')}`)
  })
  return { disco, lanzados, statusCalls }
}
const delegar = ($: any, tarea: string, extra = {}) => $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'ollama', modelo: 'gemma4:31b-cloud', categoria: 'texto', tarea, ...extra } })
const estado = async ($: any, id: string) => out(await $.tool.call({ tool: 'mcp__centro-agentes__estado', input: { ids: [id] } })).encargos[0]
const linea = (s: 'stdout' | 'stderr', t: string) => JSON.stringify({ s, t }) + '\n'

test('barra de estado persistente con agente vivo y se limpia al terminar', { options: { lanzadorDesacoplado: true } }, async ($, on) => {
  const m = montar(on, (disco, carpeta, id) => {
    disco.set(`${carpeta}/${id}.log`, linea('stdout', 'hola'))
    setTimeout(() => {
      disco.set(`${carpeta}/${id}.fin.json`, JSON.stringify({ code: 0, signal: null, cancelado: false, fin: Date.now() }))
    }, 60)
  })
  const d = out(await delegar($, 'di hola'))
  expect(d).toMatchObject({ encargo: 'e1', estado: 'lanzado' })
  await esperar(async () => m.statusCalls.some(v => v?.includes('trabajando')))
  expect(m.statusCalls.some(v => v?.includes('trabajando'))).toBe(true)
  await esperar(async () => (await estado($, 'e1')).estado === 'terminado')
  await esperar(async () => m.statusCalls[m.statusCalls.length - 1] === undefined)
  expect(m.statusCalls[m.statusCalls.length - 1]).toBeUndefined()
})

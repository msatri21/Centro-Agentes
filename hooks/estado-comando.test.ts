import { expect, mock, test } from 'claude-code/testing'

// Lo mínimo que necesita register para el comando: almacén, reloj, avisos y procesos.
const base = (on: any) => {
  mock.store(on)
  mock.clock(on)
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('env.get', async () => ({ value: 'C:\\Users\\Prueba' }))
  on('fs.exists', async () => ({ value: false }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
}

const esAuxiliar = (e: any) => (e?.argv ?? []).some((a: any) => String(a).includes('catalogo.mjs') || String(a).includes('servidor.js'))

const esperar = async (f: () => boolean | Promise<boolean>) => {
  let ok = await f()
  for (let i = 0; i < 100 && !ok; i++) { await new Promise(r => setTimeout(r, 5)); ok = await f() }
  expect(ok).toBe(true)
}

test('/mst-estado sin trabajos dice que no hay nada trabajando', async ($, on) => {
  base(on)

  const r = (await $.command.run({ command: 'mst-estado' })) as any
  expect(r.text).toBe('Centro de agentes: nada trabajando')
})

test('/mst-estado enseña agente, modelo y tiempo sin pasar por el jefe', async ($, on) => {
  base(on)
  let soltar!: () => void
  const retenido = new Promise<void>(r => { soltar = r })
  on('process.spawn', async function* (_$: any, e: any) {
    if (esAuxiliar(e)) return { value: { code: 0, signal: null } }
    await retenido
    yield { stream: 'stdout', text: 'fin' }
    return { value: { code: 0, signal: null } }
  })
  const enviados: string[] = []
  on('prompt.submit', async (_$: any, e: any) => { enviados.push(e.text); return { value: undefined } })

  await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'ollama', categoria: 'texto', tarea: 'espera' } })
  // El trabajo se apunta al empezar a ejecutarse, después de responder la delegación.
  await esperar(async () => ((await $.command.run({ command: 'mst-estado' })) as any).text.includes('lleva'))

  const r = (await $.command.run({ command: 'mst-estado' })) as any
  expect(r.text).toContain('ollama')
  expect(r.text).toContain('gpt-oss:120b-cloud')
  expect(r.text).toContain('lleva')
  expect(enviados).toEqual([])
  soltar()
})

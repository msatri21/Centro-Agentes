import { expect, mock, test } from 'claude-code/testing'

import { scriptFalso } from './scriptFalso'
import { estadosInterrumpidos } from './register'

const out = (r: any) => JSON.parse(r.result)
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
const planificar = ($: any, subtareas: any[], manuales?: number[]) => $.tool.call({ tool: 'mcp__centro-agentes__planificar', input: { objetivo: 'demo', subtareas, manuales, cwd: 'C:/proyecto' } })
const delegar = ($: any, subtarea: number) => $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'claude', categoria: 'x', tarea: 'hazlo', subtarea } })

test('reserva antes de iniciar, termina en realizado y evita duplicar o delegar manuales', async ($, on) => {
  base(on)
  let vioReserva = false
  const falso = scriptFalso(on, { agente: (_e, archivo) => {
    vioReserva = archivo.tareas[0].subtareas[0].estado === 'en_proceso'
    return {}
  } })
  await planificar($, ['una', 'manual'], [2])
  const d = out(await delegar($, 1))
  expect(vioReserva).toBe(true)
  expect(d.exito).toBe(true)
  expect(falso.archivo.tareas[0].subtareas[0].estado).toBe('realizado')
  const lanzamientos = falso.lanzamientos
  expect(out(await delegar($, 1)).error).toBe('La subtarea 1 ya está en proceso (otro encargo u otro chat); no se lanza otra vez')
  expect(falso.lanzamientos).toBe(lanzamientos + 1)
  expect(out(await delegar($, 2)).error).toBe('La subtarea 2 es manual y no se delega')
  expect(falso.lanzamientos).toBe(lanzamientos + 1)
})

test('si el agente falla vuelve a pendiente; ocupado solo avisa y deja seguir', async ($, on) => {
  base(on)
  const opciones: any = { agente: () => ({ codigo: 1 }) }
  const falso = scriptFalso(on, opciones)
  await planificar($, ['una'])
  const fallo = out(await delegar($, 1))
  expect(fallo.exito).toBe(false)
  expect(falso.archivo.tareas[0].subtareas[0].estado).toBe('pendiente')
  opciones.falla = { ok: false, codigo: 'ocupado', mensaje: 'archivo ocupado' }
  opciones.agente = () => ({})
  const aviso = out(await delegar($, 1))
  expect(aviso.exito).toBe(true)
  expect(aviso.aviso_archivo).toBe('archivo ocupado')
})

test('auditoría, cierre y cierre automático actualizan subtareas y tarea', async ($, on) => {
  base(on)
  const falso = scriptFalso(on)
  await planificar($, ['ocho', 'cuatro', 'jefe'])
  const trabajos = []
  for (const n of [1, 2]) trabajos.push(out(await delegar($, n)))
  await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: trabajos[0].id, puntaje: 8 } })
  await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: trabajos[1].id, puntaje: 4 } })
  expect(falso.archivo.tareas[0].subtareas.slice(0, 2).map((s: any) => s.estado)).toEqual(['solucionado', 'pendiente'])
  await $.tool.call({ tool: 'mcp__centro-agentes__cerrar_subtarea', input: { subtarea: 3 } })
  await $.tool.call({ tool: 'mcp__centro-agentes__registrar_auditoria', input: { id: trabajos[1].id, puntaje: 8 } })
  expect(falso.archivo.tareas[0].estado).toBe('solucionado')
})

test('un plan sin tarea ni raíz conserva el comportamiento solo en memoria', async ($, on) => {
  base(on)
  const falso = scriptFalso(on)
  await $.tool.call({ tool: 'mcp__centro-agentes__planificar', input: { objetivo: 'demo', subtareas: ['una'] } })
  const d = out(await delegar($, 1))
  expect(d.exito).toBe(true)
  expect(d).not.toHaveProperty('aviso_archivo')
  expect(falso.lanzamientos).toBe(1)
})

test('al restaurar se genera pendiente para cada subtarea con un trabajo interrumpido', () => {
  expect(estadosInterrumpidos({
    plan: { objetivo: 'demo', tarea: 'T3', raiz: 'C:/proyecto', subtareas: [] },
    trabajos: [
      { id: 'a', trabajador: 'claude', categoria: 'x', tarea: 'a', estado: 'corriendo', inicio: 1, subtarea: 2 },
      { id: 'b', trabajador: 'claude', categoria: 'x', tarea: 'b', estado: 'corriendo', inicio: 2, subtarea: 2 },
      { id: 'c', trabajador: 'claude', categoria: 'x', tarea: 'c', estado: 'listo', inicio: 3, subtarea: 1 },
    ],
    encargos: [],
  } as any)).toEqual([{ id: 'T3.2', estado: 'pendiente' }])
})

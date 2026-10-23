import { expect, mock, test } from 'claude-code/testing'

import { aplicar } from './tareas'
import { scriptFalso } from './scriptFalso'

const out = (r: any) => JSON.parse(r.result)
const base = (on: any) => {
  mock.store(on)
  mock.clock(on)
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
}

const llamar = ($: any, input: any) => $.tool.call({ tool: 'mcp__centro-agentes__planificar', input: { ...input, cwd: 'C:/proyecto' } })

test('crear persiste el plan, las dependencias y subtareas manuales en el archivo', async ($, on) => {
  base(on)
  const falso = scriptFalso(on)
  const p = out(await llamar($, { objetivo: 'demo', subtareas: ['a', 'b'], dependencias: { 2: [1] }, manuales: [2] }))
  expect(p.tarea).toBe('T1')
  expect(p.ids).toEqual(['T1.1', 'T1.2'])
  expect(p.subtareas).toEqual([{ n: 1, titulo: 'a', estado: 'pendiente' }, { n: 2, titulo: 'b', estado: 'pendiente', espera: [1], manual: true }])
  expect(falso.archivo.tareas[0].subtareas).toMatchObject([{ id: 'T1.1', estado: 'pendiente' }, { id: 'T1.2', depende_de: ['T1.1'], estado: 'pendiente', manual: true }])
  expect(falso.archivo.tareas[0].subtareas[1].id.split('.')[1]).toBe('2')
})

test('reutiliza el mismo objetivo y el siguiente objetivo incrementa el id', async ($, on) => {
  base(on)
  const falso = scriptFalso(on)
  expect(out(await llamar($, { objetivo: 'demo', subtareas: ['a'] })).tarea).toBe('T1')
  expect(out(await llamar($, { objetivo: 'demo', subtareas: ['otra'] })).tarea).toBe('T1')
  expect(falso.archivo.siguiente_tarea).toBe(2)
  expect(out(await llamar($, { objetivo: 'otro', subtareas: ['b'] })).tarea).toBe('T2')
  expect(falso.archivo.siguiente_tarea).toBe(3)
})

test('agregar suma hermanas con el siguiente número y devuelve los ids nuevos', async ($, on) => {
  base(on)
  const falso = scriptFalso(on)
  await llamar($, { objetivo: 'demo', subtareas: ['a'] })
  const p = out(await llamar($, { agregar: ['b', { titulo: 'c', depende_de: ['T1.1'] }] }))
  expect(p.ids).toEqual(['T1.1', 'T1.2', 'T1.3'])
  expect(p.subtareas.map((s: any) => s.n)).toEqual([1, 2, 3])
  expect(falso.archivo.tareas[0].subtareas[2].depende_de).toEqual(['T1.1'])
})

test('ajustar edita una pendiente y rechaza claramente una subtarea en marcha', async ($, on) => {
  base(on)
  const falso = scriptFalso(on)
  await llamar($, { objetivo: 'demo', subtareas: ['a', 'b'] })
  const p = out(await llamar($, { ajustar: { 'T1.1': { titulo: 'renombrada' } } }))
  expect(p.subtareas[0].titulo).toBe('renombrada')
  const estado = aplicar(falso.archivo, { tipo: 'estado', id: 'T1.2', estado: 'en_proceso' }, '2026-01-01')
  if (estado.ok) falso.archivo = estado.archivo
  const error = out(await llamar($, { ajustar: { 'T1.2': { titulo: 'no' } } }))
  expect(error.error).toContain('Solo se ajustan subtareas pendientes')
})

test('carga una tarea existente y explica cuando no existe', async ($, on) => {
  base(on)
  scriptFalso(on)
  await llamar($, { objetivo: 'demo', subtareas: ['a'] })
  expect(out(await llamar($, { tarea: 'T1' })).tarea).toBe('T1')
  expect(out(await llamar($, { tarea: 'T9' })).error).toContain('No existe la tarea T9')
})

test('rechaza modos mezclados sin invocar el script', async ($, on) => {
  base(on)
  const falso = scriptFalso(on)
  for (const input of [
    { objetivo: 'x', subtareas: ['a'], tarea: 'T1' },
    { agregar: ['a'], ajustar: { 'T1.1': { titulo: 'b' } } },
  ]) expect(out(await llamar($, input)).error).toContain('Elige un solo modo')
  expect(falso.lanzamientos).toBe(0)
})

test('sin cwd ni carpeta de sesión conserva el plan solo en memoria', async ($, on) => {
  base(on)
  const falso = scriptFalso(on)
  const p = out(await $.tool.call({ tool: 'mcp__centro-agentes__planificar', input: { objetivo: 'demo', subtareas: ['a'] } }))
  expect(p).not.toHaveProperty('tarea')
  expect(p).not.toHaveProperty('aviso_archivo')
  expect(falso.lanzamientos).toBe(0)
})

test('si falla el script conserva el plan en memoria y devuelve aviso sin tarea', async ($, on) => {
  base(on)
  scriptFalso(on, { falla: { ok: false, codigo: 'ocupado', mensaje: 'x' } })
  const p = out(await llamar($, { objetivo: 'demo', subtareas: ['a'] }))
  expect(p.subtareas).toHaveLength(1)
  expect(p).not.toHaveProperty('tarea')
  expect(p.aviso_archivo).toBe('x')
})

test('si el proceso termina con código 1 el plan queda en memoria y avisa', async ($, on) => {
  base(on)
  scriptFalso(on, { codigo: 1 })
  const p = out(await llamar($, { objetivo: 'demo', subtareas: ['a'] }))
  expect(p).not.toHaveProperty('tarea')
  expect(p.aviso_archivo).toContain('código 1')
})

test('tareas_estado resume el archivo y sin archivo devuelve existe falso', async ($, on) => {
  base(on)
  const falso = scriptFalso(on)
  const vacio = out(await $.tool.call({ tool: 'mcp__centro-agentes__tareas_estado', input: { cwd: 'C:/proyecto' } }))
  expect(vacio).toMatchObject({ existe: false })
  await llamar($, { objetivo: 'demo', subtareas: ['a'] })
  const r = out(await $.tool.call({ tool: 'mcp__centro-agentes__tareas_estado', input: { cwd: 'C:/proyecto' } }))
  expect(r).toMatchObject({ existe: true, activa: { id: 'T1' }, tareas: [{ id: 'T1', subtareas: { total: 1, solucionadas: 0 } }] })
  expect(falso.lanzamientos).toBe(3)
})

test('una subtarea manual no se puede delegar y no lanza agente', async ($, on) => {
  base(on)
  const falso = scriptFalso(on)
  await llamar($, { objetivo: 'demo', subtareas: ['manual'], manuales: [1] })
  const antes = falso.lanzamientos
  const r = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input: { trabajador: 'claude', categoria: 'x', tarea: 'hazlo', subtarea: 1 } }))
  expect(r.error).toContain('manual')
  expect(falso.lanzamientos).toBe(antes)
})

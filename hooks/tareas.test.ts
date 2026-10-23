import { expect, test } from 'claude-code/testing'

import { MAX_SOLUCIONADAS, agregarAlHistorial, aplicar, archivoNuevo, bloqueHistorial, estadoDeTarea, normalizar, partesDeId, resumen } from './tareas'
import type { Archivo } from './tareas'

const crear = (a: Archivo, titulo = 'Trabajo', subs = [{ titulo: 'uno' }]) => aplicar(a, { tipo: 'crear_tarea', titulo, subtareas: subs }, '2026-10-23')

test('ids, archivo nuevo y derivación de estado', () => {
  expect(partesDeId('T12')).toEqual({ tarea: 12 })
  expect(partesDeId('T12.3')).toEqual({ tarea: 12, sub: 3 })
  expect(partesDeId('T0.1')).toBe(null)
  const a = archivoNuevo('p', '2026-10-23')
  expect(a.siguiente_tarea).toBe(1)
  expect(estadoDeTarea({ id: 'T1', titulo: 'x', estado: 'pendiente', depende_de: [], enlaces: [], creada: 'hoy', solucionada: null, cerrada: null, subtareas: [] })).toBe('pendiente')
})

test('crear valida dependencias, reutiliza por título y no reutiliza números', () => {
  const a = archivoNuevo('p', '2026-10-23')
  const r = crear(a, '  Informe ', [{ titulo: 'a' }, { titulo: 'b', depende_de: [1] }])
  expect(r.ok).toBe(true)
  if (!r.ok) return
  expect(r.archivo.tareas[0].subtareas[1].depende_de).toEqual(['T1.1'])
  const repetida = crear(r.archivo, 'informe')
  expect(repetida.ok && repetida.cambios).toEqual(['reutiliza T1'])
  expect(aplicar(r.archivo, { tipo: 'crear_tarea', titulo: 'ciclo', subtareas: [{ titulo: 'a', depende_de: [2] }, { titulo: 'b', depende_de: [1] }] }, 'hoy')).toMatchObject({ ok: false, codigo: 'ciclo' })
  const segunda = crear(r.archivo, 'Otro')
  expect(segunda.ok && segunda.archivo.tareas.at(-1)?.id).toBe('T2')
})

test('agregar y ajustar solo editan lo permitido; manual, solo_si y dependencias bloqueadas', () => {
  const r = crear(archivoNuevo('p', 'hoy'), 'Tarea', [{ titulo: 'base' }, { titulo: 'manual', manual: true, depende_de: [1] }, { titulo: 'bloqueada', depende_de: [1] }])
  if (!r.ok) throw new Error('no creó')
  const manual = aplicar(r.archivo, { tipo: 'estado', id: 'T1.2', estado: 'en_proceso' }, 'hoy')
  expect(manual).toMatchObject({ ok: false, codigo: 'manual' })
  const bloqueada = aplicar(r.archivo, { tipo: 'estado', id: 'T1.2', estado: 'en_proceso', solo_si: 'realizado' }, 'hoy')
  expect(bloqueada).toMatchObject({ ok: false, codigo: 'conflicto' })
  expect(aplicar(r.archivo, { tipo: 'estado', id: 'T1.3', estado: 'en_proceso' }, 'hoy')).toMatchObject({ ok: false, codigo: 'bloqueada' })
  expect(aplicar(r.archivo, { tipo: 'ajustar', id: 'T1.1', titulo: 'nuevo' }, 'hoy').ok).toBe(true)
  const extra = aplicar(r.archivo, { tipo: 'agregar', tarea: 'T1', subtareas: [{ titulo: 'extra', depende_de: ['T1.1'] }] }, 'hoy')
  expect(extra.ok && extra.archivo.tareas[0].subtareas.at(-1)?.id).toBe('T1.4')
})

test('una subtarea solucionada deriva la tarea; agregar a tarea solucionada falla', () => {
  const r = crear(archivoNuevo('p', 'hoy'), 'Tarea', [{ titulo: 'a' }])
  if (!r.ok) throw new Error('no creó')
  const realizado = aplicar(r.archivo, { tipo: 'estado', id: 'T1.1', estado: 'realizado', solo_si: 'pendiente' }, 'hoy')
  expect(realizado.ok && realizado.archivo.tareas[0].estado).toBe('realizado')
  const solucionada = aplicar(realizado.ok ? realizado.archivo : r.archivo, { tipo: 'estado', id: 'T1.1', estado: 'solucionado' }, '2026-10-24')
  expect(solucionada.ok && solucionada.archivo.tareas[0].solucionada).toBe('2026-10-24')
  expect(solucionada.ok && aplicar(solucionada.archivo, { tipo: 'agregar', tarea: 'T1', subtareas: [{ titulo: 'extra' }] }, 'hoy')).toMatchObject({ ok: false, codigo: 'no_editable' })
})

test('la sexta solucionada archiva la más antigua y normalizar completa el fixture manual', () => {
  let a = archivoNuevo('p', '2026-01-01')
  for (let i = 1; i <= MAX_SOLUCIONADAS + 1; i++) {
    const r = crear(a, `Tarea ${i}`)
    if (!r.ok) throw new Error('no creó')
    a = r.archivo
    const done = aplicar(a, { tipo: 'estado', id: `T${i}.1`, estado: 'solucionado' }, `2026-01-0${i}`)
    if (!done.ok) throw new Error('no solucionó')
    a = done.archivo
    if (i === 6) expect(done.cerradas.map(t => t.id)).toEqual(['T1'])
  }
  const crudo = { proyecto: 'manual', formato: 'viejo', actualizado: '2026-01-01', tareas: [
    { id: 'T1', titulo: 'una', estado: 'pendiente', creada: '2026-01-01', subtareas: Array.from({ length: 6 }, (_, i) => ({ id: `T1.${i + 1}`, titulo: 's', estado: 'pendiente', creada: '2026-01-01', ...(i === 1 ? { depende_de: ['T1.1'] } : {}) })) },
    { id: 'T2', titulo: 'dos', estado: 'pendiente', depende_de: ['T1'], creada: '2026-01-01', subtareas: Array.from({ length: 6 }, (_, i) => ({ id: `T2.${i + 1}`, titulo: 's', estado: 'pendiente', creada: '2026-01-01' })) },
    { id: 'T4', titulo: 'cuatro', estado: 'pendiente', creada: '2026-01-01' },
  ] }
  const n = normalizar(crudo, 'hoy')
  expect(n.archivo.siguiente_tarea).toBe(5)
  expect(n.archivo.tareas[0].subtareas[1].depende_de).toEqual(['T1.1'])
  expect(n.archivo.tareas[2].solucionada).toBe(null)
  expect(normalizar(null, 'hoy').problemas.length).toBeGreaterThan(0)
})

test('historial idempotente y resumen compacto', () => {
  const r = crear(archivoNuevo('p', 'hoy'), 'Tarea', [{ titulo: 'a' }])
  if (!r.ok) throw new Error('no creó')
  const t = { ...r.archivo.tareas[0], estado: 'cerrado' as const, cerrada: 'hoy' }
  expect(bloqueHistorial(t)).toContain('## T1 · Tarea')
  const md = agregarAlHistorial('', t)
  expect(agregarAlHistorial(md, t)).toBe(md)
  expect(resumen(r.archivo).activa?.id).toBe('T1')
})

test('volver a marcar solucionado no cambia la fecha de solucionada (de ella depende cuál es la más vieja)', () => {
  const r = crear(archivoNuevo('p', '2026-10-01'), 'Trabajo', [{ titulo: 'uno' }])
  if (!r.ok) throw new Error('no creó')
  const hecha = aplicar(r.archivo, { tipo: 'estado', id: 'T1.1', estado: 'solucionado' }, '2026-10-04')
  if (!hecha.ok) throw new Error('no solucionó')
  expect(hecha.archivo.tareas[0].solucionada).toBe('2026-10-04')
  // Otra marca el día 25: la fecha original se conserva.
  const otra = aplicar(hecha.archivo, { tipo: 'estado', id: 'T1.1', estado: 'solucionado' }, '2026-10-25')
  expect(otra.ok && otra.archivo.tareas[0].solucionada).toBe('2026-10-04')
  // Si se reabre y se vuelve a solucionar, sí cuenta la fecha nueva.
  const reabierta = aplicar(hecha.archivo, { tipo: 'estado', id: 'T1.1', estado: 'pendiente' }, '2026-10-10')
  if (!reabierta.ok) throw new Error('no reabrió')
  expect(reabierta.archivo.tareas[0].solucionada).toBe(null)
  const de_nuevo = aplicar(reabierta.archivo, { tipo: 'estado', id: 'T1.1', estado: 'solucionado' }, '2026-10-12')
  expect(de_nuevo.ok && de_nuevo.archivo.tareas[0].solucionada).toBe('2026-10-12')
})

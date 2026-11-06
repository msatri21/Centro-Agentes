import { expect, test } from 'claude-code/testing'

import { trabajosHuerfanos } from './register'

// Solo mira el estado de cada trabajo y el set de esperas activas: función pura, sin motor.
const corriendo = (id: string, extra: Record<string, unknown> = {}) => ({ id, estado: 'corriendo', ...extra })

test('un trabajo con espera activa no es huérfano', () => {
  expect(trabajosHuerfanos([corriendo('t1', { lanzador: {} })], new Set(['t1']))).toEqual([])
})

test('un trabajo corriendo sin espera y con lanzador sí es huérfano; sin lanzador no', () => {
  expect(trabajosHuerfanos([corriendo('t1', { lanzador: { carpeta: 'x', id: 't1' } })], new Set())).toEqual(['t1'])
  expect(trabajosHuerfanos([corriendo('t2', { estado: 'corriendo' })], new Set())).toEqual([])
})

test('un trabajo ya terminado no es huérfano, ni aunque tenga lanzador', () => {
  expect(trabajosHuerfanos([{ id: 't1', estado: 'listo', lanzador: {} }], new Set())).toEqual([])
})

test('una lista vacía no da huérfanos', () => {
  expect(trabajosHuerfanos([], new Set())).toEqual([])
})

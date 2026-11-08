import { expect, test } from 'claude-code/testing'

import { estadoHeredado, ordenarVersiones, unirCerebros } from './register'

// En Linux y macOS los datos del chat estaban en la carpeta web de cada versión del plugin: al actualizar quedaban atrás.

test('las versiones se ordenan de mayor a menor como números, no como texto', () => {
  expect(ordenarVersiones(['0.24.1', '0.24.10', '0.24.2', '0.23.9'])).toEqual(['0.24.10', '0.24.2', '0.24.1', '0.23.9'])
})

test('el estado heredado es el de la versión más nueva, con el registro de encargos de la más nueva que lo tenga', () => {
  const nueva = { plan: { objetivo: 'nuevo' }, trabajos: [{ id: 't2' }], encargos: [], registro: { encargos: [] } } as any
  const vieja = { plan: { objetivo: 'viejo' }, trabajos: [{ id: 't1' }], encargos: [], registro: { encargos: [{ id: 'e1' }, { id: 'e2' }] } } as any
  const g = estadoHeredado([nueva, vieja])!
  expect(g.plan!.objetivo).toBe('nuevo')
  expect(g.trabajos.map(t => t.id)).toEqual(['t2'])
  expect((g.registro as any).encargos.map((e: any) => e.id)).toEqual(['e1', 'e2'])
  // Si la más nueva ya tiene encargos, se quedan los suyos; sin copias no hay estado.
  expect((estadoHeredado([vieja, nueva])!.registro as any).encargos).toHaveLength(2)
  expect(estadoHeredado([])).toBeUndefined()
})

test('los cerebros de varias versiones se unen sin repetir experiencias y en orden', () => {
  const e = (en: number, tarea: string) => ({ en, area: 'codigo', tarea, agente: 'opencode', modelo: 'm', nota: 8 })
  const r = unirCerebros([{ experiencias: [e(2, 'b'), e(1, 'a')] }, { experiencias: [e(1, 'a'), e(3, 'c')] }] as any)
  expect(r.experiencias.map(x => x.tarea)).toEqual(['a', 'b', 'c'])
})

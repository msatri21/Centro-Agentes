import { expect, test } from 'claude-code/testing'

import { cabeceraPlegable, estaPlegada } from './register'

test('por defecto todas las secciones están abiertas; solo se pliega lo marcado', () => {
  expect(estaPlegada({}, 'resumen')).toBe(false)
  expect(estaPlegada({ resumen: false }, 'resumen')).toBe(false)
  expect(estaPlegada({ resumen: true }, 'resumen')).toBe(true)
})

test('la cabecera entrega el título normal (sin mayúsculas) y el glifo aparte: ▾ abierta y ▸ plegada', () => {
  expect(cabeceraPlegable({}, 'vivos', 'Agentes trabajando ahora')).toEqual({ glifo: '▾', titulo: 'Agentes trabajando ahora' })
  expect(cabeceraPlegable({ vivos: true }, 'vivos', 'Agentes trabajando ahora')).toEqual({ glifo: '▸', titulo: 'Agentes trabajando ahora' })
  expect(cabeceraPlegable({}, 'subtareas', 'Subtareas')).toEqual({ glifo: '▾', titulo: 'Subtareas' })
})

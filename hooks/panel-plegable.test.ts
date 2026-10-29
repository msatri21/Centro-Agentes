import { expect, test } from 'claude-code/testing'

import { cabeceraPlegable, estaPlegada } from './register'

test('por defecto todas las secciones están abiertas; solo se pliega lo marcado', () => {
  expect(estaPlegada({}, 'resumen')).toBe(false)
  expect(estaPlegada({ resumen: false }, 'resumen')).toBe(false)
  expect(estaPlegada({ resumen: true }, 'resumen')).toBe(true)
})

test('la cabecera muestra el título de la sección con ▾ abierta y ▸ plegada', () => {
  const abierta = cabeceraPlegable({}, 'vivos', 'Agentes trabajando ahora')
  expect(abierta).toContain('AGENTES TRABAJANDO AHORA')
  expect(abierta.startsWith('▾')).toBe(true)

  const plegada = cabeceraPlegable({ vivos: true }, 'vivos', 'Agentes trabajando ahora')
  expect(plegada).toContain('AGENTES TRABAJANDO AHORA')
  expect(plegada.startsWith('▸')).toBe(true)

  expect(cabeceraPlegable({}, 'subtareas', 'Subtareas')).toContain('SUBTAREAS')
})

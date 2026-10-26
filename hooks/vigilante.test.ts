import { expect, test } from 'claude-code/testing'

import { vigilar } from './register'

// vigilar solo usa el estado de los trabajos, los archivos del chat y prompt.submit: se le pasa un motor mínimo
// (como hace catalogo-acciones.test.ts con atenderAcciones) y la hora entra como parámetro, porque el motor de pruebas no avanza el reloj.
const MIN = 60_000
const AHORA = Date.UTC(2026, 9, 26, 12)

const trabajo = (id: string, extra: Record<string, unknown> = {}) => ({
  id, trabajador: 'opencode:opencode/big-pickle', categoria: 'x', tarea: 't', instruccion: 't', estado: 'corriendo', inicio: AHORA - 180 * MIN, ...extra,
})

const motor = (trabajos: unknown[], consultas = '') => {
  const enviados: string[] = []
  const $ = {
    state: { get: async () => ({ value: trabajos }) },
    env: { get: async () => 'C:\\Users\\Prueba' },
    fs: {
      read: async (ruta: string) => {
        if (String(ruta).endsWith('consultas.jsonl')) return consultas
        if (String(ruta).endsWith('respuestas.jsonl') || String(ruta).endsWith('permisos.json')) return ''
        throw new Error(`ruta no simulada: ${ruta}`)
      },
    },
    prompt: { submit: async (e: { text: string }) => { enviados.push(e.text) } },
  }
  return { $: $ as any, enviados }
}

test('un trabajo sin señales de vida pasado el límite escala una sola vez', async () => {
  const m = motor([trabajo('ti', { ultimaActividad: AHORA - 41 * MIN, subtarea: 3 })])
  await vigilar(m.$, AHORA)
  await vigilar(m.$, AHORA + MIN)
  expect(m.enviados).toHaveLength(1)
  expect(m.enviados[0]).toContain('ESCALADA (inactivo)')
  expect(m.enviados[0]).toContain('trabajo ti, subtarea 3')
  expect(m.enviados[0]).toContain('41 min')
})

test('el tiempo cuenta desde la última señal y no desde el inicio', async () => {
  // Empezó hace 3 horas pero escribió hace 5 minutos.
  const m = motor([trabajo('ta', { ultimaActividad: AHORA - 5 * MIN })])
  await vigilar(m.$, AHORA)
  expect(m.enviados).toEqual([])
  // Sin ninguna señal cuenta desde el inicio; uno ya terminado nunca escala.
  const n = motor([trabajo('tb'), trabajo('tc', { estado: 'terminado', ultimaActividad: AHORA - 100 * MIN })])
  await vigilar(n.$, AHORA)
  expect(n.enviados).toHaveLength(1)
  expect(n.enviados[0]).toContain('trabajo tb')
})

test('un trabajo que espera una pregunta del usuario no se considera colgado', async () => {
  const consultas = '{"id":"c1","trabajo":"te","tipo":"pregunta","texto":"¿qué color?","en":1}\n'
  const m = motor([trabajo('te', { ultimaActividad: AHORA - 90 * MIN })], consultas)
  await vigilar(m.$, AHORA)
  expect(m.enviados).toEqual([])
})

test('un permiso abierto escala una vez con la acción y deja la decisión al usuario; una pregunta no escala', async () => {
  const consultas = [
    '{"id":"p1","trabajo":"tp","tipo":"permiso","texto":"borrar la carpeta dist","categoria":"destructivo","en":1}',
    '{"id":"q1","trabajo":"tp","tipo":"pregunta","texto":"¿qué color?","en":2}',
  ].join('\n') + '\n'
  const m = motor([trabajo('tp', { ultimaActividad: AHORA - MIN })], consultas)
  await vigilar(m.$, AHORA)
  await vigilar(m.$, AHORA + MIN)
  expect(m.enviados).toHaveLength(1)
  expect(m.enviados[0]).toContain('ESCALADA (permiso)')
  expect(m.enviados[0]).toContain('borrar la carpeta dist')
  expect(m.enviados[0]).toContain('del USUARIO')
  expect(m.enviados[0]).not.toContain('qué color')
})

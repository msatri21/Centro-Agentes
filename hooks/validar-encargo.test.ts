import { expect, test } from 'claude-code/testing'

import { validarEncargo } from './asincrono.ts'

const tarea = 'Arregla el error de la barra de estado y añade su prueba'

test('una tarea vacía no se lanza; una corta pero con texto sí', () => {
  expect(validarEncargo({ tarea: '' }, {})).toBe('La tarea está vacía: el agente no ve esta conversación, escríbela completa.')
  expect(validarEncargo({ tarea: 'Corre los tests' }, {})).toBeUndefined()
  expect(validarEncargo({ tarea: '   ' }, {})).toBe('La tarea está vacía: el agente no ve esta conversación, escríbela completa.')
})

test('una carpeta de trabajo que no existe se rechaza', () => {
  expect(validarEncargo({ tarea, cwd: 'C:/no-existe' }, { cwdExiste: false })).toBe('La carpeta de trabajo no existe: C:/no-existe')
})

test('aislar sin cwd se rechaza', () => {
  expect(validarEncargo({ tarea, aislar: true }, {})).toBe('aislar necesita cwd (la carpeta del repo git).')
})

test('aislar con una carpeta que no es repo git se rechaza', () => {
  expect(validarEncargo({ tarea, cwd: 'C:/proyecto', aislar: true }, { cwdExiste: true, esRepoGit: false })).toBe('aislar necesita que cwd sea un repo git: C:/proyecto')
})

test('una subtarea que no está en el plan activo se rechaza, con su tarea si la hay', () => {
  const plan = { subtareasDelPlan: [1, 2, 3] }
  expect(validarEncargo({ tarea, subtarea: 4 }, plan)).toBe('La subtarea 4 no existe en el plan activo: carga la tarea correcta con planificar { tarea } antes de lanzar.')
  expect(validarEncargo({ tarea, subtarea: 4 }, { ...plan, tareaActiva: 'T2' })).toBe('La subtarea 4 no existe en el plan activo (T2): carga la tarea correcta con planificar { tarea } antes de lanzar.')
})

test('un encargo válido no devuelve error', () => {
  expect(validarEncargo({ tarea, cwd: 'C:/proyecto', aislar: true, subtarea: 2 }, { cwdExiste: true, esRepoGit: true, subtareasDelPlan: [1, 2], tareaActiva: 'T1' })).toBeUndefined()
})

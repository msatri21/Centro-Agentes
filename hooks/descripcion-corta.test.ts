import { expect, test } from 'claude-code/testing'

import { descripcionCorta, tareaLimpia } from './asincrono'

test('descripcionCorta devuelve lo que hay tras el primer separador, sin la etiqueta', () => {
  expect(descripcionCorta('[R9] Panel compacto: títulos cortos que se ven completos, resumen con la tarea'))
    .toBe('títulos cortos que se ven completos, resumen con la tarea')
  expect(descripcionCorta('[F1] Arreglo — detalle largo')).toBe('detalle largo')
  expect(descripcionCorta('Revisión (parte 2) del panel')).toBe('parte 2) del panel')
})

test('descripcionCorta se queda con la primera frase y avisa con … solo si recorta', () => {
  expect(descripcionCorta('Panel: primera frase. Segunda frase')).toBe('primera frase')
  expect(descripcionCorta('Panel: uno dos tres cuatro', 2)).toBe('uno dos…')
  expect(descripcionCorta('Panel: uno dos', 2)).toBe('uno dos')
})

test('descripcionCorta devuelve vacío si no hay separador', () => {
  expect(descripcionCorta('Solo un título sin detalle')).toBe('')
})

test('tareaLimpia quita el prefijo de encabezado y corta como un título', () => {
  expect(tareaLimpia('TAREA: crea CUATRO notas nuevas en content')).toBe('crea CUATRO notas nuevas en content')
  expect(tareaLimpia('Proyecto: panel compacto')).toBe('panel compacto')
  expect(tareaLimpia('objetivo: una tarea con más de diez palabras para que el tope la recorte de verdad')).toBe('una tarea con más de diez palabras para que el…')
})

test('descripcionCorta no arrastra el paréntesis que cierra', () => {
  expect(descripcionCorta('Pruebas y comprobación (lateral y maximizado)')).toBe('lateral y maximizado')
})

import { expect, test } from 'claude-code/testing'

import { tituloCorto } from './asincrono'

test('quita la etiqueta inicial y corta en el primer separador', () => {
  expect(tituloCorto('[R6] Pulido del panel: cabeceras discretas...')).toBe('Pulido del panel')
  expect(tituloCorto('[F1] Arreglo — detalle largo')).toBe('Arreglo')
  expect(tituloCorto('Revisión (parte 2) del panel')).toBe('Revisión')
})

test('con más palabras de las permitidas corta por palabra y termina en …', () => {
  expect(tituloCorto('uno dos tres cuatro cinco seis siete ocho nueve diez once doce')).toBe('uno dos tres cuatro cinco seis siete ocho nueve diez…')
  expect(tituloCorto('uno dos tres cuatro', 2)).toBe('uno dos…')
})

test('sin … cuando el texto cabe en el tope', () => {
  expect(tituloCorto('uno dos tres cuatro cinco seis siete')).toBe('uno dos tres cuatro cinco seis siete')
  expect(tituloCorto('uno dos tres cuatro', 4)).toBe('uno dos tres cuatro')
})

test('nunca corta una palabra por la mitad y deja intacto el texto corto', () => {
  expect(tituloCorto('supercalifragilisticoespialidoso extra')).toBe('supercalifragilisticoespialidoso extra')
  expect(tituloCorto('Arreglo corto')).toBe('Arreglo corto')
  expect(tituloCorto('  [R1]  Uno  dos  ')).toBe('Uno dos')
})

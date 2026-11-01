import { expect, test } from 'claude-code/testing'
import { elegirInterprete } from './asincrono.ts'

test('en Windows prefiere el Git Bash de Program Files (64 bits)', () => {
  expect(elegirInterprete('win32', ['C:/Program Files/Git/bin/bash.exe'])).toEqual({ tipo: 'bash', ruta: 'C:/Program Files/Git/bin/bash.exe' })
})

test('en Windows acepta el Git Bash de LOCALAPPDATA cuando no hay de Program Files', () => {
  expect(elegirInterprete('win32', ['C:/Users/Juan/AppData/Local/Programs/Git/bin/bash.exe'])).toEqual({ tipo: 'bash', ruta: 'C:/Users/Juan/AppData/Local/Programs/Git/bin/bash.exe' })
})

test('en Windows sin ningún Git Bash cae en cmd', () => {
  expect(elegirInterprete('win32', [])).toEqual({ tipo: 'cmd', ruta: 'cmd' })
})

test('fuera de Windows corre con sh', () => {
  expect(elegirInterprete('linux', ['C:/Program Files/Git/bin/bash.exe'])).toEqual({ tipo: 'sh', ruta: 'sh' })
})

test('prioridad: Program Files 64 delante del de LOCALAPPDATA aunque llegue al revés', () => {
  expect(elegirInterprete('win32', ['C:/Users/Juan/AppData/Local/Programs/Git/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe'])).toEqual({ tipo: 'bash', ruta: 'C:/Program Files/Git/bin/bash.exe' })
})

test('prioridad: 64 bits delante de 32 bits', () => {
  expect(elegirInterprete('win32', ['C:/Program Files (x86)/Git/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe'])).toEqual({ tipo: 'bash', ruta: 'C:/Program Files/Git/bin/bash.exe' })
})

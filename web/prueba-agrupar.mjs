// Prueba de agrupar las sesiones de un mismo chat. Uso: node web/prueba-agrupar.mjs
import assert from 'node:assert/strict'
import { agruparChats } from './agrupar-chats.mjs'

const sesion = (id, modificado, nombre = 'Claude suscripción de $10: funcionamiento', proyecto = 'centro') => ({ id, nombre, proyecto, modificado })

// 4 sesiones del mismo chat (mismo proyecto y nombre): una entrada, la más reciente como principal y 3 anteriores.
const cuatro = agruparChats([sesion('s1', 100), sesion('s4', 400), sesion('s2', 200), sesion('s3', 300)])
assert.equal(cuatro.length, 1, 'una sola entrada')
assert.equal(cuatro[0].id, 's4', 'la más reciente es la principal')
assert.equal(cuatro[0].modificado, 400)
assert.deepEqual(cuatro[0].anteriores, [{ id: 's3', modificado: 300 }, { id: 's2', modificado: 200 }, { id: 's1', modificado: 100 }], 'anteriores, la más reciente primero')

// Dos chats con nombre distinto no se mezclan, aunque sean del mismo proyecto.
const distintos = agruparChats([sesion('a', 200, 'Tienda'), sesion('b', 100, 'Blog')])
assert.deepEqual(distintos.map(c => c.id), ['a', 'b'])
assert.deepEqual(distintos.map(c => c.anteriores.length), [0, 0])

// Mismo nombre en proyectos distintos tampoco se mezclan.
const otroProyecto = agruparChats([sesion('a', 200, 'Tienda', 'web'), sesion('b', 100, 'Tienda', 'app')])
assert.equal(otroProyecto.length, 2)

// Sin nombre ni proyecto no se agrupan: cada uno queda como está.
const sinNada = agruparChats([sesion('x', 300, '', ''), sesion('y', 200, '', ''), sesion('z', 100, '', '')])
assert.deepEqual(sinNada.map(c => c.id), ['x', 'y', 'z'])
assert.deepEqual(sinNada.map(c => c.anteriores), [[], [], []])

// Sin nombre pero con proyecto sí se agrupan entre ellos.
const soloProyecto = agruparChats([sesion('p1', 200, '', 'centro'), sesion('p2', 100, '', 'centro')])
assert.equal(soloProyecto.length, 1)
assert.deepEqual(soloProyecto[0].anteriores, [{ id: 'p2', modificado: 100 }])

// La entrada no cambia la lista de entrada ni lo que tiene dentro.
const entrada = [sesion('s1', 100), sesion('s2', 200)]
agruparChats(entrada)
assert.deepEqual(entrada.map(c => c.id), ['s1', 's2'], 'no toca la lista de entrada')

// Una sesión sin plan (sin proyecto) con el mismo nombre se une al grupo que sí tiene proyecto, y la lista de anteriores queda de la más reciente a la más vieja.
const sinPlan = agruparChats([sesion('c1', 400, 'Charla', 'web'), sesion('c2', 300, 'Charla', ''), sesion('c3', 200, 'Charla', 'web'), sesion('c4', 100, 'Charla', '')])
assert.equal(sinPlan.length, 1)
assert.equal(sinPlan[0].id, 'c1')
assert.deepEqual(sinPlan[0].anteriores.map(a => a.id), ['c2', 'c3', 'c4'])

// Sin proyecto y sin otro grupo con ese nombre, queda como está.
const soloNombre = agruparChats([sesion('n1', 200, 'Suelto', ''), sesion('n2', 100, 'Suelto', '')])
assert.equal(soloNombre.length, 1)
assert.deepEqual(soloNombre[0].anteriores, [{ id: 'n2', modificado: 100 }])

console.log('agrupar-chats: todo bien')

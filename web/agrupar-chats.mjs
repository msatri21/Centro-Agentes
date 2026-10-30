// Agrupa las sesiones de un mismo chat en el listado "todos los chats". Claude Code cambia el id de sesión al compactar o reanudar,
// así que una conversación puede tener varias carpetas con el mismo proyecto y el mismo nombre: se junta en una sola entrada.
// Lógica pura (sin disco ni red): la usa web/servidor.js al escribir el listado y web/prueba-agrupar.mjs la prueba.

// Entrada principal: la sesión más reciente de cada grupo (por fecha de modificación). Sus anteriores van en su lista, la más reciente primero.
// Sin nombre ni proyecto no se agrupa: cada uno queda como entrada propia.
export function agruparChats(chats) {
  const porClave = new Map()
  const salida = []
  for (const c of [...chats].sort((a, b) => b.modificado - a.modificado)) {
    if (!c.nombre && !c.proyecto) {
      salida.push({ id: c.id, nombre: c.nombre, proyecto: c.proyecto, modificado: c.modificado, anteriores: [] })
      continue
    }
    const clave = JSON.stringify([c.proyecto, c.nombre])
    const grupo = porClave.get(clave)
    if (grupo) {
      grupo.anteriores.push({ id: c.id, modificado: c.modificado })
      continue
    }
    const principal = { id: c.id, nombre: c.nombre, proyecto: c.proyecto, modificado: c.modificado, anteriores: [] }
    porClave.set(clave, principal)
    salida.push(principal)
  }
  return salida
}

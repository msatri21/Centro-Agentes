// La vista común: el grafo con los planes de todos los chats a la vez. Pregunta al servidor por los datos de cada chat
// (la clave viaja en location.search) y los junta en una sola lectura para el mismo grafo de siempre.
import { crearGrafo } from '/grafo.js'
import { unirChats } from '/grafo-logica.js'

const grafo = crearGrafo(document.getElementById('grafo-montaje'))
const cuenta = document.getElementById('cuenta')
async function vuelta() {
  try {
    const r = await fetch('/datos-todos' + location.search, { cache: 'no-store' })
    if (r.ok) {
      const { chats } = await r.json()
      grafo.actualizar(unirChats(chats, Date.now()))
      cuenta.textContent = chats.length === 1 ? '1 chat' : `${chats.length} chats`
    }
  } catch {}
  setTimeout(vuelta, 2000)
}
vuelta()

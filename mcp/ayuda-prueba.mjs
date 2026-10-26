const dormir = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function llamarHastaTerminar(llamar, nombre, argumentos = {}) {
  const inicial = await llamar(nombre, argumentos)
  if (inicial.error || inicial.encargo === undefined && !inicial.encargos) return inicial
  const ids = inicial.encargo ? [inicial.encargo] : inicial.encargos.map(e => e.encargo)
  let estado
  do {
    estado = await llamar('estado', { ids })
    if (estado.terminados + estado.fallidos < ids.length) await dormir(20)
  } while (estado.terminados + estado.fallidos < ids.length)
  if (inicial.encargo) return estado.encargos[0]?.resultado ?? { error: `No hay resultado para ${inicial.encargo}` }
  return { resultados: estado.encargos.map(e => e.resultado ?? { error: `No hay resultado para ${e.id}` }), aviso: 'Resultados sin verificar. Audita cada uno y llama a registrar_auditoria con su id.' }
}

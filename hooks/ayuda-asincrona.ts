const out = (r: any) => JSON.parse(r.result)

const esperarEstado = async ($: any, filtro: { grupo?: string; ids?: string[] }, ids: string[]) => {
  const limite = Date.now() + 4000
  while (Date.now() < limite) {
    const estado = out(await $.tool.call({ tool: 'mcp__centro-agentes__estado', input: filtro }))
    const encargos = estado.encargos.filter((e: any) => ids.includes(e.id))
    if (encargos.length === ids.length && encargos.every((e: any) => ['terminado', 'fallido'].includes(e.estado))) return encargos
    await new Promise(r => setTimeout(r, 20))
  }
  throw new Error(`Los encargos no terminaron en 4 s: ${ids.join(', ')}`)
}

export async function delegarYEsperar($: any, input: any) {
  const inicio = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar', input }))
  if (inicio.error || !inicio.encargo) return inicio
  const [encargo] = await esperarEstado($, { ids: [inicio.encargo] }, [inicio.encargo])
  return encargo.resultado
}

export async function delegarVariosYEsperar($: any, tareas: any[]) {
  const inicio = out(await $.tool.call({ tool: 'mcp__centro-agentes__delegar_varios', input: { tareas } }))
  if (inicio.error || !inicio.encargos) return inicio
  const ids = inicio.encargos.map((e: any) => e.encargo).filter(Boolean)
  const finalizados = await esperarEstado($, { ids }, ids)
  let cursor = 0
  return { resultados: inicio.encargos.map((e: any) => e.encargo ? finalizados[cursor++].resultado : { ...(e.subtarea === undefined ? {} : { subtarea: e.subtarea }), error: e.error }) }
}

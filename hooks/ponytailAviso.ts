// El aviso de /mst cuando falta la skill ponytail: qué se descargaría, de dónde y dónde se escribiría, y cómo instalarla.
// El plugin no descarga nada por su cuenta: la instalación la hace mcp/instalar-ponytail.mjs, y solo si el usuario dice que sí.

export const PONYTAIL = {
  repo: 'DietrichGebert/ponytail',
  commit: '09c434ab73ca43761c5d8b0c5d341926c2fba710',
  // Bytes de cada descarga (los de GitHub para ese commit).
  skills: { ponytail: 3496, 'ponytail-review': 5143, 'ponytail-audit': 5417 } as Record<string, number>,
  mapa: 5439,
  licencia: 1071,
}

// `faltan`: los nombres de skill que no están y, si falta, 'mapa'. El texto lista solo lo que hay que instalar.
export function textoAvisoPonytail(faltan: string[], script: string): string {
  const skills = Object.keys(PONYTAIL.skills).filter(n => faltan.includes(n))
  const mapa = faltan.includes('mapa')
  const descargas = [...skills.map(n => ({ n: `skills/${n}/SKILL.md`, b: PONYTAIL.skills[n] })), ...(mapa ? [{ n: 'hooks/ponytail-map.js', b: PONYTAIL.mapa }] : []), { n: 'LICENSE', b: PONYTAIL.licencia }]
  const total = descargas.reduce((s, d) => s + d.b, 0)
  const destinos = [...skills.map(n => `~/.claude/skills/${n}/  (SKILL.md, LICENSE, ORIGEN.md)`), ...(mapa ? ['~/.centro-agentes/ponytail/  (ponytail-map.js, LICENSE, ORIGEN.md)'] : [])]
  return [
    `Falta ponytail (${[...skills, ...(mapa ? ['mapa del código'] : [])].join(', ')}): es una skill opcional que hace que los agentes que programan añadan menos código. Sin ella, el centro funciona igual.`,
    '',
    `Si quieres instalarla, di "instala ponytail" y Claude la instala, o ejecútalo tú:  node "${script}" --instalar`,
    '',
    `Qué se descarga (solo de raw.githubusercontent.com, de ${PONYTAIL.repo}, commit ${PONYTAIL.commit.slice(0, 7)}, licencia MIT, ${total} bytes en total):`,
    ...descargas.map(d => `  · ${d.n}  (${d.b} bytes)`),
    'Dónde se escribe:',
    ...destinos.map(d => `  · ${d}`),
    'Garantías: cada archivo se verifica (tamaño y SHA-1 de git, los que da GitHub) antes de escribir nada, y si uno no coincide no se escribe ninguno. Lo descargado no se ejecuta. No se sobrescribe lo que ya exista.',
    `Para ver el plan sin instalar nada:  node "${script}"`,
    '',
    'Para Claude: no ejecutes la instalación por tu cuenta. Muéstrale al usuario esta lista y espera su sí; solo entonces corre el comando con --instalar.',
  ].join('\n')
}

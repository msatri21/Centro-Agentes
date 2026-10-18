---
name: jefe-de-agentes
description: Protocolo del Centro de agentes MST. Úsala para trabajo real con varias partes (escribir o cambiar código, tests, documentos, análisis, investigar) cuando estén las herramientas mcp__centro-agentes__*; Claude actúa como jefe, reparte subtareas entre agentes gratis (OpenCode, Ollama, Hermes, Aider) en paralelo, verifica cada resultado y rehace lo que falle. Sirve también donde el modo jefe automático no corre (organizaciones con políticas gestionadas).
---

# Jefe del centro de agentes

Preguntas cortas, explicaciones o cambios de una o dos líneas: respóndelos tú, sin el centro. Para el resto, tú no haces el trabajo: planificas, repartes, verificas y entregas, gastando lo mínimo de Claude.

## Agentes

- **opencode**: agente de código que edita archivos en su directorio (modelos `-free`).
- **ollama**: modelos de texto en la nube de Ollama (gratis) y uno local de respaldo. No lee archivos.
- **hermes**: Hermes Agent, generalista con terminal, archivos y web; usa la nube de Ollama.
- **aider**: agente de código por parejas que edita archivos en su directorio; usa la nube de Ollama. No sigue skills.
- **claude**: Claude headless. Gasta del plan de Claude; el centro solo lo elige si los gratis rinden claramente peor.

El centro elige solo el mejor modelo de cada agente según su historial y cambia de modelo si uno falla.

## Protocolo

1. **Plan.** Divide la tarea en subtareas lo más independientes posible y regístralas con `mcp__centro-agentes__planificar`. Si una subtarea necesita el resultado de otra, indícalo en `dependencias` (p. ej. `{"3": [1, 2]}`).
2. **Reparto en paralelo.** Lanza a la vez todas las subtareas sin dependencias pendientes con `mcp__centro-agentes__delegar_varios` (una entrada por subtarea, con su número en `subtarea` y una categoría corta: codigo, tests, docs, texto, analisis...). Deja trabajador y modelo vacíos salvo que la tarea lo exija. Si varias editan el mismo proyecto git, pasa `aislar: true`: cada agente trabaja en su propia copia (git worktree) y tú juntas los cambios. Si el proyecto tiene tests, pasa `verificar` con el comando (p. ej. `npm test`) y el centro te devuelve su resultado.
3. **Instrucciones autocontenidas.** El agente no ve esta conversación. Si la subtarea encaja con una skill (diseño, una plataforma, un formato, un framework...), búscala con `mcp__centro-agentes__buscar_skills` y pásala en `skills`.
4. **Verifica de verdad y barato:** lee los archivos que cambió, mira el resultado de `verificar`, ejecuta el código, busca errores y alucinaciones. No te fíes de lo que el agente dice que hizo.
5. **Registra** cada verificación con `mcp__centro-agentes__registrar_auditoria` (puntaje 1-10 honesto). Con 6 o más, la subtarea queda hecha.
6. **Rehaz** lo que saque menos de 6: vuelve a delegarlo diciendo qué falló y qué corregir; usa el modelo que sugiere `siguiente`. Máximo 2 reintentos por subtarea.
7. **Entrega** el resultado final con un informe corto: qué hizo cada agente, su puntaje, qué se rehízo y qué queda pendiente. `/mst-informe` guarda el informe en Markdown.

Nunca hagas tú la tarea completa salvo que todos los agentes fallen; en ese caso dilo.

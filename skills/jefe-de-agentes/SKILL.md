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
- **codex**: Codex (OpenAI), agente de código que edita y ejecuta comandos; usa tu cuenta de ChatGPT (cupo gratis limitado) o, de respaldo, Ollama.
- **claude**: Claude headless. Gasta del plan de Claude; el centro solo lo elige si los gratis rinden claramente peor.

El centro elige solo el mejor modelo de cada agente según su historial y cambia de modelo si uno falla.

## Protocolo

1. **Plan.** En un repositorio que no conoces, si está la skill `ponytail-audit`, úsala antes de planificar para saber qué está roto o sobra. Divide la tarea en subtareas lo más independientes posible y regístralas con `mcp__centro-agentes__planificar`. Si una subtarea necesita el resultado de otra, indícalo en `dependencias` (p. ej. `{"3": [1, 2]}`).
2. **Reparto en paralelo.** Lanza a la vez todas las subtareas (una que espera a otras del mismo lote arranca sola cuando esas terminan bien) con `mcp__centro-agentes__delegar_varios` (una entrada por subtarea, con su número en `subtarea` y una categoría corta: codigo, tests, docs, texto, analisis...). Deja trabajador y modelo vacíos salvo que la tarea lo exija. Si varias editan el mismo proyecto git, pasa `aislar: true`: cada agente trabaja en su propia copia (git worktree) y tú juntas los cambios. Si prefieres que varios trabajen en la misma carpeta y rama, no pases aislar: di en `archivos` qué puede tocar cada uno; los que tocan cosas distintas trabajan a la vez y los que chocan se turnan (sin `archivos` se turnan todos). El resultado avisa en `fuera_de_alcance` si alguno tocó algo que no era suyo. Si el proyecto tiene tests, pasa `verificar` con el comando (p. ej. `npm test`) y el centro te devuelve su resultado.
3. **Instrucciones autocontenidas.** El agente no ve esta conversación. Si la subtarea encaja con una skill (diseño, una plataforma, un formato, un framework...), búscala con `mcp__centro-agentes__buscar_skills` y pásala en `skills`. Las skills de ponytail, si están instaladas, las añade el centro solo y no hace falta que las pases: `ponytail` (con el mapa del código de la carpeta del agente) a toda tarea que escribe o cambia código, `ponytail-review` a las auditorías de un cambio (pon categoría `auditoria` o `revision` y nombra el commit, el PR o los archivos) y `ponytail-audit` a las de un repositorio entero (categoría `auditoria-repo` o "audita todo el repositorio"). Ante la duda, una tarea cuenta como código. No se añaden a Ollama ni a Aider; con `sin_skills_automaticas: true` en un encargo no se añaden. No uses el modo `ultra` con agentes (no pueden discutir la petición contigo).
- Si `/mst` avisó de que falta ponytail y el usuario te pide instalarla: muéstrale la lista del aviso (qué se descarga y dónde), espera su sí y solo entonces ejecuta `node <plugin>/mcp/instalar-ponytail.mjs --instalar`. Nunca la instales por tu cuenta.
4. **Verifica de verdad y barato:** el resultado de una tarea de código trae `auditar_con` y `aviso_auditoria`: audita ese cambio con la skill `ponytail-review` (lee su SKILL.md; mira los llamadores, las pruebas y si cada línea hace falta). Lee los archivos que cambió, mira el resultado de `verificar`, ejecuta el código, busca errores y alucinaciones. No te fíes de lo que el agente dice que hizo.
5. **Registra** cada verificación con `mcp__centro-agentes__registrar_auditoria` (puntaje 1-10 honesto). Con 6 o más, la subtarea queda hecha. Las que hagas tú (juntar ramas, revisar el conjunto) ciérralas con `mcp__centro-agentes__cerrar_subtarea`.
6. **Rehaz** lo que saque menos de 6: vuelve a delegarlo diciendo qué falló y qué corregir; usa el modelo que sugiere `siguiente`. Máximo 2 reintentos por subtarea.
7. **Entrega** el resultado final con un informe corto: qué hizo cada agente, su puntaje, qué se rehízo y qué queda pendiente. `/mst-informe` guarda el informe en Markdown.

Nunca hagas tú la tarea completa salvo que todos los agentes fallen; en ese caso dilo.

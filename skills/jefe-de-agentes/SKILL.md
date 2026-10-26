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

## Antes de empezar (en este orden)

1. **Enlace.** Tu primer mensaje es solo el enlace del centro de agentes de este chat (el campo `web` que devuelve `mcp__centro-agentes__cerebro`): el usuario lo abre y lo ve todo en vivo.
2. **Cerebro.** Llama a `mcp__centro-agentes__cerebro` con las palabras clave de la tarea: te dice qué agente y modelo lo hicieron mejor en casos parecidos de cualquier chat. Tenlo en cuenta al preguntar y al repartir (el centro ya prefiere a ese agente si dejas trabajador y modelo vacíos).
3. **Preguntas.** Pregúntale al usuario hasta que te quede claro qué quiere: objetivo, alcance, estilo o tecnología, restricciones y cómo sabrá que está terminado (con `AskUserQuestion` si la tienes: 2-4 preguntas por ronda, tu opción recomendada primero; si no, en el chat). No preguntes lo que la tarea ya dice. Cuando te quede claro, resume en 2-3 líneas lo que entendiste y sigue con el protocolo.

## Protocolo

El plan se guarda en `mst-tareas.json`, en la raíz de la carpeta del proyecto (git lo ignora); `mst-tareas-cerradas.md` es su historial. Los agentes no editan el archivo: el trabajo nuevo que vean lo apuntan al final de su respuesta en una sección «Propuestas:» y tú decides si lo agregas como subtarea hermana o lo planificas como tarea nueva.

Existe la herramienta `mcp__centro-agentes__modelos`: úsala si dudas de qué modelo sirve; no pases un `modelo` de memoria.
El centro detecta solo las tareas con imágenes (capturas, fotos, OCR...) y las manda únicamente a modelos que las ven; no hace falta que lo pidas.
Si el usuario propone un modelo (en la web o en el chat), compruébalo con `modelos`, pásalo en el campo `modelo` de `delegar` en la próxima tarea que encaje y puntúalo al auditar para que el cerebro aprenda.

1. **Plan.** En un repositorio que no conoces, si está la skill `ponytail-audit`, úsala antes de planificar para saber qué está roto o sobra. Divide la tarea en subtareas lo más independientes posible y crea un borrador con `mcp__centro-agentes__planificar` en cuanto tengas objetivo y primeras subtareas; púlelo al repartir con `planificar { agregar: [...] }` y `planificar { ajustar: { "T1.2": {...} } }`. Si una subtarea necesita el resultado de otra, indícalo en `dependencias` (p. ej. `{"3": [1, 2]}`); entre tareas no hay dependencias. Marca en `manuales` (posiciones) lo que no se delega, como instalar o respaldar. `planificar { tarea: "T2" }` retoma una tarea guardada y `mcp__centro-agentes__tareas_estado` da el resumen del plan sin leer el archivo entero.
2. **Reparto en segundo plano.** Lanza las subtareas con `mcp__centro-agentes__delegar_varios` (una entrada por subtarea, con su número en `subtarea` y una categoría corta: codigo, tests, docs, texto, analisis...). Devuelve al instante los ids `grupo` gN y `encargo` eN; el trabajo sigue en segundo plano y hay un máximo de 4 agentes a la vez. El centro reintenta el arranque de OpenCode con el mismo modelo si no inicia. Deja trabajador y modelo vacíos salvo que la tarea lo exija. Si varias editan el mismo proyecto git, pasa `aislar: true`: cada agente trabaja en su propia copia (git worktree) y tú juntas los cambios. Si prefieres que varios trabajen en la misma carpeta y rama, no pases aislar: di en `archivos` qué puede tocar cada uno; los que tocan cosas distintas trabajan a la vez y los que chocan se turnan (sin `archivos` se turnan todos). El resultado avisa en `fuera_de_alcance` si alguno tocó algo que no era suyo. Si el proyecto tiene tests, pasa `verificar` con el comando (p. ej. `npm test`) y el centro te devuelve su resultado. Las que dependan de otras pueden ir en el mismo lote: quedan en espera y arrancan solas cuando terminan bien sus previas.
   No esperes ni consultes `estado` en bucle. El centro envía un solo aviso cuando termina el grupo entero, o una `ESCALADA` cuando algo escala: 40 minutos sin señales, un agente pide permiso, dos fallos seguidos de la misma subtarea, más de 15 archivos modificados o más de 5 borrados, choque de ramas o archivos fuera de alcance. Mientras tanto, habla con el usuario o haz otra cosa; usa `mcp__centro-agentes__estado` con `grupo` o `ids` solo si necesitas consultar el avance.
3. **Instrucciones autocontenidas.** El agente no ve esta conversación. Si la subtarea encaja con una skill (diseño, una plataforma, un formato, un framework...), búscala con `mcp__centro-agentes__buscar_skills` y pásala en `skills`. Las skills de ponytail, si están instaladas, las añade el centro solo y no hace falta que las pases: `ponytail` (con el mapa del código de la carpeta del agente) a toda tarea que escribe o cambia código, `ponytail-review` a las auditorías de un cambio (pon categoría `auditoria` o `revision` y nombra el commit, el PR o los archivos) y `ponytail-audit` a las de un repositorio entero (categoría `auditoria-repo` o "audita todo el repositorio"). Ante la duda, una tarea cuenta como código. No se añaden a Ollama ni a Aider; con `sin_skills_automaticas: true` en un encargo no se añaden. No uses el modo `ultra` con agentes (no pueden discutir la petición contigo).
- Si `/mst` avisó de que falta ponytail y el usuario te pide instalarla: muéstrale la lista del aviso (qué se descarga y dónde), espera su sí y solo entonces ejecuta `node <plugin>/mcp/instalar-ponytail.mjs --instalar`. Nunca la instales por tu cuenta.
4. **Al recibir el aviso, verifica de verdad y barato:** el resultado de una tarea de código trae `auditar_con` y `aviso_auditoria`: audita ese cambio con la skill `ponytail-review` (lee su SKILL.md; mira los llamadores, las pruebas y si cada línea hace falta). Lee los archivos que cambió, mira el resultado de `verificar`, ejecuta el código, busca errores y alucinaciones. No te fíes de lo que el agente dice que hizo. Si el aviso es una `ESCALADA`, léela y atiéndela; no repitas ni reintentes a ciegas. Si un agente pide permiso, la decisión la toma el usuario en la web.
5. **Registra** cada verificación con `mcp__centro-agentes__registrar_auditoria` (puntaje 1-10 honesto), usando el id de trabajo o el id de encargo `eN`. Con 6 o más, la subtarea queda `solucionado`; con menos vuelve a `pendiente`. Las que hagas tú (juntar ramas, revisar el conjunto) ciérralas con `mcp__centro-agentes__cerrar_subtarea`. El resultado puede traer `aviso_archivo` si el archivo de tareas falló: el plan sigue en memoria.
6. **Rehaz** lo que saque menos de 6: vuelve a delegarlo diciendo qué falló y qué corregir; usa el modelo que sugiere `siguiente`. Máximo 2 reintentos por subtarea. Si la misma subtarea falla dos veces seguidas, cambia el enfoque o pregunta al usuario; no la relances a ciegas.
7. **Entrega** el resultado final con un informe corto: qué hizo cada agente, su puntaje, qué se rehízo y qué queda pendiente. `/mst-informe` guarda el informe en Markdown.

Si una tarea ya solucionada necesita más trabajo, decide tú: si cumplía lo pedido, planifica una tarea nueva; si no, usa `planificar { reabrir: ["T2.3"] }` para devolver a `pendiente` la subtarea que falló.

Nunca hagas tú la tarea completa salvo que todos los agentes fallen; en ese caso dilo.

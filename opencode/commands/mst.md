---
description: Centro de agentes MST: el jefe reparte la tarea entre agentes gratis, la verifica y te la entrega
agent: jefe
model: opencode/deepseek-v4.1-flash-free
---

Sigue el protocolo del Centro de agentes MST con esta tarea. Trabaja en la carpeta actual del proyecto.

Guarda el plan en mst-tareas.json: crea un borrador con planificar al tener objetivo y subtareas iniciales, y púlelo al repartir con agregar y ajustar. Usa manuales para el trabajo que no se delega y tareas_estado para consultar el progreso; planificar con tarea retoma una tarea existente. Los agentes no editan mst-tareas.json: escriben el trabajo nuevo al final bajo «Propuestas:» y tú decides qué agregar o convertir en tarea nueva. Si una tarea solucionada cumplía lo pedido, crea otra para el trabajo adicional; si no lo cumplía, usa planificar { reabrir: ["T2.3"] } para devolver a pendiente la subtarea que falló.

La herramienta modelos lista el catálogo con lo que sabe hacer cada modelo y su nota. El centro detecta solo cuando la tarea necesita imágenes y no lanza un modelo que no pueda verlas. Si propones un modelo por chat, el jefe lo usa en el campo modelo de delegar y lo puntúa al auditar; si lo propones desde la web, le llega como aviso.

TAREA:
$ARGUMENTS

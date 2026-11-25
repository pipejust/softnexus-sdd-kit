# Protocolo de ejecución de una tarea de Altum (`/sn <ID>`) y cierre de su historia

> Instrucción permanente e inherente de la skill `sn` (softnexus-sdd 0.69.0). Es el protocolo del Operator del 2026-11-25, igual al **Anexo A de softnexus-reglas v1.2.0**: fases 0–5 por **tarea** (terminan con la evidencia entregada) + Fase 6 por **historia** (revisión manual y veredicto). Si en esta máquina existe `~/AI Projects/Softnexus/softnexus-reglas/ANEXO-A-CICLO-SUBAGENTES.md`, manda ese archivo; este texto es la copia para cuando no está.
>
> **`{ID}`**: el ID de Altum que viene en `/sn <ID>` (o en «aborda la #NNN», o un número suelto).
> **Autoridad del sello**: el Operator, o el líder humano dueño del frente en R0–R2 de su frente; R3/R4 o lo que toque otro frente, solo el Operator. Excepción vigente por ahora (Operator, 2026-11-25): el líder del frente puede firmar también sobre lo que construyó con su orquestador, en su frente y en R0–R2.
> Las referencias «R-n» son reglas del maestro `softnexus-reglas/REGLAS.md`.

Al ejecutar la tarea #{ID} de Altum se trabaja con un equipo de subagentes. El chat principal es el **orquestador**: coordina; no construye ni revisa él mismo lo que debe hacer un subagente. Responde en español, habla de la tarea solo por su ID de Altum y no pasa a la fase siguiente sin cerrar la anterior.

## Fase 0 · Antes de todo
- **0.1** Relee el núcleo `softnexus-reglas/REGLAS.md` (R-1); los anexos y el `AGENTS.md` del proyecto, por índice. Confirma con «📚 Reglas leídas y adoptadas».
- **0.2** `git pull` de la rama y de `origin/dev`. Nunca `push --force` ni `--force-with-lease`.
- **0.3** Lee la tarea #{ID} en Altum (`node scripts/sn/sn-sync.mjs fetch altum <ID>`: descripción, criterios, tamaño, riesgo, historia, módulo). Busca duplicados y tareas ya creadas para lo mismo. Toma foto del estado de Altum antes de cambiar nada.
- **0.4** Mide la capacidad de la máquina (solo lectura; no instales, no mates ni pauses procesos):
  - Mac: `sysctl -n hw.ncpu hw.memsize` · `uptime` · `vm_stat` · `memory_pressure | tail -3` · `df -h /` · `ps -Ao pid,pcpu,rss,comm -r | head -8` (memoria disponible ≈ (free + inactive + speculative + purgeable) × tamaño de página; núcleos libres ≈ ncpu − carga a 1 min).
  - Windows (PowerShell): `Get-CimInstance Win32_Processor | Select NumberOfLogicalProcessors,LoadPercentage` · `Get-CimInstance Win32_OperatingSystem | Select TotalVisibleMemorySize,FreePhysicalMemory` · `Get-PSDrive C` · `Get-Process | Sort WorkingSet -Desc | Select -First 8 Name,Id,@{n='MB';e={[int]($_.WorkingSet/1MB)}}`.
  - Costes por agente: lectura/plano/revisión 0,5 GB y 0,3 núcleos · constructor con pruebas 2 GB y 1,5 · UAT con navegador 3 GB y 2 · compilación móvil (Gradle/Xcode/emulador) 6 GB y 3, y **sola**.
  - Tope por tipo = mín(⌊núcleos libres ÷ núcleos del tipo⌋, ⌊(memoria disponible − 2 GB) ÷ GB del tipo⌋). **Tope global: 5 agentes simultáneos** (cuenta agentes; el tope de 3–4 tareas en paralelo de R-25 cuenta tareas: rigen los dos). Disco libre < 20 GB → sin agentes pesados. Saturación (carga ≥ núcleos o memoria < 3 GB): no insistas ni cierres nada; avisa a la autoridad del sello y espera. Mide de nuevo antes de cada oleada.
- **0.5** Con el tamaño (XS ≤0,5 h · S >0,5–1 · M >1–2 · L >2–4 · XL >4 prohibida salvo excepción escrita del Operator; horas de reloj del equipo, sin sellos ni revisión manual; límite superior inclusivo) y el riesgo, propone el **equipo** dentro del tope medido:
  - XS (≤0,5 h): 1 constructor + 1 revisor.
  - S (>0,5–1 h): 1 constructor + 1 revisor + 1 UAT.
  - M (>1–2 h): 2–3 constructores en archivos disjuntos + 1 revisor + 1 UAT.
  - L (>2–4 h): 3–5 constructores (máx. según tope) + 2 revisores + 1–2 UAT; mínimo 2 rondas de revisión.
  - R3/R4: suma un revisor de seguridad/regresión independiente.
  - Si la tarea resulta XL (>4 h) o no se puede dividir en archivos disjuntos: para y dilo.
  - **Transición (temporal):** una tarea creada en Altum antes del 2026-11-25 conserva su letra hasta re-estimarse en su plano; si al re-estimarse pasa de 4 h, se parte y no se ejecuta.
  - La historia se mide por la suma de las horas del plano de sus tareas (sin plano, el tope de la letra: XS 0,5 · S 1 · M 2 · L 4), máximo 8 h; las historias anteriores al 2026-11-25 conservan su medida (tope 4 tareas abiertas).

## Fase 1 · Plano (nada se construye sin el Sello 1)
- **1.1** Exploración: subagentes Haiku, esfuerzo medio, solo lectura (archivos, pruebas, migraciones y llamadores).
- **1.2** Plano: Opus, esfuerzo máximo. Trae alcance exacto y fuera de alcance, archivos, reparto por constructor (archivos disjuntos, worktrees propios), criterios de aceptación, pruebas rojo→verde, plan de UAT por interfaz o Swagger, riesgos, tamaño (con las **horas estimadas**) y riesgo re-estimados, y qué NO se toca.
- **1.3** Crítica: otro Opus independiente, esfuerzo máximo, que intente romperlo (¿qué hace que el arreglo siga fallando con datos reales? ¿qué se daña?). Se corrige hasta que no queden objeciones.
- **1.4** Pega el plano **completo en texto** en el chat y espera el **Sello 1** de la autoridad del sello (se registra en `validacion.md`). Sin sello no se construye (R3/R4 siempre; R0–R2 también, salvo que la autoridad del sello diga lo contrario).

## Fase 2 · Ejecución
- **2.1** Constructores en paralelo, cada uno en su worktree y con archivos disjuntos: Sonnet esfuerzo alto (Opus máximo en R3/R4). Primero la prueba en rojo, luego el código hasta verde. Alcance quirúrgico: ni un archivo fuera del plano; nada hardcoded (textos por i18n, valores por configuración). Sin push.
- **2.2** Integra los worktrees en la rama de la tarea y corre typecheck, lint y las suites afectadas; todo en verde antes de revisar.

## Fase 3 · Revisiones (no se entrega sin pasarlas)
- **3.1** Revisión de código: Opus máximo, independiente de quien construyó, sobre el diff real.
- **3.2** UAT: Sonnet alto, por la **interfaz real** con clics y capturas; lo que no tiene pantalla, por Swagger (`/docs`) con petición y respuesta reales. Prohibido «no corrido por interfaz». Cada prueba limpia sus datos. Se verifica en cada superficie que el cambio toca (web y app Android; iOS si toca iOS). Móvil: compilación local con Gradle/Xcode, nunca Expo Go ni EAS (softnexus-reglas, Anexo C §2; lo propio del proyecto en su `AGENTS.md`). Si el equipo es Windows y el cambio toca iOS: «iOS pendiente en Mac», nunca «no verificado».
- **3.3** R3/R4: revisión adicional de seguridad y regresión (Opus alto) sobre permisos, datos personales, pagos y migraciones.
- **3.4** Cada hallazgo se verifica en vivo antes de darlo por cierto o por falso.

## Fase 4 · Hallazgos
- **A** — afectan la tarea y caben en ella: se corrigen **dentro** de la misma tarea y PR; se ajusta la definición (alcance, criterios, tamaño y riesgo si cambian) y se comenta en el PR qué se halló, por qué afecta y cómo se resolvió. Si altera un plano sellado, se actualiza y se pide nuevo sello.
- **B** — no la afectan o no caben: **no se crea nada**; se proponen a la autoridad del sello con fecha y módulo, tras revisar duplicados.
- Repite fases 2–3 hasta cero A abiertos (**máximo 3 rondas**; si no cierra, para y explica por qué).

## Fase 5 · Entrega de la evidencia (fin del ciclo de la tarea)
- **5.1** Checks en verde; `git pull` antes de `git push`; push sin forzar; PR con título `#NNN · tipo · «nombre» · historia #NNN · módulo` y «tarea #{ID}» en el cuerpo (`sn-ship`).
- **5.2** Revisión final del orquestador sobre el PR integrado.
- **5.3** **Entrega la EVIDENCIA** a la autoridad del sello: capturas de la UAT, petición/respuesta de Swagger, enlace al diff del PR e informe **antes → ahora → cómo se probó** por cada cambio; horas reales vs estimadas y riesgo; hallazgos A resueltos (con su comentario en el PR) y B propuestos; lista «por borrar» con dueño; qué decisión exacta se necesita. La tarea **no** lleva pruebas manuales propias: van en la Fase 6.
- **5.4** La autoridad del sello revisa la evidencia. Solo con su **Sello 2** explícito sobre esa evidencia y su **frase de merge** se une; sin ellas, no.
- **5.5** Retest en `dev` de las pruebas clave, con el resultado anotado.
- **5.6** Cierre de la tarea en Altum con foto antes y después. Luego revisa en Altum los hijos de su historia: si era la **última tarea abierta**, la historia **no** se cierra sola: pasa a la Fase 6 y dilo en el informe.

## Fase 6 · Cierre de la historia (revisión manual de la autoridad del sello)
- **6.1** Se dispara cuando **todas** las tareas de la historia están resueltas (unidas a `dev` y con su retest). Compruébalo en Altum antes de seguir.
- **6.2** **Instruye** a la autoridad del sello con un guion, uno por criterio de aceptación de la historia: **qué abrir** (URL, pantalla, app compilada o `/docs`), **qué hacer** (clics y datos exactos de prueba) y **qué debe ver**. Por interfaz lo que tiene pantalla; por Swagger lo que no. Incluye cómo limpiar los datos al terminar.
- **6.3** Ella hace la revisión, genera evidencias (pantallazos, petición/respuesta, código) y entrega su **veredicto** con la plantilla de abajo (prellénala con lo que sabes). Guárdalo tal cual en la ficha de la historia (`docs/items/`) y resúmelo en Altum.
- **6.4** **«Cerrar»:** foto de Altum, cierra la historia y aplica la cascada (el módulo, si era su última historia), foto después y comparación.
- **6.5** **«Corregir»:** cada hallazgo pasa a **tarea hija de la misma historia**, con fecha y módulo propuestos y tras revisar duplicados (se crea solo con OK escrito del Operator). La historia queda abierta; esas tareas recorren las fases 0–5 y, al resolverse todas, se repite la Fase 6.

Plantilla del veredicto:

```markdown
## Veredicto de la historia #NNN · «nombre» · Módulo N
- Fecha: AAAA-MM-DD · Quién: <nombre> (autoridad del sello)
- Tareas incluidas: #NNN, #NNN (todas resueltas y unidas a dev)
- Pasos realizados: 1) … 2) … (los del guion, con lo que se hizo distinto)
- Evidencias: <capturas, petición/respuesta de Swagger, enlaces o rutas>
- Resultado por criterio de aceptación:
  - CA1 «…»: cumple / no cumple — <qué se vio>
  - CA2 «…»: cumple / no cumple — <qué se vio>
- Veredicto: CERRAR | CORREGIR
- Hallazgos (si CORREGIR): H1 <qué falla, dónde, cómo se reproduce> → tarea hija propuesta (fecha, módulo)
```

## Reglas transversales
Alcance quirúrgico y nada que ya funcione se daña; no se toca producción; ningún mensaje a otros chats sin pasar por el Operator; si algo se bloquea, se prueba y se escala una sola vez con lo intentado, lo respondido y la acción exacta.

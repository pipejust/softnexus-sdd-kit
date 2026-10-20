---
name: sn-ui
description: Camino de interfaz dentro de Spec Driven. Úsala cuando un ítem cambia algo que se ve (pantalla nueva, componente, rediseño, estilos, animación, versión móvil) o cuando alguien diga "que se vea mejor", "diséñame", "pule la pantalla", "landing", "que se sienta como app en el celular". Fija la dirección visual en el plano antes de construir, construye respetando DESIGN.md y deja evidencia de capturas, peor caso de datos, móvil y movimiento. La usan /sn y /sn-evidence; no reemplaza la puerta /sn.
---

**Entorno local:** compatible con Claude Code, Codex y ChatGPT Work local. La raíz del plugin se obtiene desde la carpeta que contiene este `SKILL.md`, subiendo `../..`. Sustituye `${CLAUDE_PLUGIN_ROOT}` en los comandos por esa ruta absoluta; no presupongas que existe la variable de entorno. En Codex/ChatGPT invoca esta skill desde el selector de skills. Los hooks requieren revisión y autorización de la aplicación.


# sn-ui — interfaz con plano y con prueba

Sin dirección, el agente produce diseño genérico y datos de demo que esconden errores. La dirección visual se decide en el plano (sello 1), no mientras se programa. La prueba no es "se ve bien": son capturas, el peor caso de datos y el celular.

Si llegaste aquí sin pasar por `/sn` y el pedido es trabajo nuevo, vuelve a `/sn`: esta skill acompaña el camino, no lo salta.

| Paso de `/sn` | Qué aporta sn-ui |
|---|---|
| 2 · Investigar | §1 fuente de verdad visual |
| 5 · Historia | §2 datos reales con límites |
| 6 · Plano | §3 dirección visual |
| 7 · Construir | §4 reglas de construcción |
| 8 · Evidencia | §5 evidencia de interfaz |

Un cambio XS + R0 (texto, color, typo) solo usa §5.1 (capturas).

## 1. Fuente de verdad: `DESIGN.md`
- Si existe, manda. No inventes colores, tipografías, espaciados, radios ni sombras. Si el ítem necesita uno nuevo, se propone en el plano como cambio a `DESIGN.md` y lo aprueba el sello 1.
- Si no existe y el proyecto tiene UI, créalo desde el código como indica `sn-setup` §4 antes de escribir el plano.
- Reutiliza los componentes del repo y cita el archivo. Una librería nueva solo entra si está en el stack aprobado (`AGENTS.md` §2).

## 2. Historia: datos reales, no de demo
En "Estados de UI" del ítem, además de vacío, cargando, error, sin permiso y móvil, agrega la tabla de valores que la pantalla muestra (fase 1 de la skill `break-ui`):

| Campo | Origen | Límite | ¿Opcional? |
|---|---|---|---|
| `nombre` | `cliente.nombre` | 120 (`schema.ts:14`) | No |

El límite sale del esquema de validación, la columna de la base de datos o el contrato de la API. Si no hay límite, escribe "sin límite": es una pregunta para la historia.

## 3. Plano: sección "Dirección visual" en `design.md`
Escríbela en `openspec/changes/<change>/design.md` según el caso:
- **Pantalla dentro de un producto existente** (lo normal): "Sigue `DESIGN.md`", los componentes que reutiliza, el layout en una frase o un wireframe ASCII, y qué cambia en 375 px.
- **Superficie nueva o rediseño** (landing, módulo nuevo, producto sin `DESIGN.md`): usa la skill `frontend-design`. Propón tokens (4 a 6 colores con hex y rol, tipografías con su rol, concepto de layout, principios) y revísalos contra los rasgos genéricos que esa skill lista antes de mostrarlos. Lo aprobado entra a `DESIGN.md` en el mismo change. La marca del cliente y su referencia mandan sobre cualquier gusto propio.
- **La persona o el cliente no sabe qué quiere**: ofrece la skill `prototype` (2 a 3 versiones distintas detrás de un selector, solo en desarrollo). La versión elegida se describe en el plano y las descartadas no se entregan.
- **Referencia visual**: la Figma, captura o URL que traiga la persona va en "Referencia visual" del ítem. Si no hay referencia ni `DESIGN.md`, dilo en la tarjeta del sello 1.
- **Movimiento**: solo cuando responde a una acción o explica un cambio de estado. Declara en el plano qué se anima y por qué. No se animan entradas de cada sección.

## 4. Construir
- Usa los tokens de `DESIGN.md` (variables CSS o tema de Tailwind), nunca hex sueltos.
- Piso de calidad sin que nadie lo pida: foco visible con teclado, contraste legible, `prefers-reduced-motion` respetado, objetivos táctiles de 44 px o más y sin scroll horizontal en 375 px.
- Animaciones con la skill `animate` (curva, duración, interrupción, salida), solo con `transform` y `opacity`. Si algo se traba, la skill `animation-performance`.
- Detalle y pulido (sombras, bordes, estados hover y presionado, tipografía) con los criterios de `emil-design-eng`.
- Si la app se usa en celular, aplica `mobile-native` (100vh, zoom en inputs, áreas seguras, hover pegado, toques lentos).

## 5. Evidencia de interfaz (la pide `sn-evidence` §3)
1. **Capturas** en 1440 y 375 de cada estado del plano, incluidos vacío y error, en `openspec/changes/<change>/evidencia/`.
2. **Peor caso** con la skill `break-ui`: datos realistas al límite, por la misma entrada que los datos de prueba (fixture, mock o props), detrás de un interruptor que solo existe en desarrollo. Toma captura del peor caso. Lo que se rompe y está dentro del alcance se arregla. Lo que es decisión de diseño (cortar o partir un texto) se le pregunta a la persona. Lo que queda fuera del alcance se registra como ítem nuevo.
3. **Movimiento**: si el change agregó o cambió animaciones, pasa la skill `review-animations` sobre el diff y corrige lo que marque como bloqueante.
4. **Referencia**: compara contra `DESIGN.md`, la Figma o la captura previa y lista diferencias concretas. Nunca escribas "quedó igual".

En `evidencia.md`, agrega la sección "Interfaz" con las rutas de las capturas, la tabla del peor caso (campo · valor probado · resultado · decisión) y el resultado de la revisión de movimiento.

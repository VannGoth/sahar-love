# Sahar 💗

Un toque en el corazón y a tu pareja le llega una notificación con un mensaje lindo al azar.

- Diseño rojo y dorado, con corazones que flotan y estallan al tocar.
- **Racha** 🔥: cuenta los días seguidos en que **los dos** se mandaron al menos un toque, y guarda su récord.
- Al abrir la app, lo último que te mandaron aparece como una **carta**.
- Mensajes al azar, sin repetirse hasta usarlos todos. Los dos pueden añadir y borrar mensajes, y ver lo que han recibido.
- **11 idiomas**: alemán, inglés, español, turco, ruso, ucraniano, polaco, árabe, persa, italiano y rumano. Árabe y persa se muestran de derecha a izquierda.
  - Cada uno elige su idioma con el botón 🌐.
  - Los mensajes predeterminados le llegan a cada uno **en su propio idioma**. Por ejemplo, tú tocas en español y a ella le llega «دارم بهت فکر می‌کنم ❤️» si eligió persa, o «Ich denke an dich ❤️» si eligió alemán.
  - Los mensajes que escriban ustedes llegan tal cual se escribieron.

- **Al instante, siempre**: ya no hay «no molestar» ni límite de avisos.
- **Más formas de mandar**: 8 tipos de toque (☀️ buenos días, 😂 me reí, 🫶 orgullo…), mensaje escrito al momento, 🎲 pregunta al azar, y reacciones con emoji a lo que te llega.
- **Sincronía 💞**: si los dos se tocan con menos de 90 segundos de diferencia, fuegos artificiales para los dos.
- **Esto o aquello** 🎲: cada día 4 preguntas; eliges lo tuyo y adivinas lo del otro. Cada acierto es un punto en **¿Quién conoce mejor a quién?**
- **Vales** 🎁: quien gane la semana se lleva un vale al azar (masaje, cena romántica, paseo, comodines…). Al canjearlo, al otro le llega el aviso.
- **Logros de racha**: 3, 7, 14, 30, 50, 100, 200 y 365 días, con celebración. A los 7 días se desbloquea el tema Oro y a los 30, Galaxia.
- **¿Sabías que…?**: una curiosidad bonita cada día. Tema nuevo por defecto: **Aurora**.
- **Esto o aquello, más variado**: 60 preguntas (48 nuevas, sacadas de las listas más populares para parejas). Ya no se repite ninguna hasta que salen todas.
- **Punto extra por constancia** 🌟: si un día solo juega uno de los dos, quien jugó se lleva 1 punto extra. Por la tarde le llega un aviso al que falta.
- **Tira y afloja** ⚡: juego en vivo y competitivo. Los dos tocan a la vez para traer el corazón a su lado; quien gana suma 2 puntos.
- **Pestaña Armonía** 💞:
  - **Algo me hizo enojar**: se cuenta sin culpar (tema, emoción, qué pasó y qué necesito, según el método Gottman). Queda en un registro con «Lo siento», «Ya lo hablamos» y un gráfico de lo que más nos hace enojar.
  - **Frasco de gratitud** 🫙 y **proporción mágica 5:1** (Gottman): gracias frente a enojos de los últimos 30 días.
  - **Regalar un vale** 🎁 cuando quieras, también para compensar un enojo: 12 vales nuevos con respaldo científico (abrazo de 20 s, beso de 6 s, cita nueva, 36 preguntas, paseo de la mano…).
  - **7 deseos para Sahar** 💫: cada uno escribe lo que quiere en la próxima versión; se puede copiar todo para la siguiente actualización.
- **6 temas nuevos**: Sakura, Lavanda, Océano, Esmeralda, Melocotón y Rubí.

## 1. Publicarla en internet (unos 10 minutos)

En iPhone, las notificaciones solo funcionan si la app está publicada con **HTTPS**. La opción más sencilla es [Render.com](https://render.com):

1. Crea una cuenta en GitHub y sube la carpeta `server` como repositorio nuevo. Puedes arrastrar los archivos desde la web, con *Add file → Upload files*.
2. En Render: **New → Web Service** y elige ese repositorio.
   - Build command: `npm install`
   - Start command: `npm start`
3. Genera las claves de notificaciones (solo una vez). En tu PC con Node instalado, ejecuta `npx web-push generate-vapid-keys`.
4. En Render, ve a **Environment** y añade:
   - `VAPID_PUBLIC_KEY` = la *Public Key*
   - `VAPID_PRIVATE_KEY` = la *Private Key*
   - `VAPID_SUBJECT` = `mailto:tu-correo@ejemplo.com`
5. **Guardar los datos:** en el plan gratuito, el disco se borra cada vez que el servidor se reinicia, y tendrían que volver a vincularse. Para uso diario, añade un **Disk** (de pago, unos pocos €/mes) montado en `/data` y la variable `DATA_FILE=/data/data.json`.

## 2. Instalarla en cada iPhone

1. Abre la dirección que te da Render (`https://…onrender.com`) en **Safari**.
2. Toca **Compartir** y luego **Añadir a pantalla de inicio**.
3. Abre **Sahar** desde el ícono nuevo, elige tu idioma y escribe tu nombre.
4. Uno toca **Crear código** y el otro lo escribe en **Unirme**.
5. Cada uno toca **🔔 Activar notificaciones** y acepta el permiso.

Hace falta iOS 16.4 o superior.

## Probar en la computadora

```
cd server
npm install
npm start      # http://localhost:3000
node test.js   # pruebas: rachas, idiomas, API
```

## Más adelante: App Store, widget y Apple Watch

El servidor ya está preparado para enviar notificaciones nativas de Apple (APNs, con las variables `APNS_*` en `server.js`). Para el widget y el reloj haría falta una app nativa en Swift y una cuenta de desarrollador de Apple (99 €/año).

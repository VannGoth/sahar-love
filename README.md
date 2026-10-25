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

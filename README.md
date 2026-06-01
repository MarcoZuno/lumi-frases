# ☕ Lumi Frases

Panel para solicitar y entregar las frases con diseño de las redes de **Lumi Café**.

- **Quien escribe** envía el texto de la frase + una imagen de referencia.
- **El diseñador** ve las frases del día **en tiempo real** (sin recargar), con contador y aviso sonoro, y las marca como *entregadas*.

---

## ▶️ Cómo arrancarlo (local)

Requisito: tener [Node.js](https://nodejs.org) instalado.

```bash
npm install      # solo la primera vez
npm start
```

Luego abre en el navegador:

| Para… | Enlace |
|------|--------|
| Elegir rol | http://localhost:3000 |
| Escribir frases | http://localhost:3000/escritor.html |
| Panel del diseñador | http://localhost:3000/disenador.html |

> El panel del diseñador muestra un punto verde **“En vivo”**. Cuando entra una
> frase nueva suena un tono y aparece arriba al instante. El número de pendientes
> también se ve en el título de la pestaña, así que se nota aunque esté en segundo plano.

---

## 🌐 Compartirlo por internet (para que cada quien entre desde su lugar)

La app ya está lista para subirse. Dos caminos:

**A) Rápido y temporal — túnel desde tu compu**
Con tu compu encendida y el servidor corriendo (`npm start`):

```bash
npx localtunnel --port 3000
# o, si tienes cloudflared:  cloudflared tunnel --url http://localhost:3000
```

Te da una URL pública que puedes pasarle al diseñador. Deja de funcionar al apagar la compu.

**B) Permanente en la nube — desde GitHub (recomendado)**

1. Sube este proyecto a un repositorio de **GitHub**.
2. Entra a **[Railway](https://railway.app)** → *New Project* → *Deploy from GitHub repo* y elige el repo.
   Railway detecta Node y usa `npm start` automáticamente.
3. **Para que NO se borren las frases ni las imágenes** al reiniciar, agrega un **Volume**:
   - En el servicio → *Variables* → crea `DATA_DIR` con valor `/data`.
   - En el servicio → *Volumes* → monta un volumen en la ruta `/data`.
4. Railway te da una URL fija (ej. `https://lumi-frases.up.railway.app`) que el
   diseñador y el escritor abren desde donde sea.

> La app lee `DATA_DIR` (si existe) para guardar ahí los datos; en local no hace
> falta tocarla. El puerto lo toma de `PORT`, que el host asigna solo.

---

## 🗂️ Dónde se guardan los datos

- `data/frases.json` → las frases (texto, autor, estado, fecha).
- `data/uploads/`    → las imágenes de referencia.

Para empezar de cero, borra esos dos y se recrean solos.

## 🛠️ Cómo está hecho

- **Backend:** Node.js + Express. Datos en JSON, imágenes en disco.
- **Tiempo real:** Server-Sent Events (`/api/stream`).
- **Frontend:** HTML/CSS/JS sin pasos de compilación.

// Lumi Frases — servidor local
// Un escritor envía: texto de la frase + imagen de referencia.
// El diseñador ve las frases del día en tiempo real (sin recargar) y las marca como entregadas.

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Rutas de datos -------------------------------------------------------
// DATA_DIR se puede configurar con una variable de entorno para montar un
// disco persistente en la nube (ej. en Railway/Render: /data).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "frases.json");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]");

// --- "Base de datos" simple en archivo JSON -------------------------------
function leerFrases() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return [];
  }
}
function guardarFrases(frases) {
  fs.writeFileSync(DB_FILE, JSON.stringify(frases, null, 2));
}

// --- Limpieza automática ---------------------------------------------------
// Cada frase (con su imagen y material) se borra sola después de N días.
// Configurable con la variable de entorno RETENTION_DAYS (por defecto 7).
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 7);

function limpiarViejas() {
  const limiteMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const ahora = Date.now();
  const frases = leerFrases();
  const vivas = [];
  const borradas = [];
  for (const f of frases) {
    const edad = ahora - new Date(f.createdAt).getTime();
    if (edad > limiteMs) borradas.push(f);
    else vivas.push(f);
  }
  if (borradas.length === 0) return;

  const borrarArchivo = (url) =>
    fs.promises.unlink(path.join(UPLOADS_DIR, path.basename(url))).catch(() => {});
  borradas.forEach((f) => {
    if (f.imagen) borrarArchivo(f.imagen);
    (f.material || []).forEach((m) => borrarArchivo(m.url));
  });
  guardarFrases(vivas);
  borradas.forEach((f) => enviarEvento("frase-eliminada", { id: f.id }));
  console.log(`🧹 Limpieza: ${borradas.length} frase(s) de +${RETENTION_DAYS} días eliminada(s).`);
}

// --- Tiempo real con Server-Sent Events -----------------------------------
let clientes = []; // conexiones abiertas del/los panel(es) de diseñador

function enviarEvento(tipo, payload) {
  const data = `event: ${tipo}\ndata: ${JSON.stringify(payload)}\n\n`;
  clientes.forEach((res) => res.write(data));
}

app.get("/api/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("retry: 3000\n\n");
  clientes.push(res);

  // ping para mantener viva la conexión a través de proxies
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    clearInterval(ping);
    clientes = clientes.filter((c) => c !== res);
  });
});

// --- Subida de imágenes ---------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || ".png").toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB (permite videos cortos mp4/mov)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) cb(null, true);
    else cb(new Error("El archivo debe ser una imagen o un video."));
  },
});

// --- Middleware -----------------------------------------------------------
app.use(express.json());
// No exponer carpetas internas (datos, dependencias, git) como archivos estáticos.
app.use((req, res, next) => {
  if (/^\/(data|node_modules|\.git)(\/|$)/.test(req.path)) return res.status(404).end();
  next();
});
// Las páginas (index.html, escritor.html, disenador.html, styles.css, logo.png)
// viven en la raíz del proyecto.
app.use(express.static(__dirname));
app.use("/uploads", express.static(UPLOADS_DIR));

// --- API ------------------------------------------------------------------

// Listar todas las frases (más recientes primero)
app.get("/api/frases", (req, res) => {
  const frases = leerFrases().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(frases);
});

// Crear una frase nueva (texto + imagen opcional)
app.post("/api/frases", upload.single("imagen"), (req, res) => {
  const texto = (req.body.texto || "").trim();
  const autor = (req.body.autor || "").trim();
  if (!texto) {
    return res.status(400).json({ error: "Falta el texto de la frase." });
  }

  const frase = {
    id: crypto.randomUUID(),
    texto,
    autor: autor || "Anónimo",
    imagen: req.file ? `/uploads/${req.file.filename}` : null,
    estado: "pendiente", // pendiente | entregada
    createdAt: new Date().toISOString(),
  };

  const frases = leerFrases();
  frases.push(frase);
  guardarFrases(frases);

  enviarEvento("frase-nueva", frase);
  res.status(201).json(frase);
});

// Cambiar el estado (entregada / pendiente). Reabrir limpia opcionalmente el material.
app.patch("/api/frases/:id", (req, res) => {
  const frases = leerFrases();
  const frase = frases.find((f) => f.id === req.params.id);
  if (!frase) return res.status(404).json({ error: "Frase no encontrada." });

  if (req.body.estado) frase.estado = req.body.estado;
  guardarFrases(frases);

  enviarEvento("frase-actualizada", frase);
  res.json(frase);
});

// Entregar: el diseñador sube el material final (imágenes/videos) y la marca entregada.
app.post("/api/frases/:id/material", upload.array("material", 10), (req, res) => {
  const frases = leerFrases();
  const frase = frases.find((f) => f.id === req.params.id);
  if (!frase) {
    // limpiar archivos huérfanos si la frase ya no existe
    (req.files || []).forEach((f) =>
      fs.promises.unlink(path.join(UPLOADS_DIR, f.filename)).catch(() => {})
    );
    return res.status(404).json({ error: "Frase no encontrada." });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Adjunta al menos un archivo del material." });
  }

  const nuevos = req.files.map((f) => ({
    url: `/uploads/${f.filename}`,
    nombre: f.originalname,
    tipo: f.mimetype,
  }));
  frase.material = (frase.material || []).concat(nuevos);
  frase.estado = "entregada";
  frase.entregadaAt = new Date().toISOString();
  // Material nuevo => vuelve a quedar pendiente de aprobación del escritor.
  frase.revision = { estado: "pendiente", comentarios: "", fecha: new Date().toISOString() };
  guardarFrases(frases);

  enviarEvento("frase-actualizada", frase);
  res.status(201).json(frase);
});

// Revisión del escritor: aprobar el material o pedir ajustes (con comentarios).
app.post("/api/frases/:id/revision", (req, res) => {
  const frases = leerFrases();
  const frase = frases.find((f) => f.id === req.params.id);
  if (!frase) return res.status(404).json({ error: "Frase no encontrada." });

  const decision = req.body.decision; // "aprobada" | "ajustes"
  if (!["aprobada", "ajustes"].includes(decision)) {
    return res.status(400).json({ error: "Decisión inválida." });
  }
  if (decision === "ajustes" && !(req.body.comentarios || "").trim()) {
    return res.status(400).json({ error: "Escribe los comentarios de los ajustes." });
  }

  frase.revision = {
    estado: decision,
    comentarios: (req.body.comentarios || "").trim(),
    fecha: new Date().toISOString(),
  };
  guardarFrases(frases);

  enviarEvento("frase-actualizada", frase);
  res.json(frase);
});

// Eliminar una frase (y su imagen)
app.delete("/api/frases/:id", (req, res) => {
  let frases = leerFrases();
  const frase = frases.find((f) => f.id === req.params.id);
  if (!frase) return res.status(404).json({ error: "Frase no encontrada." });

  const borrarArchivo = (url) =>
    fs.promises.unlink(path.join(UPLOADS_DIR, path.basename(url))).catch(() => {});
  if (frase.imagen) borrarArchivo(frase.imagen);
  (frase.material || []).forEach((m) => borrarArchivo(m.url));
  frases = frases.filter((f) => f.id !== req.params.id);
  guardarFrases(frases);

  enviarEvento("frase-eliminada", { id: req.params.id });
  res.json({ ok: true });
});

// Manejo de errores de multer (archivo muy grande, etc.)
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

// Limpieza al arrancar y cada 6 horas.
limpiarViejas();
setInterval(limpiarViejas, 6 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`\n  ☕  Lumi Frases corriendo (auto-borrado a los ${RETENTION_DAYS} días)`);
  console.log(`  → Inicio:    http://localhost:${PORT}`);
  console.log(`  → Escritor:  http://localhost:${PORT}/escritor.html`);
  console.log(`  → Diseñador: http://localhost:${PORT}/disenador.html\n`);
});

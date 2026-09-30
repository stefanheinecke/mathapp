// ---------- Canvas (kariertes Notizfeld) ----------
// Zwei Ebenen: #notebook speichert die fertige Zeichnung (Radierer + PNG-Export nutzen sie).
// #notebook-live zeigt waehrend eines Stifts-Strichs nur den aktuell aktiven, per
// perfect-freehand geglaetteten Strich, damit bei jedem pointermove nicht die gesamte
// Zeichnung neu gerendert werden muss.
const canvas = document.getElementById("notebook");
const ctx = canvas.getContext("2d");
const liveCanvas = document.getElementById("notebook-live");
const liveCtx = liveCanvas.getContext("2d");

const PEN_STROKE_OPTIONS = { size: 6, thinning: 0.6, smoothing: 0.5, streamline: 0.5 };
const ERASER_WIDTH = 24;
const INK_COLOR = "#1a3a8f";
let currentTool = "pen"; // 'pen' | 'eraser'

let drawing = false;
let lastX = 0;
let lastY = 0;
let currentStrokePoints = [];
let hasInk = false;

function getPos(evt) {
  const rect = liveCanvas.getBoundingClientRect();
  const scaleX = liveCanvas.width / rect.width;
  const scaleY = liveCanvas.height / rect.height;
  return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
}

function setTool(tool) {
  currentTool = tool;
  document.getElementById("tool-pen").classList.toggle("active", tool === "pen");
  document.getElementById("tool-eraser").classList.toggle("active", tool === "eraser");
  document.getElementById("tool-line").classList.toggle("active", tool === "line");
  document.getElementById("tool-rectangle").classList.toggle("active", tool === "rectangle");
  document.getElementById("tool-triangle").classList.toggle("active", tool === "triangle");
}

document.getElementById("tool-pen").addEventListener("click", () => setTool("pen"));
document.getElementById("tool-eraser").addEventListener("click", () => setTool("eraser"));

// ---------- Geometrie-Werkzeuge (Linie/Rechteck/Dreieck mit fest definierten Massen) ----------
// 1 cm entspricht einem Gitterkaestchen (siehe --grid-size: 25px in style.css). Nach Eingabe der
// Masse ueber den Dialog bestimmt der erste Klick den Ankerpunkt, die Mausbewegung nur noch die
// Ausrichtung/Richtung - Laenge bzw. Seitenlaengen bleiben dabei exakt wie eingegeben.
const PX_PER_CM = 25;
let pendingShape = null; // { type: "line", lengthCm } | { type: "rectangle", widthCm, heightCm } | { type: "triangle", a, b, c }
let shapeAnchor = null;

function cmToCanvasPx(cm) {
  const rect = liveCanvas.getBoundingClientRect();
  const scaleX = liveCanvas.width / rect.width;
  return cm * PX_PER_CM * scaleX;
}

// Eigener Dialog statt window.prompt(): prompt() wird in manchen WebViews (u.a. in
// Automatisierungs-/Test-Umgebungen sowie teils in mobilen App-Wrappern) nicht unterstuetzt.
function openShapeDialog(type) {
  const title = document.getElementById("shape-dialog-title");
  const labelA = document.getElementById("shape-input-a-label");
  const labelB = document.getElementById("shape-input-b-label");
  const rowB = document.getElementById("shape-input-b-row");
  const rowC = document.getElementById("shape-input-c-row");
  const inputA = document.getElementById("shape-input-a");
  const inputB = document.getElementById("shape-input-b");
  const inputC = document.getElementById("shape-input-c");
  document.getElementById("shape-dialog-error").classList.add("hidden");

  if (type === "line") {
    title.textContent = "📏 Linie einfügen";
    labelA.textContent = "Länge (cm):";
    rowB.classList.add("hidden");
    rowC.classList.add("hidden");
    inputA.value = "5";
  } else if (type === "rectangle") {
    title.textContent = "▭ Rechteck einfügen";
    labelA.textContent = "Breite (cm):";
    labelB.textContent = "Höhe (cm):";
    rowB.classList.remove("hidden");
    rowC.classList.add("hidden");
    inputA.value = "6";
    inputB.value = "4";
  } else if (type === "triangle") {
    title.textContent = "△ Dreieck einfügen";
    labelA.textContent = "Seite a (cm):";
    labelB.textContent = "Seite b (cm):";
    rowB.classList.remove("hidden");
    rowC.classList.remove("hidden");
    inputA.value = "5";
    inputB.value = "4";
    inputC.value = "3";
  }
  document.getElementById("shape-dialog-overlay").dataset.shapeType = type;
  document.getElementById("shape-dialog-overlay").classList.remove("hidden");
  inputA.focus();
}

document.getElementById("tool-line").addEventListener("click", () => openShapeDialog("line"));
document.getElementById("tool-rectangle").addEventListener("click", () => openShapeDialog("rectangle"));
document.getElementById("tool-triangle").addEventListener("click", () => openShapeDialog("triangle"));

document.getElementById("shape-dialog-cancel").addEventListener("click", () => {
  document.getElementById("shape-dialog-overlay").classList.add("hidden");
});

document.getElementById("shape-dialog-confirm").addEventListener("click", () => {
  const overlay = document.getElementById("shape-dialog-overlay");
  const type = overlay.dataset.shapeType;
  const errorEl = document.getElementById("shape-dialog-error");
  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  };
  const parse = (id) => parseFloat(document.getElementById(id).value.replace(",", "."));
  const a = parse("shape-input-a");
  if (Number.isNaN(a) || a <= 0) return showError("Bitte eine Zahl grösser als 0 eingeben.");

  if (type === "line") {
    pendingShape = { type: "line", lengthCm: a };
  } else if (type === "rectangle") {
    const b = parse("shape-input-b");
    if (Number.isNaN(b) || b <= 0) return showError("Bitte eine Zahl grösser als 0 eingeben.");
    pendingShape = { type: "rectangle", widthCm: a, heightCm: b };
  } else if (type === "triangle") {
    const b = parse("shape-input-b");
    const c = parse("shape-input-c");
    if (Number.isNaN(b) || b <= 0 || Number.isNaN(c) || c <= 0) {
      return showError("Bitte gültige Zahlen grösser als 0 eingeben.");
    }
    if (a + b <= c || a + c <= b || b + c <= a) {
      return showError("Diese drei Seitenlängen ergeben kein gültiges Dreieck.");
    }
    pendingShape = { type: "triangle", a, b, c };
  }
  overlay.classList.add("hidden");
  setTool(type);
});

function computeLinePoints(anchor, pos, lengthPx) {
  const dx = pos.x - anchor.x;
  const dy = pos.y - anchor.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  return [
    [anchor.x, anchor.y],
    [anchor.x + ux * lengthPx, anchor.y + uy * lengthPx],
  ];
}

function computeRectanglePoints(anchor, pos, widthPx, heightPx) {
  const signX = pos.x >= anchor.x ? 1 : -1;
  const signY = pos.y >= anchor.y ? 1 : -1;
  const x2 = anchor.x + signX * widthPx;
  const y2 = anchor.y + signY * heightPx;
  return [
    [anchor.x, anchor.y],
    [x2, anchor.y],
    [x2, y2],
    [anchor.x, y2],
    [anchor.x, anchor.y],
  ];
}

// Platziert ein Dreieck mit den drei gegebenen Seitenlaengen (a = Ankerpunkt->Basispunkt) per
// Kosinussatz: v1=Anker, v2 liegt in Mausrichtung im Abstand a, v3 wird daraus konstruiert.
function computeTrianglePoints(anchor, pos, aCm, bCm, cCm) {
  const dx = pos.x - anchor.x;
  const dy = pos.y - anchor.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const aPx = cmToCanvasPx(aCm);
  const bPx = cmToCanvasPx(bCm);
  const cPx = cmToCanvasPx(cCm);
  const v1 = anchor;
  const v2 = { x: anchor.x + ux * aPx, y: anchor.y + uy * aPx };
  const xLocal = (aPx * aPx + cPx * cPx - bPx * bPx) / (2 * aPx);
  const yLocal = Math.sqrt(Math.max(0, cPx * cPx - xLocal * xLocal));
  // Senkrechte zur Basisrichtung (ux, uy) ist (-uy, ux).
  const v3 = {
    x: v1.x + ux * xLocal + -uy * yLocal,
    y: v1.y + uy * xLocal + ux * yLocal,
  };
  return [
    [v1.x, v1.y],
    [v2.x, v2.y],
    [v3.x, v3.y],
    [v1.x, v1.y],
  ];
}

function renderShapeToContext(targetCtx, points) {
  if (points.length < 2) return;
  targetCtx.strokeStyle = INK_COLOR;
  targetCtx.lineWidth = 2;
  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";
  targetCtx.beginPath();
  targetCtx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    targetCtx.lineTo(points[i][0], points[i][1]);
  }
  targetCtx.stroke();
}

// Beschriftet die Seiten mit den eingegebenen Massen, aehnlich wie in gedruckten Geometrieaufgaben.
function drawShapeLabels(targetCtx, points, shape) {
  targetCtx.fillStyle = INK_COLOR;
  targetCtx.font = "16px sans-serif";
  targetCtx.textAlign = "center";
  targetCtx.textBaseline = "middle";
  const fmt = (n) => `${n} cm`;
  if (shape.type === "line") {
    const [p1, p2] = points;
    targetCtx.fillText(fmt(shape.lengthCm), (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2 - 12);
  } else if (shape.type === "rectangle") {
    const [p1, p2, , p4] = points;
    targetCtx.fillText(fmt(shape.widthCm), (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2 - 10);
    targetCtx.fillText(fmt(shape.heightCm), (p1[0] + p4[0]) / 2 - 18, (p1[1] + p4[1]) / 2);
  } else if (shape.type === "triangle") {
    const [v1, v2, v3] = points;
    targetCtx.fillText(fmt(shape.a), (v1[0] + v2[0]) / 2, (v1[1] + v2[1]) / 2 + 14);
    targetCtx.fillText(fmt(shape.b), (v2[0] + v3[0]) / 2 + 16, (v2[1] + v3[1]) / 2);
    targetCtx.fillText(fmt(shape.c), (v3[0] + v1[0]) / 2 - 16, (v3[1] + v1[1]) / 2);
  }
}

function getShapePreviewPoints(pos) {
  if (!pendingShape || !shapeAnchor) return null;
  if (pendingShape.type === "line") {
    return computeLinePoints(shapeAnchor, pos, cmToCanvasPx(pendingShape.lengthCm));
  }
  if (pendingShape.type === "rectangle") {
    return computeRectanglePoints(shapeAnchor, pos, cmToCanvasPx(pendingShape.widthCm), cmToCanvasPx(pendingShape.heightCm));
  }
  if (pendingShape.type === "triangle") {
    return computeTrianglePoints(shapeAnchor, pos, pendingShape.a, pendingShape.b, pendingShape.c);
  }
  return null;
}

function renderShapePreview(pos) {
  liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  const points = getShapePreviewPoints(pos);
  if (!points) return;
  renderShapeToContext(liveCtx, points);
  drawShapeLabels(liveCtx, points, pendingShape);
}

function commitShape(pos) {
  const points = getShapePreviewPoints(pos);
  liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  if (!points) return;
  ctx.globalCompositeOperation = "source-over";
  renderShapeToContext(ctx, points);
  drawShapeLabels(ctx, points, pendingShape);
  hasInk = true;
  scheduleLivePreview();
}

// Wandelt die von perfect-freehand berechneten Umriss-Punkte in einen SVG-Pfad um (die von der
// perfect-freehand-Doku empfohlene Rendering-Methode), der dann per Path2D gefuellt wird.
function getSvgPathFromStroke(points) {
  const len = points.length;
  if (len < 4) return "";
  const average = (a, b) => (a + b) / 2;
  let a = points[0];
  let b = points[1];
  const c = points[2];
  let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(
    b[0],
    c[0]
  ).toFixed(2)},${average(b[1], c[1]).toFixed(2)} T`;
  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    result += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `;
  }
  return `${result}Z`;
}

// Rendert einen Stift-Strich in einen beliebigen Canvas-Context. Nutzt perfect-freehand fuer
// eine natuerliche, druckempfindliche Linienfuehrung; faellt auf eine einfache Polylinie
// zurueck, falls die perfect-freehand-Bibliothek (CDN) nicht geladen werden konnte.
function renderStrokeToContext(targetCtx, points) {
  if (points.length < 2) return;
  if (window.getStroke) {
    const outline = window.getStroke(points, PEN_STROKE_OPTIONS);
    const pathData = getSvgPathFromStroke(outline);
    if (pathData) {
      targetCtx.fillStyle = INK_COLOR;
      targetCtx.fill(new Path2D(pathData));
    }
  } else {
    targetCtx.strokeStyle = INK_COLOR;
    targetCtx.lineWidth = 2.5;
    targetCtx.lineCap = "round";
    targetCtx.beginPath();
    targetCtx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      targetCtx.lineTo(points[i][0], points[i][1]);
    }
    targetCtx.stroke();
  }
}

function renderLiveStroke() {
  liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  renderStrokeToContext(liveCtx, currentStrokePoints);
}

function commitLiveStroke() {
  if (currentStrokePoints.length >= 2) {
    ctx.globalCompositeOperation = "source-over";
    renderStrokeToContext(ctx, currentStrokePoints);
    hasInk = true;
    scheduleLivePreview();
  }
  liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  currentStrokePoints = [];
}

function startDraw(evt) {
  drawing = true;
  const pos = getPos(evt);
  // "destination-out" macht die uebermalten Pixel transparent statt sie einzufaerben - so
  // radiert der Radierer nur das Geschriebene weg, das karierte CSS-Hintergrundmuster bleibt sichtbar.
  if (currentTool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = ERASER_WIDTH;
    ctx.lineCap = "round";
    lastX = pos.x;
    lastY = pos.y;
  } else if (currentTool === "pen") {
    currentStrokePoints = [[pos.x, pos.y]];
  } else if (pendingShape) {
    shapeAnchor = pos;
  }
}

function draw(evt) {
  if (!drawing) return;
  const pos = getPos(evt);
  if (currentTool === "eraser") {
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastX = pos.x;
    lastY = pos.y;
    hasInk = true; // Radieren veraendert die Zeichnung ebenfalls - zaehlt fuer die Live-Vorschau.
  } else if (currentTool === "pen") {
    currentStrokePoints.push([pos.x, pos.y]);
    renderLiveStroke();
  } else if (pendingShape && shapeAnchor) {
    renderShapePreview(pos);
  }
}

function stopDraw(evt) {
  if (!drawing) return;
  drawing = false;
  if (currentTool === "pen") {
    commitLiveStroke();
  } else if (pendingShape && shapeAnchor) {
    commitShape(getPos(evt));
    pendingShape = null;
    shapeAnchor = null;
    setTool("pen");
  } else {
    scheduleLivePreview();
  }
}

liveCanvas.addEventListener("pointerdown", startDraw);
liveCanvas.addEventListener("pointermove", draw);
window.addEventListener("pointerup", stopDraw);

function clearCanvas() {
  resetCanvasSize();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  currentStrokePoints = [];
  hasInk = false;
  hideLivePreview();
}

document.getElementById("clear-btn").addEventListener("click", clearCanvas);

// ---------- Erweiterbare Zeichenflaeche ----------
// Reicht der Standardplatz nicht, kann die Canvas per Knopf schrittweise verlaengert werden;
// ein umgebender scrollbarer Rahmen (#notebook-scroll) verhindert, dass Werkzeugleiste und
// Abgeben-Knopf dabei aus dem sichtbaren Bereich rutschen.
const CANVAS_DEFAULT_HEIGHT = 500;
const CANVAS_GROW_STEP = 300;
const CANVAS_MAX_HEIGHT = 2600;

function resetCanvasSize() {
  canvas.height = CANVAS_DEFAULT_HEIGHT;
  liveCanvas.height = CANVAS_DEFAULT_HEIGHT;
}

function growCanvas() {
  if (canvas.height >= CANVAS_MAX_HEIGHT) return;
  const newHeight = Math.min(CANVAS_MAX_HEIGHT, canvas.height + CANVAS_GROW_STEP);
  // canvas.height zu setzen loescht den Inhalt - deshalb die bestehende Tinte vorher sichern
  // und danach wiederherstellen.
  const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.height = newHeight;
  liveCanvas.height = newHeight;
  ctx.putImageData(snapshot, 0, 0);
  const scrollEl = document.getElementById("notebook-scroll");
  scrollEl.scrollTop = scrollEl.scrollHeight;
}

document.getElementById("more-space-btn").addEventListener("click", growCanvas);

// Stellt eine zuvor gespeicherte Antwort wieder her (Pruefungsmodus: Zurueckblaettern zu einer
// bereits bearbeiteten Aufgabe). Passt die Canvas-Groesse an das gespeicherte Bild an, falls die
// Aufgabe vorher per "Mehr Platz" vergroessert wurde.
function restoreCanvasFromImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      liveCanvas.width = img.naturalWidth;
      liveCanvas.height = img.naturalHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
      hasInk = true;
      resolve();
    };
    img.src = dataUrl;
  });
}

// ---------- Live-Vorschau (MathPix OCR waehrend des Schreibens) ----------
// Ruft MathPix NICHT bei jedem Strich auf, sondern erst nach einer kurzen Schreibpause
// (Debounce), um die MathPix-Kosten im Rahmen zu halten. Rein informativ - Fehler hier duerfen
// die eigentliche Aufgabe nicht stoeren.
const LIVE_PREVIEW_DEBOUNCE_MS = 1200;
let livePreviewTimer = null;
let livePreviewInFlight = false;

function hideLivePreview() {
  clearTimeout(livePreviewTimer);
  livePreviewTimer = null;
  document.getElementById("live-preview").classList.add("hidden");
  document.getElementById("live-preview-content").textContent = "";
}

function scheduleLivePreview() {
  if (!hasInk) return;
  clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(runLivePreview, LIVE_PREVIEW_DEBOUNCE_MS);
}

async function runLivePreview() {
  if (livePreviewInFlight || !hasInk) return;
  livePreviewInFlight = true;
  try {
    const image = canvas.toDataURL("image/png");
    const { ok, data } = await api("/api/ocr-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    const box = document.getElementById("live-preview");
    if (!ok || (!data.text && !data.latex)) {
      box.classList.add("hidden");
      return;
    }
    renderMath(document.getElementById("live-preview-content"), data.latex, data.text);
    box.classList.remove("hidden");
  } catch {
    // Live-Vorschau ist ein Komfortfeature - Netzwerkfehler hier werden bewusst ignoriert.
  } finally {
    livePreviewInFlight = false;
  }
}

// ---------- Kleine API-Hilfsfunktion ----------
// Auf dem Web laeuft der Server unter derselben Origin (relative Pfade reichen). In der iOS-App
// (Capacitor) laedt die WebView die Seite aber lokal, daher muss dort eine volle Backend-URL
// gesetzt werden - siehe mobile/www/index.html (window.MATHEAPP_API_BASE_URL).
const API_BASE_URL = window.MATHEAPP_API_BASE_URL || "";

async function api(url, options) {
  const opts = { ...(options || {}) };
  if (state.token) {
    opts.headers = { ...(opts.headers || {}), Authorization: `Bearer ${state.token}` };
  }
  let res;
  try {
    res = await fetch(`${API_BASE_URL}${url}`, opts);
  } catch (err) {
    // fetch() selbst schlaegt fehl bei Netzwerkabbruch/Server-Crash (nicht nur bei HTTP-
    // Fehlerstatus) - ohne diesen catch wuerde das hier als unbehandelte Exception durchschlagen
    // und z.B. finishRun() mittendrin abbrechen, ohne dass Sterne/Fehleranzeige je gesetzt werden.
    return { ok: false, status: 0, data: { error: err?.message || "Netzwerkfehler" } };
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  // Ein abgelaufenes/ungueltiges Token (Server neu gestartet, SESSION_SECRET geaendert, Token zu
  // alt) fuehrt sonst zu lauter kryptischen 401-Fehlern quer durch die App - stattdessen einmal
  // sauber ausloggen und den Login-Bildschirm zeigen.
  if (res.status === 401 && state.token && !url.startsWith("/api/auth/login")) {
    logout();
  }
  return { ok: res.ok, status: res.status, data };
}

// ---------- PencilKit (iOS/Capacitor) ----------
// Auf iOS wird statt des HTML-Canvas ein natives PencilKit-Fenster geoeffnet (Custom Capacitor
// Plugin "PencilKit", siehe mobile/ios-plugin-source/). Ueberall sonst bleibt der HTML-Canvas aktiv.
function isNativeIOS() {
  const cap = window.Capacitor;
  return Boolean(cap && cap.isNativePlatform && cap.isNativePlatform() && cap.getPlatform && cap.getPlatform() === "ios");
}

let iosDrawingDataUrl = null;

function resetIosDrawing() {
  iosDrawingDataUrl = null;
  const preview = document.getElementById("pencilkit-preview");
  preview.classList.add("hidden");
  preview.src = "";
  document.getElementById("pencilkit-open-btn").textContent = "✍️ Lösung mit Stift schreiben";
}

// Liefert das PNG (Data-URL) der aktuellen Loesung - je nach Plattform aus PencilKit oder Canvas.
async function captureDrawing() {
  if (isNativeIOS()) {
    return iosDrawingDataUrl;
  }
  return canvas.toDataURL("image/png");
}

if (isNativeIOS()) {
  document.getElementById("notebook").classList.add("hidden");
  document.getElementById("tool-pen").classList.add("hidden");
  document.getElementById("tool-eraser").classList.add("hidden");
  document.getElementById("clear-btn").classList.add("hidden");
  document.getElementById("pencilkit-wrap").classList.remove("hidden");
}

document.getElementById("pencilkit-open-btn").addEventListener("click", async () => {
  const plugin = window.Capacitor?.Plugins?.PencilKit;
  if (!plugin) {
    alert("PencilKit-Plugin nicht verfuegbar. Bitte die App neu starten.");
    return;
  }
  try {
    const result = await plugin.openCanvas();
    iosDrawingDataUrl = result.image;
    const preview = document.getElementById("pencilkit-preview");
    preview.src = iosDrawingDataUrl;
    preview.classList.remove("hidden");
    document.getElementById("pencilkit-open-btn").textContent = "✍️ Lösung erneut schreiben";
  } catch (err) {
    if (err.message !== "Abgebrochen.") {
      alert(`PencilKit-Fehler: ${err.message}`);
    }
  }
});

// ---------- Screens ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  if (id !== "screen-task") {
    stopExamTimer();
  }
}

// Schweizer Notenformel: Note = erreichte Punkte * 5 / maximale Punkte + 1, auf 2 Stellen gerundet.
function computeGrade(awardedPoints, totalPoints) {
  if (!totalPoints) return null;
  return Math.round(((awardedPoints * 5) / totalPoints + 1) * 100) / 100;
}

// ---------- Pruefungsmodus-Timer (90 Minuten Gegenzeit) ----------
const EXAM_DURATION_SECONDS = 90 * 60;
let examTimerInterval = null;
let examSecondsLeft = EXAM_DURATION_SECONDS;

function formatCountdown(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function stopExamTimer() {
  clearInterval(examTimerInterval);
  examTimerInterval = null;
  document.getElementById("exam-timer").classList.add("hidden");
}

function startExamTimer() {
  examSecondsLeft = EXAM_DURATION_SECONDS;
  const timerEl = document.getElementById("exam-timer");
  const valueEl = document.getElementById("exam-timer-value");
  timerEl.classList.remove("hidden", "exam-timer-expired");
  valueEl.textContent = formatCountdown(examSecondsLeft);
  clearInterval(examTimerInterval);
  examTimerInterval = setInterval(() => {
    examSecondsLeft -= 1;
    if (examSecondsLeft <= 0) {
      examSecondsLeft = 0;
      valueEl.textContent = "00:00";
      timerEl.classList.add("exam-timer-expired");
      clearInterval(examTimerInterval);
      examTimerInterval = null;
      return;
    }
    valueEl.textContent = formatCountdown(examSecondsLeft);
  }, 1000);
}

function setActiveNav(navId) {
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.id === navId));
}

// Fragt nach, wenn man mitten in einer laufenden Aufgabe/Pruefung wegnavigiert (Fortschritt geht verloren).
function confirmLeaveTask() {
  const taskScreenVisible = !document.getElementById("screen-task").classList.contains("hidden");
  if (!taskScreenVisible) return true;
  return confirm("Dein aktueller Fortschritt in dieser Aufgabe/Prüfung geht verloren. Trotzdem fortfahren?");
}

// Rendert LaTeX (Bruchstriche, Wurzeln, Hochzahlen, ...) in ein Element; faellt bei fehlendem
// LaTeX oder Rendering-Fehlern auf reinen Text zurueck.
function renderMath(el, latex, fallbackText) {
  if (!latex) {
    el.textContent = fallbackText || "";
    return;
  }
  try {
    window.katex.render(latex, el, { throwOnError: false, displayMode: false });
  } catch {
    el.textContent = fallbackText || latex;
  }
}

// Fuegt Text in ein Element ein und wandelt darin enthaltene "\n" in echte <br>-Zeilenumbrueche
// um - ein reiner Text-Node wuerde das Newline-Zeichen sonst per CSS (white-space: normal) als
// Leerzeichen darstellen, der Umbruch waere unsichtbar.
function appendTextWithLineBreaks(el, text) {
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    el.appendChild(document.createTextNode(line));
    if (i < lines.length - 1) {
      el.appendChild(document.createElement("br"));
    }
  });
}

// Rendert eine Aufgabenstellung, die aus laengerem Beschreibungstext (in \text{...}) und
// kurzen Mathe-Ausdruecken gemischt sein kann. KaTeX bietet innerhalb von \text{...} keine
// Umbruchstellen fuer den Browser (Leerzeichen werden als feste Abstaende, nicht als
// umbrechbare Zeichen gerendert) - lange Saetze wuerden sonst als eine einzige, nicht
// umbrechende Zeile ueberlaufen. Deshalb wird \text{...} als normaler (umbrechbarer) Text
// eingefuegt und nur die uebrigen, kurzen Mathe-Fragmente per KaTeX gerendert.
function renderProblemStatement(el, latex, fallbackText) {
  el.innerHTML = "";
  if (!latex) {
    el.textContent = fallbackText || "";
    return;
  }
  try {
    const parts = latex.split(/\\text\{([^{}]*)\}/g);
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        appendTextWithLineBreaks(el, part);
      } else if (part.trim()) {
        const span = document.createElement("span");
        window.katex.render(part, span, { throwOnError: false, displayMode: false });
        el.appendChild(span);
      }
    });
  } catch {
    el.textContent = fallbackText || latex;
  }
}

// ---------- App-Zustand ----------
const state = {
  username: localStorage.getItem("matheapp_username") || "",
  token: localStorage.getItem("matheapp_token") || "",
  isAdmin: localStorage.getItem("matheapp_isAdmin") === "true",
  meta: { years: [], categories: [] },
  mode: null, // 'uebung' | 'pruefung_jahr' | 'pruefung_kategorie'
  scope: null, // problemId (uebung) oder Jahr/Kategorie (pruefung)
  queue: [],
  currentIndex: 0,
  results: [], // { problemId, points, awarded, fullyCorrect }
  answers: [], // Pruefungsmodus: pro Aufgabe { image, hasInk, hintsUsed, nextHintIndex, revealedHints }
  nextHintIndex: 0,
  hintsUsedForCurrent: false,
  starsBeforeRun: 0,
};

// Pruefungsmodus (egal ob nach Jahr oder Kategorie) erlaubt freies Vor-/Zurueckblaettern und
// eine einzige Gesamt-Abgabe am Schluss - im Gegensatz zum Uebungsmodus, der pro Aufgabe sofort
// auswertet und Feedback zeigt.
function isPruefungMode(mode) {
  return mode === "pruefung_jahr" || mode === "pruefung_kategorie";
}

// ---------- Level-System (10 Sterne pro Level, 100 Level = 1000 Sterne) ----------
// Ein eigener Titel pro Level (Index 0 = Level 1, Index 99 = Level 100).
const LEVEL_TITLES = [
  "Zahlen-Entdecker",
  "Rechen-Rookie",
  "Plus-Pilot",
  "Minus-Starter",
  "Zahlen-Navigator",
  "Rechen-Forscher",
  "Mathe-Abenteurer",
  "Zahlen-Scout",
  "Rechen-Pfadfinder",
  "Mathe-Lehrling",
  "Zahlen-Sammler",
  "Rechen-Tüftler",
  "Mathe-Starter",
  "Zahlen-Künstler",
  "Rechen-Trainer",
  "Mathe-Pfadfinder",
  "Zahlen-Pilot",
  "Rechen-Agent",
  "Mathe-Entdecker",
  "Zahlen-Hüter",
  "Rechen-Stratege",
  "Mathe-Analyst",
  "Zahlen-Architekt",
  "Rechen-Pilot Pro",
  "Mathe-Navigator",
  "Zahlen-Magier",
  "Rechen-Meisterschüler",
  "Mathe-Forscher",
  "Zahlen-Pilot Elite",
  "Rechen-Designer",
  "Mathe-Taktiker",
  "Zahlen-Strategist",
  "Rechen-Kommandant",
  "Mathe-Pilot",
  "Zahlen-Ingenieur",
  "Rechen-Architekt",
  "Mathe-Operator",
  "Zahlen-Analytiker",
  "Rechen-Pilot Ultra",
  "Mathe-Denker",
  "Zahlen-Champion",
  "Rechen-Champion",
  "Mathe-Champion",
  "Zahlen-Virtuose",
  "Rechen-Virtuose",
  "Mathe-Virtuose",
  "Zahlen-Profi",
  "Rechen-Profi",
  "Mathe-Profi",
  "Zahlen-Pilot Master",
  "Rechen-Pilot Master",
  "Mathe-Pilot Master",
  "Zahlen-Strategie-Master",
  "Rechen-Strategie-Master",
  "Mathe-Strategie-Master",
  "Zahlen-Taktik-Master",
  "Rechen-Taktik-Master",
  "Mathe-Taktik-Master",
  "Zahlen-Pilot Supreme",
  "Rechen-Pilot Supreme",
  "Mathe-Pilot Supreme",
  "Zahlen-Experte",
  "Rechen-Experte",
  "Mathe-Experte",
  "Zahlen-Guru",
  "Rechen-Guru",
  "Mathe-Guru",
  "Zahlen-Weiser",
  "Rechen-Weiser",
  "Mathe-Weiser",
  "Zahlen-Spezialist",
  "Rechen-Spezialist",
  "Mathe-Spezialist",
  "Zahlen-Pilot Legend",
  "Rechen-Pilot Legend",
  "Mathe-Pilot Legend",
  "Zahlen-Denker Elite",
  "Rechen-Denker Elite",
  "Mathe-Denker Elite",
  "Zahlen-Pilot Infinity",
  "Rechen-Pilot Infinity",
  "Mathe-Pilot Infinity",
  "Zahlen-Mastermind",
  "Rechen-Mastermind",
  "Mathe-Mastermind",
  "Zahlen-Orakel",
  "Rechen-Orakel",
  "Mathe-Orakel",
  "Zahlen-Titan",
  "Rechen-Titan",
  "Mathe-Titan",
  "Zahlen-Legende",
  "Rechen-Legende",
  "Mathe-Legende",
  "Zahlen-Phänomen",
  "Rechen-Phänomen",
  "Mathe-Phänomen",
  "Zahlen-Genie",
  "Rechen-Genie",
  "Mathe-Genie",
];
const STARS_PER_LEVEL = 10;
const MAX_LEVEL = 100;

function getLevelInfo(totalStars) {
  const stars = Math.max(0, totalStars);
  const level = Math.min(MAX_LEVEL, Math.floor(stars / STARS_PER_LEVEL) + 1);
  const titleIndex = Math.min(LEVEL_TITLES.length - 1, level - 1);
  const isMaxLevel = level >= MAX_LEVEL;
  const starsIntoLevel = stars - (level - 1) * STARS_PER_LEVEL;
  return {
    level,
    title: LEVEL_TITLES[titleIndex],
    isMaxLevel,
    starsToNext: isMaxLevel ? 0 : STARS_PER_LEVEL - starsIntoLevel,
    progressPercent: isMaxLevel ? 100 : Math.round((starsIntoLevel / STARS_PER_LEVEL) * 100),
  };
}

function renderLevelInfo(totalStars) {
  const info = getLevelInfo(totalStars);
  document.getElementById("level-title").textContent = `Level ${info.level} – ${info.title}`;
  document.getElementById("level-progress-fill").style.width = `${info.progressPercent}%`;
  document.getElementById("level-next").textContent = info.isMaxLevel
    ? "Höchstes Level erreicht!"
    : `Noch ${info.starsToNext} ⭐ bis Level ${info.level + 1}`;
  document.getElementById("level-info").classList.remove("hidden");
  return info;
}

function launchConfetti() {
  const container = document.getElementById("confetti-container");
  const colors = ["#f94144", "#f3722c", "#f9c74f", "#90be6d", "#577590", "#277da1"];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${1.5 + Math.random() * 1.5}s`;
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    piece.addEventListener("animationend", () => piece.remove());
    container.appendChild(piece);
  }
}

function showLevelUpCelebration(info) {
  document.getElementById("level-up-message").textContent = `Dein neuer Level ist: ${info.level} – ${info.title}`;
  document.getElementById("level-up-overlay").classList.remove("hidden");
  launchConfetti();
}

document.getElementById("btn-level-up-close").addEventListener("click", () => {
  document.getElementById("level-up-overlay").classList.add("hidden");
  document.getElementById("confetti-container").innerHTML = "";
});

// ---------- Bonus-Merkspiel (nur Uebungsmodus, nach richtig geloester Aufgabe) ----------
const MINIGAME_TIME_LIMIT_SECONDS = 30;
const MINIGAME_CARD_BACK = "🎴";
const MINIGAME_SYMBOLS = ["🐶", "🐱", "🐭", "🐰", "🦊", "🐻", "🐯", "🐨"];

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Oeffnet das 4x4-Merkspiel. onComplete(won) wird genau einmal aufgerufen, sobald das Spiel
// endet (gewonnen, Zeit abgelaufen oder manuell geschlossen).
function openMemoryGame(onComplete) {
  const overlay = document.getElementById("minigame-overlay");
  const grid = document.getElementById("minigame-grid");
  const timerEl = document.getElementById("minigame-timer");
  const resultEl2 = document.getElementById("minigame-result");
  const closeBtn = document.getElementById("btn-minigame-close");

  const deck = shuffle([...MINIGAME_SYMBOLS, ...MINIGAME_SYMBOLS]);
  let flipped = [];
  let matchedCount = 0;
  let locked = false;
  let finished = false;
  let timeLeft = MINIGAME_TIME_LIMIT_SECONDS;

  grid.innerHTML = "";
  resultEl2.classList.add("hidden");
  resultEl2.textContent = "";
  timerEl.textContent = `⏱ ${timeLeft}s`;
  timerEl.classList.remove("low");
  overlay.classList.remove("hidden");

  const cards = deck.map((symbol, index) => {
    const card = document.createElement("button");
    card.className = "minigame-card";
    card.type = "button";
    card.textContent = MINIGAME_CARD_BACK;
    card.addEventListener("click", () => handleCardClick(index));
    grid.appendChild(card);
    return { symbol, el: card, matched: false };
  });

  function finish(won) {
    if (finished) return;
    finished = true;
    clearInterval(timerHandle);
    cards.forEach((c) => (c.el.disabled = true));
    resultEl2.textContent = won
      ? "🎉 Geschafft! Du hast einen Zusatzstern verdient!"
      : "⏰ Zeit abgelaufen – diesmal leider kein Zusatzstern.";
    resultEl2.classList.remove("hidden");
    onComplete(won);
  }

  function handleCardClick(index) {
    if (finished || locked) return;
    const card = cards[index];
    if (card.matched || card.el.classList.contains("flipped")) return;

    card.el.textContent = card.symbol;
    card.el.classList.add("flipped");
    flipped.push(index);

    if (flipped.length === 2) {
      locked = true;
      const [a, b] = flipped;
      if (cards[a].symbol === cards[b].symbol) {
        cards[a].matched = true;
        cards[b].matched = true;
        cards[a].el.classList.add("matched");
        cards[b].el.classList.add("matched");
        flipped = [];
        locked = false;
        matchedCount += 1;
        if (matchedCount === MINIGAME_SYMBOLS.length) {
          finish(true);
        }
      } else {
        setTimeout(() => {
          cards[a].el.textContent = MINIGAME_CARD_BACK;
          cards[b].el.textContent = MINIGAME_CARD_BACK;
          cards[a].el.classList.remove("flipped");
          cards[b].el.classList.remove("flipped");
          flipped = [];
          locked = false;
        }, 600);
      }
    }
  }

  const timerHandle = setInterval(() => {
    timeLeft -= 1;
    timerEl.textContent = `⏱ ${timeLeft}s`;
    if (timeLeft <= 3) timerEl.classList.add("low");
    if (timeLeft <= 0) finish(false);
  }, 1000);

  closeBtn.onclick = () => {
    if (!finished) finish(false);
    overlay.classList.add("hidden");
  };
}

// ---------- Bonus-Bubble-Pop (alterniert mit dem Merkspiel) ----------
const BUBBLEPOP_TIME_LIMIT_SECONDS = 15;
const BUBBLEPOP_TARGET = 15;
const BUBBLEPOP_MAX_ON_SCREEN = 5;
const BUBBLE_COLORS = ["#4fc3f7", "#81c784", "#ffd54f", "#f06292", "#ba68c8", "#ff8a65"];

// Oeffnet das Bubble-Pop-Spiel. onComplete(won) wird genau einmal aufgerufen, sobald das Spiel
// endet (Zielanzahl erreicht, Zeit abgelaufen oder manuell geschlossen).
function openBubblePopGame(onComplete) {
  const overlay = document.getElementById("bubblepop-overlay");
  const area = document.getElementById("bubblepop-area");
  const timerEl = document.getElementById("bubblepop-timer");
  const scoreEl = document.getElementById("bubblepop-score");
  const resultEl3 = document.getElementById("bubblepop-result");
  const closeBtn = document.getElementById("btn-bubblepop-close");

  let popped = 0;
  let finished = false;
  let timeLeft = BUBBLEPOP_TIME_LIMIT_SECONDS;
  const activeBubbles = [];

  area.innerHTML = "";
  resultEl3.classList.add("hidden");
  resultEl3.textContent = "";
  timerEl.textContent = `⏱ ${timeLeft}s`;
  timerEl.classList.remove("low");
  scoreEl.textContent = `Geplatzt: 0 / ${BUBBLEPOP_TARGET}`;
  overlay.classList.remove("hidden");

  function spawnBubble() {
    if (finished) return;
    const size = 40 + Math.random() * 25;
    const bubble = document.createElement("button");
    bubble.type = "button";
    bubble.className = "bubble";
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.left = `${Math.random() * Math.max(1, area.clientWidth - size)}px`;
    bubble.style.top = `${Math.random() * Math.max(1, area.clientHeight - size)}px`;
    bubble.style.background = BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)];
    bubble.addEventListener("click", () => popBubble(bubble));
    area.appendChild(bubble);
    activeBubbles.push(bubble);
  }

  function popBubble(bubble) {
    if (finished) return;
    bubble.remove();
    const idx = activeBubbles.indexOf(bubble);
    if (idx !== -1) activeBubbles.splice(idx, 1);
    popped += 1;
    scoreEl.textContent = `Geplatzt: ${popped} / ${BUBBLEPOP_TARGET}`;
    if (popped >= BUBBLEPOP_TARGET) {
      finish(true);
    } else {
      spawnBubble();
    }
  }

  function finish(won) {
    if (finished) return;
    finished = true;
    clearInterval(timerHandle);
    activeBubbles.forEach((b) => (b.disabled = true));
    resultEl3.textContent = won
      ? "🎉 Geschafft! Du hast einen Zusatzstern verdient!"
      : "⏰ Zeit abgelaufen – diesmal leider kein Zusatzstern.";
    resultEl3.classList.remove("hidden");
    onComplete(won);
  }

  for (let i = 0; i < BUBBLEPOP_MAX_ON_SCREEN; i++) spawnBubble();

  const timerHandle = setInterval(() => {
    timeLeft -= 1;
    timerEl.textContent = `⏱ ${timeLeft}s`;
    if (timeLeft <= 3) timerEl.classList.add("low");
    if (timeLeft <= 0) finish(false);
  }, 1000);

  closeBtn.onclick = () => {
    if (!finished) finish(false);
    overlay.classList.add("hidden");
    area.innerHTML = "";
  };
}

// Welches Bonus-Spiel als naechstes angeboten wird; wechselt bei jedem Spielstart.
let nextBonusGame = "memory"; // 'memory' | 'bubble'

let currentTotalStars = 0;

async function refreshStarsTotal() {
  const starsEl = document.getElementById("stars-total");
  if (!state.username) {
    starsEl.classList.add("hidden");
    document.getElementById("level-info").classList.add("hidden");
    return;
  }
  const { ok, data } = await api("/api/results");
  if (!ok || !Array.isArray(data)) {
    starsEl.classList.add("hidden");
    document.getElementById("level-info").classList.add("hidden");
    return;
  }
  currentTotalStars = data.reduce((sum, r) => sum + (r.stars || 0), 0);
  starsEl.textContent = `⭐ Gesammelte Sterne: ${currentTotalStars}`;
  starsEl.classList.remove("hidden");
  renderLevelInfo(currentTotalStars);
}

// ---------- Metadaten (Jahre/Kategorien) laden ----------
async function loadMeta() {
  const { ok, data } = await api("/api/meta");
  if (!ok) return;
  state.meta = data;

  const fillOptions = (select, values, placeholder) => {
    const current = select.value;
    select.innerHTML =
      (placeholder ? `<option value="">${placeholder}</option>` : "") +
      values.map((v) => `<option value="${v}">${v}</option>`).join("");
    // Vorherige Auswahl nur wiederherstellen, wenn sie noch existiert; sonst die vom Browser
    // automatisch gewaehlte erste Option stehen lassen (sonst landet der Select ohne Auswahl).
    if (current && values.some((v) => String(v) === current)) {
      select.value = current;
    }
  };

  fillOptions(document.getElementById("uebung-year"), data.years, "Alle Jahre");
  fillOptions(document.getElementById("uebung-category"), data.categories, "Alle Kategorien");
  fillOptions(document.getElementById("pruefung-year"), data.years);
  fillOptions(document.getElementById("pruefung-category"), data.categories);
}

// ---------- Uebungsmodus ----------
// Kuerzt lange Aufgabentexte fuer die Dropdown-Beschriftung. Ohne das kann ein einzelnes,
// sehr breites <option> (z.B. eine lange Textaufgabe) mobilen Browsern (v.a. iOS Safari) das
// gesamte Seitenlayout "verzerren": WebKit misst die Select-Box am breitesten Optionstext und
// zoomt dann die komplette Seite raus, damit diese eine Box hineinpasst.
function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

async function loadUebungProblems() {
  const year = document.getElementById("uebung-year").value;
  const category = document.getElementById("uebung-category").value;
  const params = new URLSearchParams();
  if (year) params.set("year", year);
  if (category) params.set("category", category);

  const { ok, data } = await api(`/api/problems?${params.toString()}`);
  const select = document.getElementById("uebung-problem");
  if (!ok || !Array.isArray(data) || data.length === 0) {
    select.innerHTML = "<option value=''>Keine Aufgaben gefunden</option>";
    return;
  }
  select.innerHTML = data
    .map((p) => {
      // Aufgabennummer aus der id ableiten (z.B. "2026-1a1" -> "1a1"), damit man die Aufgabe im
      // Dropdown eindeutig wiederfindet, auch wenn mehrere Aufgaben gleiches Jahr/Kategorie haben.
      const exerciseNumber = p.id.slice(p.id.indexOf("-") + 1);
      return `<option value="${p.id}">[${p.year} · ${exerciseNumber} · ${p.category} · ${p.points} P.] ${truncate(p.text, 55)}</option>`;
    })
    .join("");
  state.uebungProblems = data;
}

async function goToStart() {
  if (!confirmLeaveTask()) return;
  setActiveNav("nav-start");
  showScreen("screen-start");
  await refreshStarsTotal();
}

async function goToUebung() {
  if (!requireLogin(goToUebung)) return;
  if (!confirmLeaveTask()) return;
  setActiveNav("nav-uebung");
  showScreen("screen-uebung-setup");
  await loadUebungProblems();
}

document.getElementById("nav-start").addEventListener("click", goToStart);
document.getElementById("nav-uebung").addEventListener("click", goToUebung);
document.getElementById("card-uebung").addEventListener("click", goToUebung);

document.getElementById("uebung-year").addEventListener("change", loadUebungProblems);
document.getElementById("uebung-category").addEventListener("change", loadUebungProblems);

document.getElementById("btn-uebung-start").addEventListener("click", () => {
  const select = document.getElementById("uebung-problem");
  const problemId = select.value;
  const problem = (state.uebungProblems || []).find((p) => p.id === problemId);
  if (!problem) {
    alert("Bitte eine Aufgabe auswaehlen.");
    return;
  }
  state.mode = "uebung";
  state.scope = problem.id;
  startTaskFlow([problem]);
});

// ---------- Pruefungsmodus ----------
let pruefungVariant = null; // 'jahr' | 'kategorie'

function selectPruefungVariant(variant) {
  pruefungVariant = variant;
  document.getElementById("btn-pruefung-jahr").classList.toggle("active", variant === "jahr");
  document.getElementById("btn-pruefung-kategorie").classList.toggle("active", variant === "kategorie");
  document.getElementById("pruefung-jahr-picker").classList.toggle("hidden", variant !== "jahr");
  document.getElementById("pruefung-kategorie-picker").classList.toggle("hidden", variant !== "kategorie");
  document.getElementById("btn-pruefung-start").classList.remove("hidden");
}

async function goToPruefungSetup() {
  if (!requireLogin(goToPruefungSetup)) return;
  if (!confirmLeaveTask()) return;
  pruefungVariant = null;
  document.getElementById("btn-pruefung-jahr").classList.remove("active");
  document.getElementById("btn-pruefung-kategorie").classList.remove("active");
  document.getElementById("pruefung-jahr-picker").classList.add("hidden");
  document.getElementById("pruefung-kategorie-picker").classList.add("hidden");
  document.getElementById("btn-pruefung-start").classList.add("hidden");
  setActiveNav("nav-pruefung");
  showScreen("screen-pruefung-setup");
}

document.getElementById("nav-pruefung").addEventListener("click", goToPruefungSetup);
document.getElementById("card-pruefung").addEventListener("click", goToPruefungSetup);

document.getElementById("btn-pruefung-jahr").addEventListener("click", () => selectPruefungVariant("jahr"));
document.getElementById("btn-pruefung-kategorie").addEventListener("click", () => selectPruefungVariant("kategorie"));

document.getElementById("btn-pruefung-start").addEventListener("click", async () => {
  if (pruefungVariant === "jahr") {
    const year = document.getElementById("pruefung-year").value;
    const { ok, data } = await api(`/api/problems?year=${encodeURIComponent(year)}`);
    if (!ok || !data.length) return alert("Keine Aufgaben fuer dieses Jahr gefunden.");
    state.mode = "pruefung_jahr";
    state.scope = year;
    startTaskFlow(data);
  } else if (pruefungVariant === "kategorie") {
    const category = document.getElementById("pruefung-category").value;
    const { ok, data } = await api(`/api/problems?category=${encodeURIComponent(category)}`);
    if (!ok || !data.length) return alert("Keine Aufgaben fuer diese Kategorie gefunden.");
    state.mode = "pruefung_kategorie";
    state.scope = category;
    startTaskFlow(data);
  } else {
    alert("Bitte 'Nach Jahr' oder 'Nach Kategorie' waehlen.");
  }
});

// ---------- Gemeinsamer Aufgaben-Ablauf ----------
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const submitBtn = document.getElementById("submit-btn");
const nextBtn = document.getElementById("btn-next");

function startTaskFlow(queue) {
  state.queue = queue;
  state.currentIndex = 0;
  state.results = [];
  state.answers = queue.map(() => ({
    image: null,
    hasInk: false,
    hintsUsed: false,
    nextHintIndex: 0,
    hintsExhausted: false,
    revealedHints: [],
  }));
  state.starsBeforeRun = currentTotalStars;
  showScreen("screen-task");
  if (isPruefungMode(state.mode)) {
    startExamTimer();
  } else {
    stopExamTimer();
  }
  loadCurrentTask();
}

// Zeigt optionale Zusatzbilder einer Aufgabe (z.B. Geometriefiguren) unter dem Aufgabentext.
function renderProblemImages(images) {
  const container = document.getElementById("problem-images");
  container.innerHTML = "";
  (images || []).forEach((src) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "Aufgaben-Abbildung";
    container.appendChild(img);
  });
}

function loadCurrentTask() {
  const problem = state.queue[state.currentIndex];
  const progressEl = document.getElementById("task-progress");
  if (state.queue.length > 1) {
    progressEl.textContent = `Aufgabe ${state.currentIndex + 1} von ${state.queue.length}`;
    progressEl.classList.remove("hidden");
  } else {
    progressEl.classList.add("hidden");
  }
  document.getElementById("problem-text").innerHTML = "";
  renderProblemStatement(document.getElementById("problem-text"), problem.latex, problem.text);
  renderProblemImages(problem.images);

  const examMode = isPruefungMode(state.mode);
  const answer = examMode ? state.answers[state.currentIndex] : null;

  clearCanvas();
  setTool("pen");
  pendingShape = null;
  shapeAnchor = null;
  document.getElementById("shape-tools").classList.toggle("hidden", problem.category !== "Geometrie");
  resetIosDrawing();
  if (answer?.image) {
    restoreCanvasFromImage(answer.image);
  }
  resultEl.classList.add("hidden");
  statusEl.textContent = "";

  // Uebungsmodus: Abgeben wertet sofort aus. Pruefungsmodus: Navigation + eine Gesamt-Abgabe
  // am Schluss, kein sofortiges Feedback pro Aufgabe (wie bei einer echten Pruefung).
  submitBtn.classList.toggle("hidden", examMode);
  nextBtn.classList.add("hidden");
  const examNav = document.getElementById("exam-nav");
  examNav.classList.toggle("hidden", !examMode);
  if (examMode) {
    document.getElementById("exam-prev-btn").disabled = state.currentIndex === 0;
    document.getElementById("exam-next-btn").disabled = state.currentIndex === state.queue.length - 1;
  }

  state.nextHintIndex = answer?.nextHintIndex ?? 0;
  state.hintsUsedForCurrent = answer?.hintsUsed ?? false;
  const hintBtn = document.getElementById("hint-btn");
  // problem.hints wird vom Server nicht mitgeschickt (bleibt geheim) - deshalb den Ausschoepfungs-
  // Stand explizit merken (siehe hint-btn-Handler), statt ihn hier aus problem.hints herzuleiten.
  const hintsExhausted = Boolean(answer?.hintsExhausted);
  hintBtn.disabled = hintsExhausted;
  hintBtn.textContent = hintsExhausted ? "💡 Keine weiteren Hinweise" : "💡 Hinweis";
  const hintBox = document.getElementById("hint-box");
  if (answer?.revealedHints?.length > 0) {
    hintBox.textContent = answer.revealedHints[answer.revealedHints.length - 1];
    hintBox.classList.remove("hidden");
  } else {
    hintBox.textContent = "";
    hintBox.classList.add("hidden");
  }

  const bonusBtn = document.getElementById("btn-play-bonus-game");
  bonusBtn.classList.add("hidden");
  bonusBtn.disabled = false;
  bonusBtn.onclick = null;
}


document.getElementById("hint-btn").addEventListener("click", async () => {
  const problem = state.queue[state.currentIndex];
  const hintBtn = document.getElementById("hint-btn");
  const hintBox = document.getElementById("hint-box");

  const { ok, data } = await api(
    `/api/hint?problemId=${encodeURIComponent(problem.id)}&index=${state.nextHintIndex}`
  );
  if (!ok) {
    hintBox.textContent = `Fehler: ${data.error || "Hinweis konnte nicht geladen werden."}`;
    hintBox.classList.remove("hidden");
    return;
  }

  state.hintsUsedForCurrent = true;
  hintBox.textContent = data.totalHints > 0 ? `Hinweis ${data.hintIndex + 1}/${data.totalHints}: ${data.hint}` : data.hint;
  hintBox.classList.remove("hidden");

  if (data.hasMore) {
    state.nextHintIndex = data.hintIndex + 1;
  } else {
    hintBtn.disabled = true;
    hintBtn.textContent = "💡 Keine weiteren Hinweise";
  }

  // Pruefungsmodus: Hinweis-Stand pro Aufgabe merken, damit er beim Zurueckblaettern erhalten bleibt.
  if (isPruefungMode(state.mode)) {
    const answer = state.answers[state.currentIndex];
    answer.hintsUsed = true;
    answer.nextHintIndex = state.nextHintIndex;
    answer.hintsExhausted = !data.hasMore;
    answer.revealedHints.push(hintBox.textContent);
  }
});

submitBtn.addEventListener("click", async () => {
  const problem = state.queue[state.currentIndex];

  if (isNativeIOS() && !iosDrawingDataUrl) {
    alert("Bitte zuerst deine Lösung mit dem Stift schreiben.");
    return;
  }

  resultEl.classList.add("hidden");
  statusEl.textContent = "Werte Lösung aus ...";
  submitBtn.disabled = true;

  const image = await captureDrawing();

  try {
    const { ok, data } = await api("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problemId: problem.id, image, hintsUsed: state.hintsUsedForCurrent }),
    });
    if (!ok) {
      statusEl.textContent = `Fehler: ${data.error || "unbekannt"}`;
      return;
    }
    document.getElementById("result-transcription").textContent = data.transcription || "(nichts erkannt)";
    renderMath(document.getElementById("result-latex-rendered"), data.latex, data.transcription);

    const badgeEl = document.getElementById("result-correct");
    if (data.hintsUsed) {
      badgeEl.textContent = `💡 Hinweise verwendet (0 / ${data.points} Punkte)`;
    } else if (data.correct) {
      // Sterne gibt es nur im Uebungsmodus - im Pruefungsmodus zaehlen stattdessen Prozent/Note.
      const starSuffix = state.mode === "uebung" ? " ⭐" : "";
      badgeEl.textContent = `Richtig ✅ (${data.awarded} / ${data.points} Punkte)${starSuffix}`;
    } else if (data.awarded > 0) {
      badgeEl.textContent = `Teilweise richtig 🌗 (${data.awarded} / ${data.points} Punkte)`;
    } else {
      badgeEl.textContent = `Nicht korrekt ❌ (0 / ${data.points} Punkte)`;
    }
    document.getElementById("result-feedback").textContent = data.feedback || "";
    resultEl.classList.remove("hidden");
    statusEl.textContent = "";

    const resultEntry = {
      problemId: problem.id,
      points: data.points,
      awarded: data.awarded,
      fullyCorrect: Boolean(data.correct),
      bonusStars: 0,
      // Fuer die spaetere Detailansicht im Verlauf ("was hat das Kind geschrieben?").
      problemText: problem.text || "",
      problemLatex: problem.latex || "",
      transcription: data.transcription || "",
      resultLatex: data.latex || "",
      feedback: data.feedback || "",
      image,
    };
    state.results.push(resultEntry);

    // Bonus-Spiel: nur im Uebungsmodus und nur nach einer vollstaendig richtigen Loesung.
    // Alterniert bei jedem Spielstart zwischen Merkspiel und Bubble-Pop.
    const bonusBtn = document.getElementById("btn-play-bonus-game");
    if (state.mode === "uebung" && resultEntry.fullyCorrect) {
      bonusBtn.classList.remove("hidden");
      bonusBtn.disabled = false;
      const gameLabel = nextBonusGame === "memory" ? "🧠 Merkspiel" : "🫧 Bubble-Pop";
      bonusBtn.textContent = `🎮 Bonus-Spiel: ${gameLabel} (+1 ⭐)`;
      bonusBtn.onclick = () => {
        bonusBtn.disabled = true;
        const openGame = nextBonusGame === "memory" ? openMemoryGame : openBubblePopGame;
        nextBonusGame = nextBonusGame === "memory" ? "bubble" : "memory";
        openGame((won) => {
          resultEntry.bonusStars = won ? 1 : 0;
          bonusBtn.textContent = won ? "🎉 Zusatzstern verdient!" : "😕 Kein Zusatzstern diesmal";
        });
      };
    }

    submitBtn.classList.add("hidden");
    nextBtn.classList.remove("hidden");
  } catch (err) {
    statusEl.textContent = `Fehler: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
  }
});

nextBtn.addEventListener("click", () => {
  state.currentIndex += 1;
  if (state.currentIndex < state.queue.length) {
    loadCurrentTask();
  } else {
    finishRun();
  }
});

// ---------- Pruefungsmodus: freie Navigation + eine Gesamt-Abgabe ----------
// Ob die aktuelle Aufgabe ueberhaupt bearbeitet wurde (fuer iOS/PencilKit reicht "hasInk" nicht,
// da dort nicht auf dem HTML-Canvas gezeichnet wird).
async function hasAnsweredCurrentProblem() {
  if (isNativeIOS()) return Boolean(iosDrawingDataUrl);
  return hasInk;
}

// Sichert die aktuell sichtbare Zeichnung in state.answers, bevor zu einer anderen Aufgabe
// geblaettert oder die ganze Pruefung abgegeben wird.
async function captureCurrentAnswerIfExam() {
  if (!isPruefungMode(state.mode)) return;
  const answer = state.answers[state.currentIndex];
  const answered = await hasAnsweredCurrentProblem();
  answer.hasInk = answered;
  answer.image = answered ? await captureDrawing() : null;
}

document.getElementById("exam-prev-btn").addEventListener("click", async () => {
  await captureCurrentAnswerIfExam();
  if (state.currentIndex > 0) {
    state.currentIndex -= 1;
    loadCurrentTask();
  }
});

document.getElementById("exam-next-btn").addEventListener("click", async () => {
  await captureCurrentAnswerIfExam();
  if (state.currentIndex < state.queue.length - 1) {
    state.currentIndex += 1;
    loadCurrentTask();
  }
});

document.getElementById("exam-submit-btn").addEventListener("click", async () => {
  await captureCurrentAnswerIfExam();
  const answeredCount = state.answers.filter((a) => a.hasInk).length;
  const total = state.queue.length;
  const confirmed = confirm(
    `Du hast ${answeredCount} von ${total} Aufgaben bearbeitet. ` +
      "Nach dem Abgeben kannst du nichts mehr aendern. Möchtest du die Prüfung jetzt wirklich abgeben?"
  );
  if (!confirmed) return;
  await gradeAndFinishExam();
});

// Wertet alle Aufgaben der Pruefung nacheinander aus (unbeantwortete Aufgaben ohne API-Aufruf
// direkt als 0 Punkte) und zeigt danach dieselbe Zusammenfassung wie der Uebungsmodus.
async function gradeAndFinishExam() {
  stopExamTimer();
  const overlay = document.getElementById("exam-submit-overlay");
  const statusText = document.getElementById("exam-submit-status");
  overlay.classList.remove("hidden");
  state.results = [];

  for (let i = 0; i < state.queue.length; i++) {
    const problem = state.queue[i];
    const answer = state.answers[i];
    statusText.textContent = `Werte Aufgabe ${i + 1} von ${state.queue.length} aus ...`;

    if (!answer.hasInk || !answer.image) {
      state.results.push({
        problemId: problem.id,
        points: problem.points,
        awarded: 0,
        fullyCorrect: false,
        bonusStars: 0,
        problemText: problem.text || "",
        problemLatex: problem.latex || "",
        transcription: "",
        resultLatex: undefined,
        feedback: "Keine Antwort abgegeben.",
        image: undefined,
      });
      continue;
    }

    const { ok, data } = await api("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problemId: problem.id, image: answer.image, hintsUsed: answer.hintsUsed }),
    });
    if (!ok) {
      state.results.push({
        problemId: problem.id,
        points: problem.points,
        awarded: 0,
        fullyCorrect: false,
        bonusStars: 0,
        problemText: problem.text || "",
        problemLatex: problem.latex || "",
        transcription: "",
        resultLatex: undefined,
        feedback: `Auswertung fehlgeschlagen: ${data.error || "unbekannter Fehler"}.`,
        image: answer.image,
      });
      continue;
    }
    state.results.push({
      problemId: problem.id,
      points: data.points,
      awarded: data.awarded,
      fullyCorrect: Boolean(data.correct),
      bonusStars: 0,
      problemText: problem.text || "",
      problemLatex: problem.latex || "",
      transcription: data.transcription || "",
      resultLatex: data.latex || "",
      feedback: data.feedback || "",
      image: answer.image,
    });
  }

  overlay.classList.add("hidden");
  await finishRun();
}

async function finishRun() {
  stopExamTimer();
  const examMode = isPruefungMode(state.mode);
  const totalPoints = state.results.reduce((sum, r) => sum + r.points, 0);
  const awardedPoints = state.results.reduce((sum, r) => sum + r.awarded, 0);
  const fullyCorrectCount = state.results.filter((r) => r.fullyCorrect).length;
  const percent = totalPoints > 0 ? Math.round((awardedPoints / totalPoints) * 1000) / 10 : 0;
  // Sterne gibt es nur im Uebungsmodus (3 pro vollstaendig richtiger Aufgabe, plus 1 Bonus-Stern
  // je gewonnenem Merkspiel) - im Pruefungsmodus zaehlen stattdessen Prozent/Note, keine Sterne.
  const starsEarned = examMode
    ? 0
    : state.results.reduce((sum, r) => sum + (r.fullyCorrect ? 3 : 0) + (r.bonusStars || 0), 0);

  const { ok: saved } = await api("/api/results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: state.mode,
      scope: String(state.scope),
      details: state.results,
    }),
  });

  document.getElementById("summary-score").textContent =
    `${awardedPoints} von ${totalPoints} Punkten – ` +
    `${fullyCorrectCount} von ${state.results.length} Aufgaben vollständig richtig`;

  const gradeEl = document.getElementById("summary-grade");
  const grade = computeGrade(awardedPoints, totalPoints);
  if (examMode && grade !== null) {
    gradeEl.textContent = `${percent}% – Note: ${grade.toFixed(2)}`;
    gradeEl.classList.remove("hidden");
  } else {
    gradeEl.classList.add("hidden");
  }

  const starsEl = document.getElementById("summary-stars");
  if (examMode) {
    starsEl.classList.add("hidden");
  } else {
    starsEl.textContent = starsEarned > 0 ? "⭐".repeat(starsEarned) : "–";
    starsEl.classList.remove("hidden");
  }
  // Ohne diesen Hinweis wuerde ein fehlgeschlagenes Speichern (z.B. Netzwerkfehler, zu grosses
  // Bild-Payload) unbemerkt bleiben: die Zusammenfassung saehe trotzdem "erfolgreich" aus, obwohl
  // weder Punkte noch Sterne dauerhaft gespeichert wurden.
  document.getElementById("summary-save-error").classList.toggle("hidden", saved);
  showScreen("screen-summary");

  const levelBefore = getLevelInfo(state.starsBeforeRun || 0);
  await refreshStarsTotal();
  const levelAfter = getLevelInfo(currentTotalStars);
  if (levelAfter.level > levelBefore.level) {
    showLevelUpCelebration(levelAfter);
  }
}

document.getElementById("btn-summary-restart").addEventListener("click", goToStart);

// ---------- Verlauf ----------
async function goToHistory() {
  if (!requireLogin(goToHistory)) return;
  if (!confirmLeaveTask()) return;
  setActiveNav("nav-history");
  showScreen("screen-history");
  const listEl = document.getElementById("history-list");
  listEl.textContent = "Lade ...";
  const { ok, data } = await api("/api/results");
  if (!ok || !Array.isArray(data) || data.length === 0) {
    listEl.textContent = "Noch keine Ergebnisse gespeichert.";
    return;
  }
  const modeLabels = { uebung: "Übung", pruefung_jahr: "Prüfung (Jahr)", pruefung_kategorie: "Prüfung (Kategorie)" };
  const rows = data
    .map((r, i) => {
      const isExamRow = isPruefungMode(r.mode);
      const grade = computeGrade(r.awarded_points, r.total_points);
      return `<tr>
        <td>${new Date(r.created_at).toLocaleString("de-CH")}</td>
        <td>${modeLabels[r.mode] || r.mode}</td>
        <td>${r.scope}</td>
        <td>${r.awarded_points} / ${r.total_points} Punkte</td>
        <td>${isExamRow ? `${r.percent}%` : "–"}</td>
        <td>${isExamRow && grade !== null ? grade.toFixed(2) : "–"}</td>
        <td>${isExamRow ? "–" : r.stars > 0 ? "⭐".repeat(r.stars) : "–"}</td>
      </tr>
      <tr class="history-details-row">
        <td colspan="7">
          <details class="history-details">
            <summary>🔍 Aufgaben im Detail ansehen</summary>
            <div id="history-detail-${i}" class="history-problem-list"></div>
          </details>
        </td>
      </tr>`;
    })
    .join("");
  listEl.innerHTML = `<table>
    <thead><tr><th>Datum</th><th>Modus</th><th>Bereich</th><th>Punkte</th><th>Prozent</th><th>Note</th><th>Sterne</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  // Detailkarten erst nach dem Einfuegen ins DOM befuellen, da renderMath/renderProblemStatement
  // pro Element aufgerufen werden (nicht ueber einen HTML-String moeglich).
  data.forEach((r, i) => {
    const container = document.getElementById(`history-detail-${i}`);
    if (!Array.isArray(r.details) || r.details.length === 0) {
      container.textContent = "Fuer dieses Ergebnis sind keine Aufgaben-Details gespeichert.";
      return;
    }
    r.details.forEach((d) => container.appendChild(renderHistoryProblemCard(d)));
  });
}

// Baut die Detailkarte einer einzelnen Aufgabe: Aufgabentext, handschriftliche Loesung (Bild),
// erkannte Antwort und Feedback - damit man spaeter nachvollziehen kann, was das Kind
// geschrieben hat und wo es haperte. Aeltere, vor dieser Funktion gespeicherte Ergebnisse haben
// diese Felder nicht - die jeweiligen Abschnitte werden dann einfach ausgelassen.
function renderHistoryProblemCard(d) {
  const card = document.createElement("div");
  card.className = "history-problem";

  if (d.problemText || d.problemLatex) {
    const statement = document.createElement("p");
    statement.className = "history-problem-statement";
    renderProblemStatement(statement, d.problemLatex, d.problemText);
    card.appendChild(statement);
  }

  if (d.image) {
    const img = document.createElement("img");
    img.src = d.image;
    img.alt = "Handschriftliche Lösung";
    img.className = "history-problem-image";
    card.appendChild(img);
  }

  if (d.transcription || d.resultLatex) {
    const answer = document.createElement("p");
    const label = document.createElement("strong");
    label.textContent = "Erkannte Antwort: ";
    answer.appendChild(label);
    const answerSpan = document.createElement("span");
    renderMath(answerSpan, d.resultLatex, d.transcription);
    answer.appendChild(answerSpan);
    card.appendChild(answer);
  }

  const pointsLine = document.createElement("p");
  const pointsLabel = document.createElement("strong");
  pointsLabel.textContent = "Punkte: ";
  const icon = d.fullyCorrect ? "✅" : d.awarded > 0 ? "🌗" : "❌";
  pointsLine.appendChild(pointsLabel);
  pointsLine.appendChild(document.createTextNode(`${d.awarded} / ${d.points} ${icon}`));
  card.appendChild(pointsLine);

  if (d.feedback) {
    const feedback = document.createElement("p");
    const feedbackLabel = document.createElement("strong");
    feedbackLabel.textContent = "Feedback: ";
    feedback.appendChild(feedbackLabel);
    feedback.appendChild(document.createTextNode(d.feedback));
    card.appendChild(feedback);
  }

  return card;
}

document.getElementById("nav-history").addEventListener("click", goToHistory);
document.getElementById("card-history").addEventListener("click", goToHistory);

// ---------- Login / Logout ----------
let pendingAfterLogin = null;

function showLoginScreen() {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("app-layout").classList.add("hidden");
  document.getElementById("login-username").focus();
}

function showApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-layout").classList.remove("hidden");
  const isLoggedIn = Boolean(state.token && state.username);
  document.getElementById("hero-title").textContent = isLoggedIn ? "Willkommen zurück!" : "Willkommen bei MathQuiz!";
  document.getElementById("hero-sub").textContent = isLoggedIn
    ? "Wähle einen Modus, um loszulegen."
    : "Melde dich an, um zu üben und deine Ergebnisse anzusehen.";
  document.getElementById("logged-in-as").textContent = isLoggedIn ? `Angemeldet als: ${state.username}` : "";
  document.getElementById("logged-in-as").classList.toggle("hidden", !isLoggedIn);
  document.getElementById("btn-login-open").classList.toggle("hidden", isLoggedIn);
  document.getElementById("btn-logout").classList.toggle("hidden", !isLoggedIn);
  document.getElementById("nav-admin").classList.toggle("hidden", !state.isAdmin);
}

function requireLogin(afterLogin) {
  if (window.AUTH_BYPASS) return true; // TEMPORAER: siehe AUTH_BYPASS in server.js (Payrexx-Pruefung)
  if (state.token && state.username) return true;
  pendingAfterLogin = afterLogin;
  showLoginScreen();
  return false;
}

function logout() {
  state.token = "";
  state.username = "";
  state.isAdmin = false;
  localStorage.removeItem("matheapp_token");
  localStorage.removeItem("matheapp_username");
  localStorage.removeItem("matheapp_isAdmin");
  pendingAfterLogin = null;
  showApp();
  setActiveNav("nav-start");
  showScreen("screen-start");
}

document.getElementById("btn-logout").addEventListener("click", logout);
document.getElementById("btn-login-open").addEventListener("click", () => showLoginScreen());
document.getElementById("btn-login-cancel").addEventListener("click", () => {
  pendingAfterLogin = null;
  showApp();
  setActiveNav("nav-start");
  showScreen("screen-start");
});

document.getElementById("btn-login").addEventListener("click", async () => {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.classList.add("hidden");
  if (!username || !password) {
    errorEl.textContent = "Bitte Benutzername und Passwort eingeben.";
    errorEl.classList.remove("hidden");
    return;
  }
  const { ok, data } = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!ok) {
    errorEl.textContent = data.error || "Anmeldung fehlgeschlagen.";
    errorEl.classList.remove("hidden");
    return;
  }
  state.token = data.token;
  state.username = data.username;
  state.isAdmin = Boolean(data.isAdmin);
  localStorage.setItem("matheapp_token", state.token);
  localStorage.setItem("matheapp_username", state.username);
  localStorage.setItem("matheapp_isAdmin", String(state.isAdmin));
  document.getElementById("login-password").value = "";
  await initAppAfterLogin();
  const afterLogin = pendingAfterLogin;
  pendingAfterLogin = null;
  if (afterLogin) await afterLogin();
});

// Enter-Taste im Passwortfeld loest den Login aus (bessere UX als nur Klick auf den Button).
document.getElementById("login-password").addEventListener("keydown", (evt) => {
  if (evt.key === "Enter") document.getElementById("btn-login").click();
});

async function initAppAfterLogin() {
  showApp();
  await loadMeta();
  await refreshStarsTotal();
}

// Beim Laden pruefen, ob ein gespeichertes Token noch gueltig ist (Server-Neustart, geaendertes
// SESSION_SECRET oder Ablauf wuerden es ungueltig machen) - sonst direkt zum Login-Bildschirm.
async function checkExistingSession() {
  if (!state.token) {
    showApp();
    setActiveNav("nav-start");
    showScreen("screen-start");
    return;
  }
  const { ok, data } = await api("/api/auth/me");
  if (!ok) {
    logout();
    return;
  }
  state.username = data.username;
  state.isAdmin = Boolean(data.isAdmin);
  localStorage.setItem("matheapp_username", state.username);
  localStorage.setItem("matheapp_isAdmin", String(state.isAdmin));
  await initAppAfterLogin();
}

// ---------- Admin: Benutzerverwaltung (nur sichtbar/erreichbar fuer "Stefan") ----------
function renderAdminUserRow(u) {
  const row = document.createElement("div");
  row.className = "admin-user-row";

  const nameEl = document.createElement("span");
  nameEl.className = "admin-username";
  nameEl.textContent = u.username;
  row.appendChild(nameEl);

  if (u.is_admin) {
    const badge = document.createElement("span");
    badge.className = "admin-badge";
    badge.textContent = "Admin";
    row.appendChild(badge);
  }

  const pwInput = document.createElement("input");
  pwInput.type = "password";
  pwInput.placeholder = "Neues Passwort";
  pwInput.maxLength = 200;
  row.appendChild(pwInput);

  const pwBtn = document.createElement("button");
  pwBtn.className = "btn-secondary";
  pwBtn.textContent = "Passwort ändern";
  pwBtn.addEventListener("click", async () => {
    const password = pwInput.value;
    if (password.length < 6) {
      alert("Passwort muss mindestens 6 Zeichen lang sein.");
      return;
    }
    const { ok, data } = await api(`/api/admin/users/${encodeURIComponent(u.username)}/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!ok) {
      alert(data.error || "Passwort konnte nicht geändert werden.");
      return;
    }
    pwInput.value = "";
    alert(`Passwort für ${u.username} wurde geändert.`);
  });
  row.appendChild(pwBtn);

  // Der fest verdrahtete Admin-Account "Stefan" kann nicht geloescht werden (siehe server.js).
  if (u.username !== "Stefan") {
    const delBtn = document.createElement("button");
    delBtn.className = "btn-secondary";
    delBtn.textContent = "Löschen";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Benutzer "${u.username}" wirklich löschen?`)) return;
      const { ok, data } = await api(`/api/admin/users/${encodeURIComponent(u.username)}`, { method: "DELETE" });
      if (!ok) {
        alert(data.error || "Benutzer konnte nicht gelöscht werden.");
        return;
      }
      renderAdminUsers();
    });
    row.appendChild(delBtn);
  }

  return row;
}

async function renderAdminUsers() {
  const listEl = document.getElementById("admin-users-list");
  listEl.textContent = "Lade ...";
  const { ok, data } = await api("/api/admin/users");
  if (!ok || !Array.isArray(data)) {
    listEl.textContent = "Benutzerliste konnte nicht geladen werden.";
    return;
  }
  listEl.innerHTML = "";
  data.forEach((u) => listEl.appendChild(renderAdminUserRow(u)));
}

async function goToAdmin() {
  if (!requireLogin(goToAdmin)) return;
  if (!state.isAdmin) return;
  if (!confirmLeaveTask()) return;
  setActiveNav("nav-admin");
  showScreen("screen-admin");
  await renderAdminUsers();
}

document.getElementById("nav-admin").addEventListener("click", goToAdmin);

document.getElementById("btn-admin-create-user").addEventListener("click", async () => {
  const usernameInput = document.getElementById("admin-new-username");
  const passwordInput = document.getElementById("admin-new-password");
  const errorEl = document.getElementById("admin-error");
  errorEl.classList.add("hidden");
  const { ok, data } = await api("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: usernameInput.value.trim(), password: passwordInput.value }),
  });
  if (!ok) {
    errorEl.textContent = data.error || "Benutzer konnte nicht angelegt werden.";
    errorEl.classList.remove("hidden");
    return;
  }
  usernameInput.value = "";
  passwordInput.value = "";
  await renderAdminUsers();
});

// ---------- Initialisierung ----------
checkExistingSession();


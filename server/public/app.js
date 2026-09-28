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
}

document.getElementById("tool-pen").addEventListener("click", () => setTool("pen"));
document.getElementById("tool-eraser").addEventListener("click", () => setTool("eraser"));

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
  } else {
    currentStrokePoints = [[pos.x, pos.y]];
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
  } else {
    currentStrokePoints.push([pos.x, pos.y]);
    renderLiveStroke();
  }
}

function stopDraw() {
  if (!drawing) return;
  drawing = false;
  if (currentTool === "pen") {
    commitLiveStroke();
  } else {
    scheduleLivePreview();
  }
}

liveCanvas.addEventListener("pointerdown", startDraw);
liveCanvas.addEventListener("pointermove", draw);
window.addEventListener("pointerup", stopDraw);

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
  currentStrokePoints = [];
  hasInk = false;
  hideLivePreview();
}

document.getElementById("clear-btn").addEventListener("click", clearCanvas);

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
  const res = await fetch(`${API_BASE_URL}${url}`, options);
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
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
        el.appendChild(document.createTextNode(part));
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
  playerName: localStorage.getItem("matheapp_playerName") || "",
  meta: { years: [], categories: [] },
  mode: null, // 'uebung' | 'pruefung_jahr' | 'pruefung_kategorie'
  scope: null, // problemId (uebung) oder Jahr/Kategorie (pruefung)
  queue: [],
  currentIndex: 0,
  results: [], // { problemId, points, awarded, fullyCorrect }
  nextHintIndex: 0,
  hintsUsedForCurrent: false,
  starsBeforeRun: 0,
};

const playerNameInput = document.getElementById("player-name");
playerNameInput.value = state.playerName;

function requirePlayerName() {
  const name = playerNameInput.value.trim();
  if (!name) {
    alert("Bitte zuerst deinen Namen eingeben.");
    playerNameInput.focus();
    return null;
  }
  state.playerName = name;
  localStorage.setItem("matheapp_playerName", name);
  return name;
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
  if (!state.playerName) {
    starsEl.classList.add("hidden");
    document.getElementById("level-info").classList.add("hidden");
    return;
  }
  const { ok, data } = await api(`/api/results?playerName=${encodeURIComponent(state.playerName)}`);
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
    .map((p) => `<option value="${p.id}">[${p.year} · ${p.category} · ${p.points} P.] ${truncate(p.text, 55)}</option>`)
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
  if (!requirePlayerName()) return;
  if (!confirmLeaveTask()) return;
  setActiveNav("nav-uebung");
  showScreen("screen-uebung-setup");
  await loadUebungProblems();
}

document.getElementById("nav-start").addEventListener("click", goToStart);
document.getElementById("nav-uebung").addEventListener("click", goToUebung);

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
  if (!requirePlayerName()) return;
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
  state.starsBeforeRun = currentTotalStars;
  showScreen("screen-task");
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
  clearCanvas();
  setTool("pen");
  resetIosDrawing();
  resultEl.classList.add("hidden");
  statusEl.textContent = "";
  submitBtn.classList.remove("hidden");
  nextBtn.classList.add("hidden");

  state.nextHintIndex = 0;
  state.hintsUsedForCurrent = false;
  const hintBtn = document.getElementById("hint-btn");
  hintBtn.disabled = false;
  hintBtn.textContent = "💡 Hinweis";
  const hintBox = document.getElementById("hint-box");
  hintBox.textContent = "";
  hintBox.classList.add("hidden");

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
      badgeEl.innerHTML = `Richtig ✅ (${data.awarded} / ${data.points} Punkte) <span class="star-earned">⭐</span>`;
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

async function finishRun() {
  const totalPoints = state.results.reduce((sum, r) => sum + r.points, 0);
  const awardedPoints = state.results.reduce((sum, r) => sum + r.awarded, 0);
  const fullyCorrectCount = state.results.filter((r) => r.fullyCorrect).length;
  const percent = totalPoints > 0 ? Math.round((awardedPoints / totalPoints) * 1000) / 10 : 0;
  // 3 Sterne pro vollstaendig richtiger Aufgabe, plus 1 Bonus-Stern je gewonnenem Merkspiel.
  const starsEarned = state.results.reduce((sum, r) => sum + (r.fullyCorrect ? 3 : 0) + (r.bonusStars || 0), 0);

  await api("/api/results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerName: state.playerName,
      mode: state.mode,
      scope: String(state.scope),
      details: state.results,
    }),
  });

  document.getElementById("summary-score").textContent =
    `${awardedPoints} von ${totalPoints} Punkten (${percent}%) – ` +
    `${fullyCorrectCount} von ${state.results.length} Aufgaben vollständig richtig`;
  document.getElementById("summary-stars").textContent = starsEarned > 0 ? "⭐".repeat(starsEarned) : "–";
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
  if (!requirePlayerName()) return;
  if (!confirmLeaveTask()) return;
  setActiveNav("nav-history");
  showScreen("screen-history");
  const listEl = document.getElementById("history-list");
  listEl.textContent = "Lade ...";
  const { ok, data } = await api(`/api/results?playerName=${encodeURIComponent(state.playerName)}`);
  if (!ok || !Array.isArray(data) || data.length === 0) {
    listEl.textContent = "Noch keine Ergebnisse gespeichert.";
    return;
  }
  const modeLabels = { uebung: "Übung", pruefung_jahr: "Prüfung (Jahr)", pruefung_kategorie: "Prüfung (Kategorie)" };
  const rows = data
    .map(
      (r) => `<tr>
        <td>${new Date(r.created_at).toLocaleString("de-CH")}</td>
        <td>${modeLabels[r.mode] || r.mode}</td>
        <td>${r.scope}</td>
        <td>${r.awarded_points} / ${r.total_points} Punkte</td>
        <td>${r.percent}%</td>
        <td>${"⭐".repeat(r.stars)}</td>
      </tr>`
    )
    .join("");
  listEl.innerHTML = `<table>
    <thead><tr><th>Datum</th><th>Modus</th><th>Bereich</th><th>Punkte</th><th>Prozent</th><th>Sterne</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

document.getElementById("nav-history").addEventListener("click", goToHistory);

// ---------- Initialisierung ----------
loadMeta();
refreshStarsTotal();


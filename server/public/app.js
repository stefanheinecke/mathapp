// ---------- Canvas (kariertes Notizfeld) ----------
const canvas = document.getElementById("notebook");
const ctx = canvas.getContext("2d");
ctx.lineWidth = 2.5;
ctx.lineCap = "round";
ctx.strokeStyle = "#1a3a8f";

let drawing = false;
let lastX = 0;
let lastY = 0;

function getPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
}

function startDraw(evt) {
  drawing = true;
  const pos = getPos(evt);
  lastX = pos.x;
  lastY = pos.y;
}

function draw(evt) {
  if (!drawing) return;
  const pos = getPos(evt);
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  lastX = pos.x;
  lastY = pos.y;
}

function stopDraw() {
  drawing = false;
}

canvas.addEventListener("pointerdown", startDraw);
canvas.addEventListener("pointermove", draw);
window.addEventListener("pointerup", stopDraw);

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

document.getElementById("clear-btn").addEventListener("click", clearCanvas);

// ---------- Kleine API-Hilfsfunktion ----------
async function api(url, options) {
  const res = await fetch(url, options);
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data };
}

// ---------- Screens ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// ---------- App-Zustand ----------
const state = {
  playerName: localStorage.getItem("matheapp_playerName") || "",
  meta: { years: [], categories: [] },
  mode: null, // 'uebung' | 'pruefung_jahr' | 'pruefung_kategorie'
  scope: null, // problemId (uebung) oder Jahr/Kategorie (pruefung)
  queue: [],
  currentIndex: 0,
  results: [], // { problemId, correct }
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

async function refreshStarsTotal() {
  const starsEl = document.getElementById("stars-total");
  if (!state.playerName) {
    starsEl.classList.add("hidden");
    return;
  }
  const { ok, data } = await api(`/api/results?playerName=${encodeURIComponent(state.playerName)}`);
  if (!ok || !Array.isArray(data)) {
    starsEl.classList.add("hidden");
    return;
  }
  const total = data.reduce((sum, r) => sum + (r.stars || 0), 0);
  starsEl.textContent = `⭐ Gesammelte Sterne: ${total}`;
  starsEl.classList.remove("hidden");
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
    .map((p) => `<option value="${p.id}">[${p.year} · ${p.category}] ${p.text}</option>`)
    .join("");
  state.uebungProblems = data;
}

document.getElementById("btn-mode-uebung").addEventListener("click", async () => {
  if (!requirePlayerName()) return;
  showScreen("screen-uebung-setup");
  await loadUebungProblems();
});

document.getElementById("uebung-year").addEventListener("change", loadUebungProblems);
document.getElementById("uebung-category").addEventListener("change", loadUebungProblems);
document.getElementById("btn-uebung-back").addEventListener("click", () => showScreen("screen-start"));

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

document.getElementById("btn-mode-pruefung").addEventListener("click", () => {
  if (!requirePlayerName()) return;
  pruefungVariant = null;
  document.getElementById("btn-pruefung-jahr").classList.remove("active");
  document.getElementById("btn-pruefung-kategorie").classList.remove("active");
  document.getElementById("pruefung-jahr-picker").classList.add("hidden");
  document.getElementById("pruefung-kategorie-picker").classList.add("hidden");
  document.getElementById("btn-pruefung-start").classList.add("hidden");
  showScreen("screen-pruefung-setup");
});

document.getElementById("btn-pruefung-jahr").addEventListener("click", () => selectPruefungVariant("jahr"));
document.getElementById("btn-pruefung-kategorie").addEventListener("click", () => selectPruefungVariant("kategorie"));
document.getElementById("btn-pruefung-back").addEventListener("click", () => showScreen("screen-start"));

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
  showScreen("screen-task");
  loadCurrentTask();
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
  document.getElementById("problem-text").textContent = problem.text;
  clearCanvas();
  resultEl.classList.add("hidden");
  statusEl.textContent = "";
  submitBtn.classList.remove("hidden");
  nextBtn.classList.add("hidden");
}

submitBtn.addEventListener("click", async () => {
  const problem = state.queue[state.currentIndex];
  resultEl.classList.add("hidden");
  statusEl.textContent = "Werte Lösung aus ...";
  submitBtn.disabled = true;

  const image = canvas.toDataURL("image/png");

  try {
    const { ok, data } = await api("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problemId: problem.id, image }),
    });
    if (!ok) {
      statusEl.textContent = `Fehler: ${data.error || "unbekannt"}`;
      return;
    }
    document.getElementById("result-transcription").textContent = data.transcription || "(nichts erkannt)";
    document.getElementById("result-latex").textContent = data.latex || "(nichts erkannt)";
    document.getElementById("result-correct").innerHTML = data.correct
      ? 'Richtig ✅ <span class="star-earned">⭐</span>'
      : "Nicht korrekt ❌";
    document.getElementById("result-feedback").textContent = data.feedback || "";
    resultEl.classList.remove("hidden");
    statusEl.textContent = "";

    state.results.push({ problemId: problem.id, correct: Boolean(data.correct) });
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
  const total = state.results.length;
  const correct = state.results.filter((r) => r.correct).length;
  const percent = total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;

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

  document.getElementById("summary-score").textContent = `${correct} von ${total} richtig (${percent}%)`;
  document.getElementById("summary-stars").textContent = "⭐".repeat(correct) || "–";
  showScreen("screen-summary");
}

document.getElementById("btn-summary-restart").addEventListener("click", async () => {
  showScreen("screen-start");
  await refreshStarsTotal();
});

// ---------- Verlauf ----------
document.getElementById("btn-mode-history").addEventListener("click", async () => {
  if (!requirePlayerName()) return;
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
        <td>${r.correct} / ${r.total}</td>
        <td>${r.percent}%</td>
        <td>${"⭐".repeat(r.stars)}</td>
      </tr>`
    )
    .join("");
  listEl.innerHTML = `<table>
    <thead><tr><th>Datum</th><th>Modus</th><th>Bereich</th><th>Ergebnis</th><th>Prozent</th><th>Sterne</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
});

document.getElementById("btn-history-back").addEventListener("click", () => showScreen("screen-start"));

// ---------- Initialisierung ----------
loadMeta();
refreshStarsTotal();


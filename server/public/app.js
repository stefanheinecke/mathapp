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

document.getElementById("clear-btn").addEventListener("click", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

const problemSelect = document.getElementById("problem");
const problemTextEl = document.getElementById("problem-text");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

let problems = [];

async function loadProblems() {
  const res = await fetch("/api/problems");
  problems = await res.json();
  problemSelect.innerHTML = problems.map((p) => `<option value="${p.id}">${p.id}</option>`).join("");
  updateProblemText();
}

function updateProblemText() {
  const problem = problems.find((p) => p.id === problemSelect.value);
  problemTextEl.textContent = problem ? problem.text : "";
}

problemSelect.addEventListener("change", updateProblemText);

document.getElementById("submit-btn").addEventListener("click", async () => {
  const problemId = problemSelect.value;
  if (!problemId) return;

  resultEl.classList.add("hidden");
  statusEl.textContent = "Werte Loesung aus ...";

  const image = canvas.toDataURL("image/png");

  try {
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problemId, image }),
    });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = `Fehler: ${data.error || "unbekannt"}`;
      return;
    }
    document.getElementById("result-transcription").textContent = data.transcription || "(nichts erkannt)";
    document.getElementById("result-latex").textContent = data.latex || "(nichts erkannt)";
    document.getElementById("result-correct").textContent = data.correct ? "Richtig ✅" : "Nicht korrekt ❌";
    document.getElementById("result-feedback").textContent = data.feedback || "";
    resultEl.classList.remove("hidden");
    statusEl.textContent = "";
  } catch (err) {
    statusEl.textContent = `Fehler: ${err.message}`;
  }
});

loadProblems();

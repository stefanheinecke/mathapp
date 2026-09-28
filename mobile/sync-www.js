// Kopiert die Web-App (server/public) nach mobile/www und traegt die Backend-URL ein.
// Ausfuehren mit: node sync-www.js
// Danach (auf dem Mac): npx cap sync ios
//
// WICHTIG: Die iOS-App laedt die Seite lokal aus der App (nicht vom Express-Server), daher
// braucht sie eine volle, oeffentlich erreichbare Backend-URL (z.B. deine Railway-Domain).
// Passe BACKEND_URL unten an oder setze die Umgebungsvariable MATHEAPP_BACKEND_URL.
const BACKEND_URL = process.env.MATHEAPP_BACKEND_URL || "https://DEINE-BACKEND-DOMAIN.example";

const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "server", "public");
const DEST_DIR = path.join(__dirname, "www");

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (!fs.existsSync(SRC_DIR)) {
  console.error(`Quelle nicht gefunden: ${SRC_DIR}`);
  process.exit(1);
}

fs.rmSync(DEST_DIR, { recursive: true, force: true });
copyRecursive(SRC_DIR, DEST_DIR);

// window.MATHEAPP_API_BASE_URL vor app.js injizieren, damit api() in app.js absolute statt
// relative URLs benutzt (die WebView der iOS-App hat keine eigene Backend-Origin).
const indexPath = path.join(DEST_DIR, "index.html");
let html = fs.readFileSync(indexPath, "utf8");
const configScript = `  <script>window.MATHEAPP_API_BASE_URL = ${JSON.stringify(BACKEND_URL)};</script>\n`;
html = html.replace('<script src="app.js"></script>', `${configScript}  <script src="app.js"></script>`);
fs.writeFileSync(indexPath, html);

console.log(`Synced ${SRC_DIR} -> ${DEST_DIR}`);
console.log(`Backend-URL fuer die App: ${BACKEND_URL}`);
if (BACKEND_URL.includes("DEINE-BACKEND-DOMAIN")) {
  console.warn("WARNUNG: Bitte MATHEAPP_BACKEND_URL setzen oder BACKEND_URL in sync-www.js anpassen!");
}

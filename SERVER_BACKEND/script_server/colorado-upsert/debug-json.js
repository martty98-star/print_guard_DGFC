const fs = require("fs");

const file = String.raw`C:\Users\MartinKrbec\OneDrive - Desenio AB\PrintGuard - Dokumenty\ColoradoAccounting\Colorado-91\normalized\99040262520260122.json`;

const raw = fs.readFileSync(file, "utf8");

console.log("LENGTH:", raw.length);
console.log("FIRST 50 CHARS:", JSON.stringify(raw.slice(0, 50)));
console.log("FIRST 20 CHAR CODES:", raw.slice(0, 20).split("").map(c => c.charCodeAt(0)));

try {
  const parsed = JSON.parse(raw);
  console.log("JSON.parse OK, array:", Array.isArray(parsed), "items:", parsed.length);
} catch (e) {
  console.error("JSON.parse ERROR:", e.message);
}
// Rebuilds bmf-logo.js: reads the logo shapes from logo-static.svg (the vector export of the PDF)
// and embeds them in bmf-logo.template.js. Only needed if the logo artwork or the template changes.
//   node build.mjs
import fs from "fs";

const src = fs.readFileSync("logo-static.svg", "utf8");
const [, , W, H] = src.match(/viewBox="([\d.\- ]+)"/)[1].split(" ").map(Number);
const n = v => +v.toFixed(2);
const path = pts => "M" + pts.map(q => `${n(q[0])} ${n(q[1])}`).join("L") + "Z";

const letters = [], blooms = [];
for (const m of src.matchAll(/<path transform="matrix\(([^)]*)\)" d="([^"]*)"/g)) {
  // Flatten each path into absolute polygons (the artwork only uses straight lines).
  const [a, b, c, d, e, f] = m[1].split(",").map(Number);
  const tok = m[2].match(/[MLHVZ]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const subs = [];
  let cur = null, cmd = null, x = 0, y = 0, i = 0;
  const push = () => cur.push([a * x + c * y + e, b * x + d * y + f]);
  while (i < tok.length) {
    if (/[MLHVZ]/.test(tok[i])) cmd = tok[i++];
    if (cmd === "Z") { cur = null; continue; }
    if (cmd === "M") { x = +tok[i++]; y = +tok[i++]; cur = []; subs.push(cur); push(); cmd = "L"; }
    else if (cmd === "L") { x = +tok[i++]; y = +tok[i++]; push(); }
    else if (cmd === "H") { x = +tok[i++]; push(); }
    else if (cmd === "V") { y = +tok[i++]; push(); }
  }
  const xs = subs.flat().map(p => p[0]), ys = subs.flat().map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x1 - x0 < 0.5 && Math.max(...ys) - Math.min(...ys) < 0.5) continue; // stray zero-size points in the file
  const whole = subs.map(path).join("");
  if (x0 < 5 || x1 > W - 5) { blooms.push({ d: whole }); continue; } // the two arrowheads

  letters.push({
    cx: n((x0 + x1) / 2),
    d: whole,
    // Each outline starts at its lowest point; "top" is how far round the outline its highest point is.
    subs: subs.map(pts => {
      let base = 0;
      pts.forEach((q, j) => { if (q[1] > pts[base][1]) base = j; });
      const p = pts.slice(base).concat(pts.slice(0, base));
      let total = 0, topAt = 0, topY = Infinity;
      p.forEach((q, j) => {
        if (q[1] < topY) { topY = q[1]; topAt = total; }
        const nx = p[(j + 1) % p.length];
        total += Math.hypot(nx[0] - q[0], nx[1] - q[1]);
      });
      return { d: path(p), top: +(topAt / total).toFixed(3) };
    }),
  });
}

const out = fs.readFileSync("bmf-logo.template.js", "utf8")
  .replace("/*DATA*/null", JSON.stringify({ w: W, h: H, letters, blooms }));
fs.writeFileSync("bmf-logo.js", out);
console.log(`bmf-logo.js: ${letters.length} letters, ${blooms.length} arrowheads, ${(out.length / 1024).toFixed(1)} KB`);

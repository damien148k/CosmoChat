// Ciel étoilé animé : trois couches d'étoiles, scintillement,
// étoiles filantes et une lueur ("balise") de la couleur de l'astre écouté.

let beacon = { color: "#7fd8ff", target: "#7fd8ff" };

export function setBeacon(color) { beacon.target = color; }

export function startSky(canvas) {
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w, h, stars = [], shooting = null;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round((w * h) / 2600);
    stars = Array.from({ length: count }, () => {
      const layer = Math.random() < 0.7 ? 0 : Math.random() < 0.8 ? 1 : 2;
      return {
        x: Math.random() * w, y: Math.random() * h, layer,
        r: [0.5, 0.9, 1.5][layer] * (0.6 + Math.random() * 0.6),
        tw: Math.random() * Math.PI * 2, sp: 0.5 + Math.random() * 2,
        hue: Math.random() < 0.15 ? (Math.random() < 0.5 ? 30 : 210) : 0,
      };
    });
  }
  resize();
  addEventListener("resize", resize);

  let t0 = performance.now();
  function draw(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, w, h);
    beacon.color = beacon.target;

    // Lueur de l'astre écouté
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.8);
    const g = ctx.createRadialGradient(w * 0.62, h * 0.32, 0, w * 0.62, h * 0.32, Math.max(w, h) * 0.55);
    g.addColorStop(0, hexA(beacon.color, 0.10 + pulse * 0.05));
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    for (const s of stars) {
      const drift = reduced ? 0 : t * [1.5, 4, 9][s.layer];
      const x = (s.x + drift) % w;
      const a = 0.35 + 0.65 * Math.abs(Math.sin(s.tw + t * s.sp * 0.6));
      ctx.globalAlpha = a * [0.55, 0.8, 1][s.layer];
      ctx.fillStyle = s.hue ? `hsl(${s.hue} 80% 80%)` : "#fff";
      ctx.beginPath();
      ctx.arc(x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (!reduced) {
      if (!shooting && Math.random() < 0.003) {
        shooting = { x: Math.random() * w, y: Math.random() * h * 0.5, vx: -(300 + Math.random() * 300), vy: 120 + Math.random() * 120, life: 1 };
      }
      if (shooting) {
        const s = shooting;
        s.x += s.vx / 60; s.y += s.vy / 60; s.life -= 0.02;
        const grd = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 0.25, s.y - s.vy * 0.25);
        grd.addColorStop(0, `rgba(255,255,255,${s.life})`);
        grd.addColorStop(1, "transparent");
        ctx.strokeStyle = grd; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.25, s.y - s.vy * 0.25); ctx.stroke();
        if (s.life <= 0) shooting = null;
      }
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

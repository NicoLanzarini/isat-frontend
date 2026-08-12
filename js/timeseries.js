"use strict";

// Panel de series temporales de deformación. Mientras el backend SISAR no esté
// conectado genera una serie sintética reproducible por estudio (misma semilla
// → misma serie), con cadencia Sentinel-1 (12 días).

// Colores del gráfico (paleta validada con el validador CVD; Theil-Sen además
// va en línea discontinua como codificación secundaria).
const TS_COLORS = {
  puntos: "#1f7a4d",
  lineal: "#2a78d6",
  theilsen: "#eb6834",
  grid: "#e1e0d9",
  baseline: "#c3c2b7",
  tickInk: "#898781",
  labelInk: "#52514e",
};

const tsPanel = document.getElementById("ts-panel");
const tsCanvas = document.getElementById("ts-canvas");
const tsTooltip = document.getElementById("ts-tooltip");
const tsLegend = document.getElementById("ts-legend");

const tsControls = {
  linear: document.getElementById("ts-linear"),
  theilsen: document.getElementById("ts-theilsen"),
  hist: document.getElementById("ts-hist"),
  scale: document.getElementById("ts-scale"),
  wrap: document.getElementById("ts-wrap"),
  ymin: document.getElementById("ts-ymin"),
  ymax: document.getElementById("ts-ymax"),
  tmin: document.getElementById("ts-tmin"),
  tmax: document.getElementById("ts-tmax"),
};

let tsSeries = null; // { t: [años decimales], y: [cm], dates: [Date] }
let tsScreenPoints = []; // posiciones en px del último render, para el hover
let tsMeta = null; // { lat, lng } del estudio abierto, para el subtítulo

// --- Serie sintética ---------------------------------------------------------

function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticSeries(nombre) {
  const rand = mulberry32(hashString(nombre));
  const velocidad = (rand() - 0.5) * 6; // cm/año, en [-3, 3]
  const amplitud = 0.2 + rand() * 0.6; // estacionalidad [cm]
  const fase = rand() * Math.PI * 2;
  const ruido = 0.15 + rand() * 0.25;

  const t = [];
  const y = [];
  const dates = [];
  const start = Date.UTC(2019, 0, 1);
  const end = Date.UTC(2026, 6, 1);
  const paso = 12 * 24 * 3600 * 1000; // 12 días
  for (let ms = start; ms <= end; ms += paso) {
    const años = (ms - start) / (365.25 * 24 * 3600 * 1000);
    // Ruido gaussiano aproximado (suma de uniformes).
    const gauss = (rand() + rand() + rand() + rand() - 2) / 2;
    t.push(años);
    y.push(velocidad * años + amplitud * Math.sin(2 * Math.PI * años + fase) + gauss * ruido);
    dates.push(new Date(ms));
  }
  return { t, y, dates };
}

// --- Regresiones -------------------------------------------------------------

function linearRegression(t, y) {
  const n = t.length;
  let sumT = 0;
  let sumY = 0;
  let sumTT = 0;
  let sumTY = 0;
  for (let i = 0; i < n; i++) {
    sumT += t[i];
    sumY += y[i];
    sumTT += t[i] * t[i];
    sumTY += t[i] * y[i];
  }
  const slope = (n * sumTY - sumT * sumY) / (n * sumTT - sumT * sumT);
  const intercept = (sumY - slope * sumT) / n;
  return { slope, intercept };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function theilSenRegression(t, y) {
  // Con series largas, muestrea pares para acotar el costo (O(n²) completo).
  const n = t.length;
  const slopes = [];
  const step = n > 300 ? Math.ceil(n / 300) : 1;
  for (let i = 0; i < n; i += step) {
    for (let j = i + step; j < n; j += step) {
      if (t[j] !== t[i]) slopes.push((y[j] - y[i]) / (t[j] - t[i]));
    }
  }
  const slope = median(slopes);
  const residuals = t.map((ti, i) => y[i] - slope * ti);
  return { slope, intercept: median(residuals) };
}

// --- Rango de tiempo ----------------------------------------------------------

// Índices de la serie cuya fecha cae dentro del rango elegido en los inputs
// "Desde/Hasta". Un input vacío no limita ese extremo.
function visibleIndices() {
  const from = tsControls.tmin.value ? Date.parse(tsControls.tmin.value + "T00:00:00Z") : -Infinity;
  const to = tsControls.tmax.value ? Date.parse(tsControls.tmax.value + "T23:59:59Z") : Infinity;
  const indices = [];
  for (let i = 0; i < tsSeries.dates.length; i++) {
    const ms = tsSeries.dates[i].getTime();
    if (ms >= from && ms <= to) indices.push(i);
  }
  return indices;
}

// --- Transformaciones de la serie (escala y envoltura) -----------------------

function transformedY() {
  const scale = Number(tsControls.scale.value);
  const wrap = Number(tsControls.wrap.value);
  return tsSeries.y.map((value) => {
    let v = value * scale;
    if (wrap > 0) {
      const range = 2 * wrap;
      v = ((((v + wrap) % range) + range) % range) - wrap;
    }
    return v;
  });
}

// --- Render ------------------------------------------------------------------

function niceTicks(min, max, count) {
  const span = max - min;
  const rawStep = span / Math.max(count, 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  let step = magnitude;
  for (const mult of [1, 2, 5, 10]) {
    if (rawStep <= mult * magnitude) {
      step = mult * magnitude;
      break;
    }
  }
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 1e6; v += step) {
    ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
  }
  return ticks;
}

// Ticks del eje de tiempo: años cuando el rango visible es amplio, meses cuando
// el rango de tiempo elegido es corto. tMin/tMax están en años decimales.
function xTimeTicks(tMin, tMax) {
  const msPerYear = 365.25 * 24 * 3600 * 1000;
  const origin = tsSeries.dates[0].getTime() - tsSeries.t[0] * msPerYear;
  const dateToT = (ms) => (ms - origin) / msPerYear;
  const first = new Date(origin + tMin * msPerYear);
  const last = new Date(origin + tMax * msPerYear);
  const span = tMax - tMin;
  const ticks = [];

  if (span >= 2.5) {
    for (let year = first.getUTCFullYear(); year <= last.getUTCFullYear() + 1; year++) {
      const tv = dateToT(Date.UTC(year, 0, 1));
      if (tv >= tMin && tv <= tMax) ticks.push({ t: tv, label: String(year) });
    }
  } else {
    const stepMonths = span >= 1.2 ? 3 : span >= 0.5 ? 2 : 1;
    const cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
    while (cursor.getTime() <= last.getTime()) {
      const tv = dateToT(cursor.getTime());
      if (tv >= tMin && tv <= tMax) {
        const mes = cursor.toLocaleDateString("es-AR", { month: "short", timeZone: "UTC" });
        ticks.push({ t: tv, label: `${mes} ${cursor.getUTCFullYear()}` });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + stepMonths);
    }
  }
  return ticks;
}

function drawTriangle(ctx, x, y, size) {
  const h = size * 0.866;
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2 - size * 0.1);
  ctx.lineTo(x - size / 2, y + h / 2 - size * 0.1);
  ctx.lineTo(x + size / 2, y + h / 2 - size * 0.1);
  ctx.closePath();
}

function renderChart() {
  if (!tsSeries) return;
  updateSubtitle();

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = tsCanvas.clientWidth;
  const cssHeight = tsCanvas.clientHeight;
  tsCanvas.width = Math.round(cssWidth * dpr);
  tsCanvas.height = Math.round(cssHeight * dpr);
  const ctx = tsCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const showHist = tsControls.hist.checked;
  const histWidth = showHist ? 84 : 0;
  const margin = { left: 54, right: 16 + histWidth, top: 12, bottom: 42 };
  const plotW = cssWidth - margin.left - margin.right;
  const plotH = cssHeight - margin.top - margin.bottom;

  // Serie recortada al rango de tiempo elegido.
  const indices = visibleIndices();
  const yAll = transformedY();
  const t = indices.map((i) => tsSeries.t[i]);
  const y = indices.map((i) => yAll[i]);

  tsScreenPoints = [];
  if (t.length === 0) {
    tsTooltip.hidden = true;
    tsLegend.hidden = true;
    ctx.fillStyle = TS_COLORS.labelInk;
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Sin datos en el rango de tiempo elegido", cssWidth / 2, cssHeight / 2);
    return;
  }

  // Dominios.
  const tMin = t[0];
  let tMax = t[t.length - 1];
  if (tMax <= tMin) tMax = tMin + 0.02; // un solo punto en el rango
  let yMin = Math.min(...y);
  let yMax = Math.max(...y);
  const pad = (yMax - yMin || 1) * 0.08;
  yMin -= pad;
  yMax += pad;
  if (tsControls.ymin.value !== "") yMin = Number(tsControls.ymin.value);
  if (tsControls.ymax.value !== "") yMax = Number(tsControls.ymax.value);
  if (yMax <= yMin) yMax = yMin + 1;

  const xPos = (v) => margin.left + ((v - tMin) / (tMax - tMin)) * plotW;
  const yPos = (v) => margin.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // Grilla y ticks.
  ctx.font = "11px system-ui, sans-serif";
  ctx.lineWidth = 1;

  const yTicks = niceTicks(yMin, yMax, 6);
  for (const tick of yTicks) {
    const py = yPos(tick);
    ctx.strokeStyle = TS_COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(margin.left, py);
    ctx.lineTo(margin.left + plotW, py);
    ctx.stroke();
    ctx.fillStyle = TS_COLORS.tickInk;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.round(tick * 100) / 100), margin.left - 8, py);
  }

  for (const tick of xTimeTicks(tMin, tMax)) {
    const px = xPos(tick.t);
    ctx.strokeStyle = TS_COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(px, margin.top);
    ctx.lineTo(px, margin.top + plotH);
    ctx.stroke();
    ctx.fillStyle = TS_COLORS.tickInk;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(tick.label, px, margin.top + plotH + 6);
  }

  // Ejes (línea base).
  ctx.strokeStyle = TS_COLORS.baseline;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.stroke();

  // Títulos de ejes.
  ctx.fillStyle = TS_COLORS.labelInk;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("Tiempo", margin.left + plotW / 2, cssHeight - 4);
  ctx.save();
  ctx.translate(12, margin.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Deformación [cm]", 0, 0);
  ctx.restore();

  // Recorte al área de ploteo para puntos y regresiones.
  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left, margin.top, plotW, plotH);
  ctx.clip();

  // Puntos: triángulos verdes con anillo de superficie.
  for (let i = 0; i < t.length; i++) {
    const px = xPos(t[i]);
    const py = yPos(y[i]);
    tsScreenPoints.push({ x: px, y: py, index: indices[i], value: y[i] });
    drawTriangle(ctx, px, py, 8);
    ctx.fillStyle = TS_COLORS.puntos;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fill();
  }

  // Regresiones (sobre la serie transformada).
  const drawFit = (fit, color, dashed) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.setLineDash(dashed ? [7, 5] : []);
    ctx.beginPath();
    ctx.moveTo(xPos(tMin), yPos(fit.slope * tMin + fit.intercept));
    ctx.lineTo(xPos(tMax), yPos(fit.slope * tMax + fit.intercept));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (t.length >= 2 && tsControls.linear.checked) drawFit(linearRegression(t, y), TS_COLORS.lineal, false);
  if (t.length >= 2 && tsControls.theilsen.checked) drawFit(theilSenRegression(t, y), TS_COLORS.theilsen, true);

  ctx.restore();

  // Histograma marginal de los valores de deformación (margen derecho).
  if (showHist) {
    const bins = 18;
    const counts = new Array(bins).fill(0);
    for (const value of y) {
      let bin = Math.floor(((value - yMin) / (yMax - yMin)) * bins);
      if (bin >= 0 && bin < bins) counts[bin]++;
    }
    const maxCount = Math.max(...counts, 1);
    const binH = plotH / bins;
    const baseX = margin.left + plotW + 10;
    const maxBarW = histWidth - 20;
    ctx.fillStyle = "rgba(31, 122, 77, 0.35)";
    for (let bin = 0; bin < bins; bin++) {
      if (counts[bin] === 0) continue;
      const barW = (counts[bin] / maxCount) * maxBarW;
      const py = margin.top + plotH - (bin + 1) * binH;
      ctx.beginPath();
      ctx.roundRect(baseX, py + 1, barW, binH - 2, [0, 3, 3, 0]);
      ctx.fill();
    }
  }

  renderLegend();
}

function renderLegend() {
  const entries = [];
  if (tsControls.linear.checked || tsControls.theilsen.checked) {
    entries.push({ label: "Deformación", color: TS_COLORS.puntos, dashed: false });
    if (tsControls.linear.checked) {
      entries.push({ label: "Regresión lineal", color: TS_COLORS.lineal, dashed: false });
    }
    if (tsControls.theilsen.checked) {
      entries.push({ label: "Theil-Sen", color: TS_COLORS.theilsen, dashed: true });
    }
  }
  tsLegend.hidden = entries.length === 0;
  tsLegend.innerHTML = entries
    .map(
      (entry) => `<span class="ts-legend-item">
        <span class="ts-legend-key ${entry.dashed ? "dashed" : ""}" style="--key: ${entry.color}"></span>
        ${entry.label}
      </span>`
    )
    .join("");
}

// --- Tooltip -----------------------------------------------------------------

tsCanvas.addEventListener("mousemove", (event) => {
  if (!tsSeries || tsScreenPoints.length === 0) return;
  const rect = tsCanvas.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;
  let best = null;
  let bestDist = 144; // radio de captura 12px (al cuadrado)
  for (const point of tsScreenPoints) {
    const dist = (point.x - mx) ** 2 + (point.y - my) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = point;
    }
  }
  if (!best) {
    tsTooltip.hidden = true;
    return;
  }
  const date = tsSeries.dates[best.index];
  const fecha = date.toISOString().slice(0, 10);
  tsTooltip.innerHTML = `<strong>${fecha}</strong><br>${best.value.toFixed(2)} cm`;
  tsTooltip.style.left = `${best.x + 12}px`;
  tsTooltip.style.top = `${best.y - 12}px`;
  tsTooltip.hidden = false;
});

tsCanvas.addEventListener("mouseleave", () => {
  tsTooltip.hidden = true;
});

// --- Apertura y cierre -------------------------------------------------------

function studyCenter(item) {
  if (item.esPunto) return item.feature.geometry.coordinates;
  const bounds = featureBounds(item.feature.geometry);
  const center = bounds.getCenter();
  return [center.lng, center.lat];
}

// Velocidad media (regresión lineal sobre la serie cruda, sin escala ni
// envoltura) dentro del rango de tiempo visible.
function updateSubtitle() {
  if (!tsMeta || !tsSeries) return;
  const indices = visibleIndices();
  let velocidad = "—";
  if (indices.length >= 2) {
    const { slope } = linearRegression(
      indices.map((i) => tsSeries.t[i]),
      indices.map((i) => tsSeries.y[i])
    );
    velocidad = `${slope.toFixed(2)} cm/año`;
  }
  document.getElementById("ts-sub").textContent =
    `Lat ${tsMeta.lat.toFixed(4)}°, Lon ${tsMeta.lng.toFixed(4)}° — velocidad media: ${velocidad}`;
}

function openTimeseries(item) {
  window.tsLastItem = item;
  tsSeries = syntheticSeries(item.nombre);

  const [lng, lat] = studyCenter(item);
  tsMeta = { lat, lng };
  document.getElementById("ts-title").textContent = item.nombre;

  // El rango de tiempo arranca cubriendo toda la serie del estudio.
  const primera = tsSeries.dates[0].toISOString().slice(0, 10);
  const ultima = tsSeries.dates[tsSeries.dates.length - 1].toISOString().slice(0, 10);
  for (const input of [tsControls.tmin, tsControls.tmax]) {
    input.min = primera;
    input.max = ultima;
  }
  tsControls.tmin.value = primera;
  tsControls.tmax.value = ultima;

  tsPanel.hidden = false;
  renderChart();
}

document.getElementById("ts-close").addEventListener("click", () => {
  tsPanel.hidden = true;
});

tsPanel.addEventListener("click", (event) => {
  if (event.target === tsPanel) tsPanel.hidden = true;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !tsPanel.hidden) tsPanel.hidden = true;
});

// Controles: cualquier cambio redibuja.
for (const control of Object.values(tsControls)) {
  control.addEventListener("input", () => {
    document.getElementById("ts-scale-out").textContent = tsControls.scale.value;
    document.getElementById("ts-wrap-out").textContent = tsControls.wrap.value;
    renderChart();
  });
}

window.addEventListener("resize", () => {
  if (!tsPanel.hidden) renderChart();
});

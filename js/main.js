"use strict";

// Vista inicial centrada en Mendoza, Argentina (zona de interés del CEDIAC).
const INITIAL_CENTER = [-68.5, -34.6];
const INITIAL_ZOOM = 1.5;

// Capas base disponibles en el selector. Las de Esri exigen atribución propia.
// Argenmap (IGN) reemplaza a OSM: misma cartografía de base pero con la
// toponimia oficial argentina, por lo que rotula "Islas Malvinas" y no
// muestra "Falkland Islands".
const BASE_LAYERS = {
  argenmap: {
    tiles: [
      "https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/capabaseargenmap@EPSG:3857@png/{z}/{x}/{y}.png",
    ],
    scheme: "tms",
    maxzoom: 18,
    attribution:
      "<a href='https://www.ign.gob.ar/'>Instituto Geográfico Nacional</a> &mdash; &copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
  },
  satellite: {
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    maxzoom: 19,
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
  topo: {
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    ],
    maxzoom: 19,
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, and the GIS User Community",
  },
};

const sources = {};
const layers = [];
for (const [id, def] of Object.entries(BASE_LAYERS)) {
  sources[id] = {
    type: "raster",
    tiles: def.tiles,
    tileSize: 256,
    maxzoom: def.maxzoom,
    attribution: def.attribution,
  };
  if (def.scheme) {
    sources[id].scheme = def.scheme;
  }
  layers.push({
    id,
    type: "raster",
    source: id,
    layout: { visibility: id === "argenmap" ? "visible" : "none" },
  });
}

const map = new maplibregl.Map({
  container: "map",
  center: INITIAL_CENTER,
  zoom: INITIAL_ZOOM,
  style: {
    version: 8,
    projection: { type: "globe" },
    sources,
    layers,
    sky: {
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
    },
    light: {
      anchor: "map",
      position: [1.5, 90, 80],
    },
  },
  attributionControl: { compact: false },
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
map.addControl(new maplibregl.GlobeControl(), "top-left");
map.addControl(new maplibregl.ScaleControl(), "bottom-left");

// Etiqueta propia "Islas Malvinas": solo hace falta en la vista satelital,
// que no trae toponimia (Argenmap ya rotula las islas en sus tiles, y en el
// topográfico de Esri se superpondría con el nombre incrustado en la imagen).
const malvinasLabel = document.createElement("div");
malvinasLabel.className = "map-label-ar";
malvinasLabel.textContent = "Islas Malvinas";
new maplibregl.Marker({ element: malvinasLabel }).setLngLat([-59.4, -51.75]).addTo(map);

let currentBaseLayer = "argenmap";
const MALVINAS_LABEL_MIN_ZOOM = 3;

function refreshMalvinasLabel() {
  const visible = currentBaseLayer === "satellite" && map.getZoom() >= MALVINAS_LABEL_MIN_ZOOM;
  malvinasLabel.style.display = visible ? "" : "none";
}

map.on("zoom", refreshMalvinasLabel);
refreshMalvinasLabel();

// Alternar entre globo 3D y mapa plano 2D (mercator).
const toggleButton = document.getElementById("projection-toggle");
let isGlobe = true;

function applyProjection() {
  map.setProjection({ type: isGlobe ? "globe" : "mercator" });
  toggleButton.textContent = isGlobe ? "Ver mapa 2D" : "Ver globo 3D";
}

toggleButton.addEventListener("click", () => {
  isGlobe = !isGlobe;
  applyProjection();
});

// --- Datos: concesiones y puntos de interés ----------------------------------

// Colores por tipo de terreno, consistentes con la leyenda.
const TIPO_COLORS = {
  "Yacimiento petrolero": "#8e44ad",
  Deslizamiento: "#d35400",
  Glaciar: "#2980b9",
  Volcán: "#c0392b",
  Otro: "#7f8c8d",
};

// Índice para el buscador: se llena cuando cargan los GeoJSON.
const searchIndex = [];

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// El campo "participacion" viene de la fuente con separadores "<br>".
function formatParticipacion(raw) {
  return raw
    .split(/<br\s*\/?>/i)
    .map((part) => escapeHtml(part.trim()))
    .filter(Boolean)
    .join("<br>");
}

function featureBounds(geometry) {
  const bounds = new maplibregl.LngLatBounds();
  const extend = (coords) => {
    if (typeof coords[0] === "number") {
      bounds.extend(coords);
    } else {
      coords.forEach(extend);
    }
  };
  extend(geometry.coordinates);
  return bounds;
}

async function loadData() {
  const [concesiones, pois] = await Promise.all([
    fetch("data/concesiones.geojson").then((r) => r.json()),
    fetch("data/puntos_interes.geojson").then((r) => r.json()),
  ]);

  map.addSource("concesiones", { type: "geojson", data: concesiones });
  map.addSource("poi", { type: "geojson", data: pois });

  map.addLayer({
    id: "concesiones-fill",
    type: "fill",
    source: "concesiones",
    paint: { "fill-color": "#1f7a4d", "fill-opacity": 0.15 },
  });
  map.addLayer({
    id: "concesiones-line",
    type: "line",
    source: "concesiones",
    paint: { "line-color": "#1f7a4d", "line-width": 1.2 },
  });
  map.addLayer({
    id: "poi-circles",
    type: "circle",
    source: "poi",
    paint: {
      "circle-radius": 7,
      "circle-color": [
        "match",
        ["get", "tipo"],
        ...Object.entries(TIPO_COLORS).flat(),
        TIPO_COLORS.Otro,
      ],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  // Índice de búsqueda: concesiones + puntos de interés.
  for (const feature of concesiones.features) {
    const { nombre, codigo, operadora } = feature.properties;
    searchIndex.push({
      nombre,
      subtitulo: operadora || "Concesión de explotación",
      claves: `${nombre} ${codigo} ${operadora}`,
      color: "#1f7a4d",
      feature,
      esPunto: false,
    });
  }
  for (const feature of pois.features) {
    const { nombre, tipo } = feature.properties;
    searchIndex.push({
      nombre,
      subtitulo: tipo,
      claves: `${nombre} ${tipo}`,
      color: TIPO_COLORS[tipo] || TIPO_COLORS.Otro,
      feature,
      esPunto: true,
    });
  }

  // Popups al hacer clic.
  map.on("click", "concesiones-fill", (event) => {
    const props = event.features[0].properties;
    const html = `
      <div class="popup">
        <div class="popup-title">${escapeHtml(props.nombre)}</div>
        <div class="popup-sub">Concesión de explotación ${props.codigo ? `(${escapeHtml(props.codigo)})` : ""}</div>
        ${props.operadora ? `<div><strong>Operadora:</strong> ${escapeHtml(props.operadora)}</div>` : ""}
        ${props.participacion ? `<div><strong>Participación:</strong><br>${formatParticipacion(props.participacion)}</div>` : ""}
        <button class="btn popup-ts-btn" data-nombre="${escapeHtml(props.nombre)}">Ver serie temporal</button>
        <div class="popup-note">Fuente: Secretaría de Energía de la Nación</div>
      </div>`;
    new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(event.lngLat).setHTML(html).addTo(map);
  });

  map.on("click", "poi-circles", (event) => {
    const props = event.features[0].properties;
    const html = `
      <div class="popup">
        <div class="popup-title">${escapeHtml(props.nombre)}</div>
        <div class="popup-sub">${escapeHtml(props.tipo)}</div>
        <div>${escapeHtml(props.descripcion)}</div>
        <button class="btn popup-ts-btn" data-nombre="${escapeHtml(props.nombre)}">Ver serie temporal</button>
      </div>`;
    new maplibregl.Popup({ maxWidth: "320px" })
      .setLngLat(event.features[0].geometry.coordinates)
      .setHTML(html)
      .addTo(map);
  });

  for (const layerId of ["concesiones-fill", "poi-circles"]) {
    map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
  }
}

map.on("load", () => {
  loadData().catch((error) => {
    console.error("Error cargando datos:", error);
    showToast("No se pudieron cargar los datos de concesiones");
  });
});

// --- Buscador de estudios ----------------------------------------------------

const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");

function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function goToResult(item) {
  searchResults.hidden = true;
  searchInput.value = item.nombre;
  if (item.esPunto) {
    const coords = item.feature.geometry.coordinates;
    map.flyTo({ center: coords, zoom: 9 });
    const props = item.feature.properties;
    new maplibregl.Popup({ maxWidth: "320px" })
      .setLngLat(coords)
      .setHTML(
        `<div class="popup">
          <div class="popup-title">${escapeHtml(props.nombre)}</div>
          <div class="popup-sub">${escapeHtml(props.tipo)}</div>
          <div>${escapeHtml(props.descripcion)}</div>
          <button class="btn popup-ts-btn" data-nombre="${escapeHtml(props.nombre)}">Ver serie temporal</button>
        </div>`
      )
      .addTo(map);
  } else {
    map.fitBounds(featureBounds(item.feature.geometry), { padding: 80, maxZoom: 11 });
  }
}

function renderResults(query) {
  const term = normalize(query.trim());
  if (term.length < 2) {
    searchResults.hidden = true;
    searchResults.innerHTML = "";
    return;
  }
  const matches = searchIndex.filter((item) => normalize(item.claves).includes(term)).slice(0, 8);
  if (matches.length === 0) {
    searchResults.innerHTML = "<li class='search-empty'>Sin resultados</li>";
    searchResults.hidden = false;
    return;
  }
  searchResults.innerHTML = "";
  for (const item of matches) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="legend-dot" style="--dot: ${item.color}"></span>
      <span class="search-name">${escapeHtml(item.nombre)}</span>
      <span class="search-sub">${escapeHtml(item.subtitulo)}</span>`;
    li.addEventListener("click", () => goToResult(item));
    searchResults.appendChild(li);
  }
  searchResults.hidden = false;
}

searchInput.addEventListener("input", () => renderResults(searchInput.value));
searchInput.addEventListener("focus", () => renderResults(searchInput.value));

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const first = searchResults.querySelector("li:not(.search-empty)");
    if (first) first.click();
  } else if (event.key === "Escape") {
    searchResults.hidden = true;
  }
});

document.addEventListener("click", (event) => {
  if (!document.getElementById("search").contains(event.target)) {
    searchResults.hidden = true;
  }
});

// --- Selector de capas -------------------------------------------------------

const layerSwitcher = document.getElementById("layer-switcher");
const switcherToggle = layerSwitcher.querySelector(".layer-switcher-toggle");

switcherToggle.addEventListener("click", () => {
  const open = layerSwitcher.classList.toggle("open");
  switcherToggle.setAttribute("aria-expanded", String(open));
});

// Cerrar el panel al hacer clic fuera de él.
document.addEventListener("click", (event) => {
  if (!layerSwitcher.contains(event.target)) {
    layerSwitcher.classList.remove("open");
    switcherToggle.setAttribute("aria-expanded", "false");
  }
});

for (const radio of layerSwitcher.querySelectorAll("input[name='base-layer']")) {
  radio.addEventListener("change", () => {
    for (const id of Object.keys(BASE_LAYERS)) {
      map.setLayoutProperty(id, "visibility", id === radio.value ? "visible" : "none");
    }
    currentBaseLayer = radio.value;
    refreshMalvinasLabel();
  });
}

// Superposiciones: cada checkbox controla un grupo de capas.
const OVERLAY_LAYERS = {
  "overlay-concesiones": ["concesiones-fill", "concesiones-line"],
  "overlay-poi": ["poi-circles"],
};

for (const [checkboxId, layerIds] of Object.entries(OVERLAY_LAYERS)) {
  document.getElementById(checkboxId).addEventListener("change", (event) => {
    const visibility = event.target.checked ? "visible" : "none";
    for (const layerId of layerIds) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", visibility);
      }
    }
  });
}

// --- Botones flotantes -------------------------------------------------------

const toast = document.getElementById("toast");
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2500);
}

document.getElementById("btn-chart").addEventListener("click", () => {
  if (window.tsLastItem) {
    openTimeseries(window.tsLastItem);
  } else {
    showToast("Elegí un estudio en el mapa o en el buscador");
  }
});

// Botones "Ver serie temporal" dentro de los popups del mapa (delegación,
// porque los popups se crean y destruyen dinámicamente).
document.addEventListener("click", (event) => {
  const button = event.target.closest(".popup-ts-btn");
  if (!button) return;
  const item = searchIndex.find((entry) => entry.nombre === button.dataset.nombre);
  if (item) openTimeseries(item);
});

document.getElementById("btn-filters").addEventListener("click", () => {
  showToast("Filtros: disponible próximamente");
});

document.getElementById("btn-refresh").addEventListener("click", async () => {
  try {
    const [concesiones, pois] = await Promise.all([
      fetch("data/concesiones.geojson").then((r) => r.json()),
      fetch("data/puntos_interes.geojson").then((r) => r.json()),
    ]);
    map.getSource("concesiones").setData(concesiones);
    map.getSource("poi").setData(pois);
    showToast("Datos actualizados");
  } catch {
    showToast("No se pudieron refrescar los datos");
  }
});

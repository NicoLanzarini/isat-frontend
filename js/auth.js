"use strict";

// Sesión del visor. La API SISAR autentica con tokens bearer pre-compartidos,
// así que el "login" guarda usuario + token para usarlos en las llamadas al
// backend. Es una compuerta de interfaz: la autorización real la hace la API.

const AUTH_KEY = "isat_auth";
const REMEMBER_DAYS = 7;

function readAuth() {
  const raw = sessionStorage.getItem(AUTH_KEY) || localStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try {
    const auth = JSON.parse(raw);
    if (auth.expira && Date.now() > auth.expira) {
      localStorage.removeItem(AUTH_KEY);
      return null;
    }
    return auth;
  } catch {
    return null;
  }
}

// Token de la sesión activa, para las futuras llamadas a la API.
function authToken() {
  const auth = readAuth();
  return auth ? auth.token : null;
}

function applyLoggedIn(auth) {
  document.body.classList.remove("logged-out");
  document.getElementById("user-chip").textContent = auth.usuario;
}

function applyLoggedOut() {
  document.body.classList.add("logged-out");
  document.getElementById("login-user").focus();
}

const existing = readAuth();
if (existing) {
  applyLoggedIn(existing);
}

document.getElementById("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const usuario = document.getElementById("login-user").value.trim();
  const token = document.getElementById("login-token").value.trim();
  const error = document.getElementById("login-error");
  if (!usuario || !token) {
    error.hidden = false;
    return;
  }
  error.hidden = true;

  const auth = { usuario, token };
  if (document.getElementById("login-remember").checked) {
    auth.expira = Date.now() + REMEMBER_DAYS * 24 * 3600 * 1000;
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  } else {
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  }
  document.getElementById("login-token").value = "";
  applyLoggedIn(auth);
});

document.getElementById("logout-btn").addEventListener("click", () => {
  sessionStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(AUTH_KEY);
  applyLoggedOut();
});

document.querySelector(".tab-lock").addEventListener("click", () => {
  document.getElementById("login-user").focus();
});

if (!existing) {
  applyLoggedOut();
}

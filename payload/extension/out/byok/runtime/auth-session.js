"use strict";

function readOfficialConnection() {
  return require("../config/official").getOfficialConnection();
}

function hasByokOfficialSession() {
  try {
    const conn = readOfficialConnection();
    return !!(conn && conn.apiToken && conn.completionURL);
  } catch {
    return false;
  }
}

function getByokOfficialSession() {
  const conn = readOfficialConnection();
  if (!conn || !conn.apiToken || !conn.completionURL) return null;
  return {
    accessToken: conn.apiToken,
    tenantURL: conn.completionURL,
    scopes: ["email"]
  };
}

function syncByokAuthState({ store, commands }) {
  const loggedIn = hasByokOfficialSession();
  try {
    if (store && Object.prototype.hasOwnProperty.call(store, "_isLoggedIn")) store._isLoggedIn = loggedIn;
  } catch {}

  try {
    if (commands && typeof commands.executeCommand === "function") {
      commands.executeCommand("setContext", "vscode-augment.isLoggedIn", loggedIn);
      commands.executeCommand("setContext", "vscode-augment.useOAuth", false);
    }
  } catch {}

  return loggedIn;
}

module.exports = { hasByokOfficialSession, getByokOfficialSession, syncByokAuthState };

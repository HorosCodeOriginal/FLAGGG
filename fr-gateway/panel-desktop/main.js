// main.js — fr-gateway Panel als Desktop-App.
// Öffnet das Web-Panel (http://127.0.0.1:8090) in einem eigenen Fenster.
const { app, BrowserWindow } = require('electron');

const PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:8090';
const PANEL_TOKEN = process.env.PANEL_TOKEN || '';
// Token einmalig per Query mitgeben; das Panel setzt daraus ein HttpOnly-Cookie.
const BOOT_URL = PANEL_TOKEN
  ? PANEL_URL + '/?token=' + encodeURIComponent(PANEL_TOKEN)
  : PANEL_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'fr-gateway Panel',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadURL(BOOT_URL);
  win.on('page-title-updated', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

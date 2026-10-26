const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const views = ['chat', 'roles', 'spaces', 'failover', 'orchestration', 'overview', 'market'];
const outDir = path.join(__dirname, 'screenshots_astra');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1480,
    height: 940,
    show: true,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await win.loadFile(path.join(__dirname, 'index.html'));
  await new Promise(r => setTimeout(r, 2200));

  for (const v of views) {
    console.log('Klicke auf View:', v);
    await win.webContents.executeJavaScript(`
      (function() {
        var btn = document.querySelector('.vnav button[data-view="${v}"]');
        if (btn) { btn.click(); return 'geklickt'; }
        return 'nicht gefunden';
      })();
    `).then(console.log).catch(err => console.error('Klick-Fehler:', err));
    await new Promise(r => setTimeout(r, 1200));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${v}.png`), image.toPNG());
    console.log('gespeichert:', `${v}.png`);
  }

  app.quit();
}

main().catch(err => { console.error(err); app.exit(1); });

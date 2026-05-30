import { app, BrowserWindow } from 'electron';
import { startServer } from '../server.js';

let mainWindow = null;
let httpServer = null;

function closeServer() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
}

async function createWindow() {
  const { server, url } = await startServer();
  httpServer = server;

  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 400,
    minHeight: 500,
    title: 'Local AI Chatbot',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow).catch((error) => {
  console.error('Failed to start desktop app:', error.message);
  app.quit();
});

app.on('window-all-closed', () => {
  closeServer();
  app.quit();
});

app.on('before-quit', () => {
  closeServer();
});

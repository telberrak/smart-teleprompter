const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("teleprompter", {
  openScript: () => ipcRenderer.invoke("script:open"),
  openSlides: () => ipcRenderer.invoke("slides:open"),
  saveScript: (file, content) => ipcRenderer.invoke("script:save", file, content),
});

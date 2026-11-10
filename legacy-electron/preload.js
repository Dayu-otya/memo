const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notesAPI", {
  load: () => ipcRenderer.invoke("notes:load"),
  save: (notes) => ipcRenderer.invoke("notes:save", notes),
  export: (note) => ipcRenderer.invoke("notes:export", note),
  exportAllMarkdown: (notes) => ipcRenderer.invoke("notes:exportAllMarkdown", notes),
  importMarkdown: () => ipcRenderer.invoke("notes:importMarkdown"),
  autosave: (notes) => ipcRenderer.invoke("notes:autosave", notes),
  checkAutosave: () => ipcRenderer.invoke("notes:checkAutosave"),
  discardAutosave: () => ipcRenderer.invoke("notes:discardAutosave"),
  status: () => ipcRenderer.invoke("notes:status"),
});

contextBridge.exposeInMainWorld("settingsAPI", {
  load: () => ipcRenderer.invoke("settings:load"),
  save: (settings) => ipcRenderer.invoke("settings:save", settings),
  prefersDark: () => ipcRenderer.invoke("system:prefersDark"),
});

contextBridge.exposeInMainWorld("backupAPI", {
  checkpoint: () => ipcRenderer.invoke("backup:checkpoint"),
  manual: () => ipcRenderer.invoke("backup:manual"),
  listAuto: () => ipcRenderer.invoke("backup:listAuto"),
  restoreAuto: (fileName) => ipcRenderer.invoke("backup:restoreAuto", fileName),
  restoreFromFile: () => ipcRenderer.invoke("backup:restoreFromFile"),
});

contextBridge.exposeInMainWorld("printAPI", {
  print: () => ipcRenderer.invoke("app:print"),
});

contextBridge.exposeInMainWorld("shellAPI", {
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
});

contextBridge.exposeInMainWorld("cryptoAPI", {
  encrypt: (text, password) => ipcRenderer.invoke("crypto:encrypt", { text, password }),
  decrypt: (payload, password) => ipcRenderer.invoke("crypto:decrypt", { payload, password }),
  hashPassword: (password) => ipcRenderer.invoke("crypto:hashPassword", password),
  verifyPassword: (password, stored) =>
    ipcRenderer.invoke("crypto:verifyPassword", { password, stored }),
});

contextBridge.exposeInMainWorld("updateAPI", {
  checkNow: () => ipcRenderer.invoke("update:checkNow"),
  installNow: () => ipcRenderer.invoke("update:installNow"),
  getVersion: () => ipcRenderer.invoke("app:version"),
  onAvailable: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("update:available", listener);
    return () => ipcRenderer.removeListener("update:available", listener);
  },
  onNotAvailable: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("update:not-available", listener);
    return () => ipcRenderer.removeListener("update:not-available", listener);
  },
  onProgress: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("update:progress", listener);
    return () => ipcRenderer.removeListener("update:progress", listener);
  },
  onDownloaded: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("update:downloaded", listener);
    return () => ipcRenderer.removeListener("update:downloaded", listener);
  },
  onError: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("update:error", listener);
    return () => ipcRenderer.removeListener("update:error", listener);
  },
});

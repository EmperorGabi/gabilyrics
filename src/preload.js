const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('vc', {
  info: call('app:info'),
  library: { all: call('library:all'), save: call('library:save'), remove: call('library:delete'), importFiles: call('library:import'), exportAll: call('library:export') },
  plan: { get: call('plan:get'), set: call('plan:set') },
  settings: { get: call('settings:get'), set: call('settings:set') },
  live: { set: call('live:set') },
  online: { search: call('online:search') },
  pickImage: call('dialog:image'),
  openData: call('open:data'),
  openUrl: call('open:url'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
});

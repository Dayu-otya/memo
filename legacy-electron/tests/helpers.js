const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
function renderer(files = ['01-core-state.js','02-dom.js','03-notes-data.js']) {
  const elements = new Map();
  const element = () => ({style:{display:'none'}, textContent:'', value:'', innerHTML:'', childNodes:[],
    classList:{contains:()=>false,add(){},remove(){},toggle(){}}, addEventListener(){},
    appendChild(){}, contains:()=>false, focus(){}, blur(){}, setAttribute(){}, querySelectorAll:()=>[], options:[{}]});
  const document = { getElementById(id){if(!elements.has(id))elements.set(id,element()); return elements.get(id);},
    addEventListener(){}, querySelectorAll:()=>[], activeElement:null, documentElement:{setAttribute(){},style:{setProperty(){}}}};
  const window = {getSelection:()=>null, notesAPI:{save:async()=>true, autosave:async()=>true}, settingsAPI:{save:async()=>true}, cryptoAPI:{encrypt:async(body)=>({data:body})}};
  const ctx = vm.createContext({document,window, console:{log(){},error(){}}, structuredClone, setTimeout:()=>1, clearTimeout(){}, Node:{TEXT_NODE:3,ELEMENT_NODE:1}});
  for(const file of files) vm.runInContext(fs.readFileSync(path.join(root,'src/js',file),'utf8'),ctx,{filename:file});
  return {ctx,window,document,elements, run:code=>vm.runInContext(code,ctx)};
}
function mainHarness(directory) {
  const handlers = new Map(); const windows=[]; let ready;
  const app = new EventEmitter();
  Object.assign(app,{getPath:()=>directory, getVersion:()=> '1.0.3', requestSingleInstanceLock:()=>true, whenReady:()=>({then:fn=>{ready=fn;}}),quit(){},isPackaged:false});
  class BrowserWindow extends EventEmitter {
    constructor(){super(); windows.push(this); this.webContents=new EventEmitter(); Object.assign(this.webContents,{setWindowOpenHandler(){},send(){},executeJavaScript:async()=>true,print:(opts,cb)=>cb(true,''),printToPDF:async()=>Buffer.from('%PDF-test')});}
    loadFile(file){this.loadedFile=file;return Promise.resolve();} show(){} isDestroyed(){return false;} destroy(){this.destroyed=true;} close(){this.closed=true;}
    static getAllWindows(){return windows;}
  }
  const dialog = {showOpenDialog:async()=>({canceled:true}),showSaveDialog:async()=>({canceled:true}),showErrorBox(){}};
  const electron={app,BrowserWindow,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog,nativeTheme:{shouldUseDarkColors:false},shell:{openExternal:async()=>{}}};
  const context=vm.createContext({require:name=>name==='electron'?electron:name==='./storage'?require('../storage'):require(name),__dirname:root,console:{log(){},error(){}},process,Buffer,setTimeout(){},setImmediate,URL,TextDecoder});
  vm.runInContext(fs.readFileSync(path.join(root,'main.js'),'utf8'),context);
  return {handlers,dialog,windows,ready:()=>ready(),call:(name,...args)=>handlers.get(name)({},...args)};
}
module.exports={renderer,mainHarness};



const TAG_COLORS = [
  { bg: "#FDF6E3", border: "#E8DCB5", label: "きいろ", bgDark: "#34311F" },
  { bg: "#EAF2E9", border: "#C6DBC2", label: "みどり", bgDark: "#232E24" },
  { bg: "#EAF0F6", border: "#C3D7E8", label: "あお", bgDark: "#222B35" },
  { bg: "#F6EAF0", border: "#E3C3D3", label: "ピンク", bgDark: "#35262E" },
  { bg: "#F1EAF6", border: "#D4C3E3", label: "むらさき", bgDark: "#2D2537" },
];

let notes = [];
let folders = [];
let settings = { theme: "light", fontSize: 16 };
let tagColors = {};

let katexLoadPromise = null;
function ensureKatexLoaded() {
  if (window.katex) return Promise.resolve();
  if (katexLoadPromise) return katexLoadPromise;
  katexLoadPromise = new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "vendor/katex/katex.min.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "vendor/katex/katex.min.js";
    script.onload = () => {
      resolve();
      refreshMathIfNeeded();
    };
    script.onerror = () => resolve();
    document.body.appendChild(script);
  });
  return katexLoadPromise;
}

function refreshMathIfNeeded() {
  if (typeof renderEditor === "function" && document.activeElement !== bodyInput && document.activeElement !== mdPreview) {
    lastRenderedBodyId = undefined;
    renderEditor();
  }
}

const TAG_PALETTE = ["#E8DCB5", "#C6DBC2", "#C3D7E8", "#E3C3D3", "#D4C3E3", "#D9C4B0", "#B8D8D8"];

function colorForTag(tag) {
  if (!Object.prototype.hasOwnProperty.call(tagColors, tag)) {
    const used = Object.keys(tagColors).length;
    Object.defineProperty(tagColors, tag, { value: used % TAG_PALETTE.length, enumerable: true, writable: true, configurable: true });
    persistSettings();
  }
  return TAG_PALETTE[tagColors[tag]];
}

let activeId = null;

let lastRenderedBodyId = undefined;
let query = "";
let activeFolderId = "";
let activeTagFilter = "";
let saveTimer = null;
let saveInFlight = false;
let saveQueued = false;
let viewMode = "editor";
let todoGroupBy = "note";
let todoHideDone = false;
let todoQuery = "";
let sortMode = "updated";

let selectedIds = new Set();
let lastClickedId = null;

let draggedIds = [];

let unlockedIds = new Set();
let pendingUnlockId = null;

let sessionPasswords = new Map();

async function prepareNotesForPersist(list) {
  const result = [];
  const snapshot = structuredClone(list);
  for (const n of snapshot) {
    if (n.locked) {
      if (sessionPasswords.has(n.id)) {
        const password = sessionPasswords.get(n.id);
        try {
          const payload = await window.cryptoAPI.encrypt(n.body, password);
          result.push({ ...n, body: "", encrypted: payload });
        } catch (e) {
          console.error("メモの暗号化に失敗しました:", e);
          throw e;
        }
      } else {
        result.push({ ...n, body: n.encrypted ? "" : n.body });
      }
    } else {
      result.push({ ...n, encrypted: null });
    }
  }
  return result;
}

function markAsTitleLine(html) {
  return html.replace(/^<([a-zA-Z0-9]+)((?:\s+[^\s=>]+(?:="[^"]*")?)*)>/, (m, tag, attrs) => {
    if (/\bclass="/.test(attrs)) {
      attrs = attrs.replace(/\bclass="([^"]*)"/, (m2, cls) => `class="${cls} note-title-line"`);
    } else {
      attrs = `${attrs} class="note-title-line"`;
    }
    return `<${tag}${attrs}>`;
  });
}


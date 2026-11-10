

const noteListEl = document.getElementById("noteList");
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const newNoteBtn = document.getElementById("newNoteBtn");
const emptyNewNoteBtn = document.getElementById("emptyNewNoteBtn");
const emptyState = document.getElementById("emptyState");
const editorView = document.getElementById("editorView");
const trashView = document.getElementById("trashView");
const lockView = document.getElementById("lockView");
const bodyInput = document.getElementById("bodyInput");
const mdPreview = document.getElementById("mdPreview");
const colorDots = document.getElementById("colorDots");
const saveStateEl = document.getElementById("saveState");
const pinBtn = document.getElementById("pinBtn");
const deleteBtn = document.getElementById("deleteBtn");
const exportBtn = document.getElementById("exportBtn");
const exportMenu = document.getElementById("exportMenu");
const exportTxtBtn = document.getElementById("exportTxtBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const printBtn = document.getElementById("printBtn");
const printPreviewView = document.getElementById("printPreviewView");
const printPreviewPage = document.getElementById("printPreviewPage");
const printPreviewGoBtn = document.getElementById("printPreviewGoBtn");
const closePrintPreviewBtn = document.getElementById("closePrintPreviewBtn");
const todoBtn = document.getElementById("todoBtn");
const showTodoBtn = document.getElementById("showTodoBtn");
const todoView = document.getElementById("todoView");
const closeTodoBtn = document.getElementById("closeTodoBtn");
const todoGroups = document.getElementById("todoGroups");
const todoGroupBySelect = document.getElementById("todoGroupBySelect");
const todoHideDoneCheckbox = document.getElementById("todoHideDoneCheckbox");
const todoSearchInput = document.getElementById("todoSearchInput");
const todoSummary = document.getElementById("todoSummary");
const markdownToggleBtn = document.getElementById("markdownToggleBtn");
const lockToggleBtn = document.getElementById("lockToggleBtn");
const charCountEl = document.getElementById("charCount");
const lineCountEl = document.getElementById("lineCount");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const menuBtn = document.getElementById("menuBtn");
const menuPanel = document.getElementById("menuPanel");
const manualBackupBtn = document.getElementById("manualBackupBtn");
const restoreBackupBtn = document.getElementById("restoreBackupBtn");
const shortcutsOverlay = document.getElementById("shortcutsOverlay");
const shortcutsList = document.getElementById("shortcutsList");
const shortcutsCloseBtn = document.getElementById("shortcutsCloseBtn");
const showMarkdownGuideBtn = document.getElementById("showMarkdownGuideBtn");
const markdownGuideOverlay = document.getElementById("markdownGuideOverlay");
const markdownGuideList = document.getElementById("markdownGuideList");
const markdownGuideCloseBtn = document.getElementById("markdownGuideCloseBtn");
const restoreOverlay = document.getElementById("restoreOverlay");
const restoreList = document.getElementById("restoreList");
const restoreFromFileBtn = document.getElementById("restoreFromFileBtn");
const restoreCancelBtn = document.getElementById("restoreCancelBtn");
const lastSavedText = document.getElementById("lastSavedText");
const lastAutoBackupText = document.getElementById("lastAutoBackupText");
const checkUpdateBtn = document.getElementById("checkUpdateBtn");
const appVersionText = document.getElementById("appVersionText");
const updateBanner = document.getElementById("updateBanner");
const updateBannerText = document.getElementById("updateBannerText");
const updateBannerActionBtn = document.getElementById("updateBannerActionBtn");
const updateBannerDismissBtn = document.getElementById("updateBannerDismissBtn");
const showTrashBtn = document.getElementById("showTrashBtn");
const selectAllVisibleBtn = document.getElementById("selectAllVisibleBtn");
const closeTrashBtn = document.getElementById("closeTrashBtn");
const trashList = document.getElementById("trashList");
const fontSizeRange = document.getElementById("fontSizeRange");
const folderSelect = document.getElementById("folderSelect");
const folderAssignSelect = document.getElementById("folderAssignSelect");
const newFolderBtn = document.getElementById("newFolderBtn");
const sortSelect = document.getElementById("sortSelect");
const tagSuggestions = document.getElementById("tagSuggestions");
const exportAllMarkdownBtn = document.getElementById("exportAllMarkdownBtn");
const importMarkdownBtn = document.getElementById("importMarkdownBtn");
const tagFilterRow = document.getElementById("tagFilterRow");
const tagInput = document.getElementById("tagInput");
const tagListRow = document.getElementById("tagListRow");
const lockPasswordInput = document.getElementById("lockPasswordInput");
const lockUnlockBtn = document.getElementById("lockUnlockBtn");
const folderDropRow = document.getElementById("folderDropRow");
const selectionBar = document.getElementById("selectionBar");
const selectionCount = document.getElementById("selectionCount");
const selectionFolderSelect = document.getElementById("selectionFolderSelect");
const selectionTagInput = document.getElementById("selectionTagInput");
const selectionTagSuggestions = document.getElementById("selectionTagSuggestions");
const selectionDeleteBtn = document.getElementById("selectionDeleteBtn");
const selectionSelectAllBtn = document.getElementById("selectionSelectAllBtn");
const selectionClearBtn = document.getElementById("selectionClearBtn");
const showShortcutsBtn = document.getElementById("showShortcutsBtn");
const noteSearchBar = document.getElementById("noteSearchBar");
const noteSearchInput = document.getElementById("noteSearchInput");
const noteReplaceInput = document.getElementById("noteReplaceInput");
const noteReplaceBtn = document.getElementById("noteReplaceBtn");
const noteReplaceAllBtn = document.getElementById("noteReplaceAllBtn");
const noteSearchCount = document.getElementById("noteSearchCount");
const noteSearchPrevBtn = document.getElementById("noteSearchPrevBtn");
const noteSearchNextBtn = document.getElementById("noteSearchNextBtn");
const noteSearchCloseBtn = document.getElementById("noteSearchCloseBtn");
const lockError = document.getElementById("lockError");
const lockMessage = document.getElementById("lockMessage");
const modalOverlay = document.getElementById("modalOverlay");
const modalMessage = document.getElementById("modalMessage");
const modalInput = document.getElementById("modalInput");
const modalError = document.getElementById("modalError");
const modalOkBtn = document.getElementById("modalOkBtn");
const modalCancelBtn = document.getElementById("modalCancelBtn");

function isMemoEditorElement(target) {
  return (
    target === bodyInput ||
    target === mdPreview ||
    bodyInput.contains(target) ||
    mdPreview.contains(target)
  );
}

function isTextEntryElement(target) {
  if (!target) return false;
  const tag = (target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || !!target.isContentEditable;
}

function isNonMemoTextEntryFocused() {
  return isTextEntryElement(document.activeElement) && !isMemoEditorElement(document.activeElement);
}

// 入力窓(パスワードの設定など)や本文以外の入力欄を使っている間は、
// 遅れて動く再描画がメモ本文へ入力位置(と入力の受け口)を戻してはいけない。
function canRestoreEditorCaret() {
  return modalOverlay.style.display === "none" && !isNonMemoTextEntryFocused();
}



let modalResolve = null;
let modalPreviousFocus = null;

function closeModal(result) {
  modalOverlay.style.display = "none";
  modalInput.value = "";
  modalInput.type = "text";
  modalCancelBtn.style.display = "inline-flex";
  const resolve = modalResolve;
  modalResolve = null;
  if (modalPreviousFocus && modalPreviousFocus.isConnected) modalPreviousFocus.focus();
  if (resolve) resolve(result);
}

modalOkBtn.onclick = () => {
  if (modalInput.style.display !== "none") {
    closeModal(modalInput.value);
  } else {
    closeModal(true);
  }
};

modalCancelBtn.onclick = () => closeModal(null);

modalInput.onkeydown = (e) => {
  if (e.isComposing) return;
  if (e.key === "Enter") modalOkBtn.click();
  if (e.key === "Escape") modalCancelBtn.click();
};

function askText(message, options = {}) {
  if (modalResolve) return Promise.resolve(null);
  modalPreviousFocus = document.activeElement;
  return new Promise((resolve) => {
    modalResolve = resolve;
    modalMessage.textContent = message;
    modalInput.style.display = "block";
    modalInput.type = options.password ? "password" : "text";
    modalInput.value = "";
    modalError.textContent = "";
    modalOverlay.style.display = "flex";
    modalInput.focus();
  });
}

function askConfirm(message, options = {}) {
  if (modalResolve) return Promise.resolve(null);
  modalPreviousFocus = document.activeElement;
  return new Promise((resolve) => {
    modalResolve = resolve;
    modalMessage.textContent = message;
    modalInput.style.display = "none";
    modalError.textContent = "";
    modalCancelBtn.style.display = options.okOnly ? "none" : "inline-flex";
    modalOverlay.style.display = "flex";
    modalOkBtn.focus();
  });
}

function notify(message) {
  return askConfirm(message, { okOnly: true });
}

newNoteBtn.onclick = createNote;
emptyNewNoteBtn.onclick = createNote;

searchInput.oninput = (e) => {
  query = e.target.value;
  clearSearchBtn.style.display = query ? "flex" : "none";
  render();
};

clearSearchBtn.onclick = () => {
  query = "";
  searchInput.value = "";
  clearSearchBtn.style.display = "none";
  render();
};


modalOverlay.addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  const controls = [modalInput, modalCancelBtn, modalOkBtn].filter(el => el.style.display !== "none");
  const index = controls.indexOf(document.activeElement);
  e.preventDefault();
  controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
});

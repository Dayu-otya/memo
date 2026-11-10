

function getPlainTextFromEditable(el) {
  if (el.childNodes.length === 1 && el.firstChild.nodeName === "BR") return "";
  const lines = [];
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (lines.length === 0) lines.push("");
      lines[lines.length - 1] += node.textContent;
    } else if (node.nodeName === "BR") {
      lines.push("");
    } else if (node.nodeName === "DIV" || node.nodeName === "P") {
      lines.push(getPlainTextFromEditable(node));
    } else {
      if (lines.length === 0) lines.push("");
      lines[lines.length - 1] += node.textContent;
    }
  });
  return lines.join("\n");
}

function getCaretOffset(el) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) && range.startContainer !== el) return null;

  if (range.startContainer === el) {
    const isHidden = (node) =>
      node.classList && (node.classList.contains("md-code-warning") || node.classList.contains("md-math-preview") || node.classList.contains("md-code-toolbar") || node.classList.contains("md-table-preview"));
    const visibleChildren = Array.from(el.childNodes).filter((node) => !isHidden(node));
    let visibleCountBeforeOffset = 0;
    for (let i = 0; i < range.startOffset && i < el.childNodes.length; i++) {
      if (!isHidden(el.childNodes[i])) {
        visibleCountBeforeOffset++;
      }
    }
    let offset = 0;
    for (let i = 0; i < visibleCountBeforeOffset; i++) {
      if (i > 0) offset += 1;
      offset += (visibleChildren[i].textContent || "").length;
    }
    if (visibleCountBeforeOffset > 0 && visibleCountBeforeOffset < visibleChildren.length) offset += 1;
    return offset;
  }

  let offset = 0;
  let found = false;

  function walkInline(node) {
    if (found) return;
    if (node === range.startContainer && node.nodeType === Node.TEXT_NODE) {
      offset += range.startOffset;
      found = true;
      return;
    }
    if (node === range.startContainer) {
      for (const child of Array.from(node.childNodes).slice(0, range.startOffset)) offset += child.textContent.length;
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent.length;
      return;
    }
    if (node.nodeName === "BR") {
      if (node === range.startContainer) {
        found = true;
        return;
      }
      return;
    }
    for (const child of node.childNodes) {
      walkInline(child);
      if (found) return;
    }
    if (node === range.startContainer) found = true;
  }

  const topLevelNodes = Array.from(el.childNodes).filter(
    (node) => !(node.classList && (node.classList.contains("md-code-warning") || node.classList.contains("md-math-preview") || node.classList.contains("md-code-toolbar") || node.classList.contains("md-table-preview")))
  );
  topLevelNodes.forEach((node, idx) => {
    if (found) return;
    if (idx > 0) offset += 1;
    walkInline(node);
  });

  return offset;
}

function setCaretOffset(el, offset) {
  const sel = window.getSelection();
  if (!sel) return;
  let remaining = offset;
  let targetNode = null;
  let targetOffset = 0;

  function walkInline(node) {
    if (targetNode) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent.length;
      if (remaining <= len) {
        targetNode = node;
        targetOffset = remaining;
        remaining = -1;
      } else {
        remaining -= len;
      }
      return;
    }
    if (node.nodeName === "BR") {
      if (remaining <= 0) {
        targetNode = node.parentNode;
        targetOffset = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
        remaining = -1;
      }
      return;
    }
    for (const child of node.childNodes) {
      walkInline(child);
      if (targetNode) return;
    }
  }

  const topLevelNodes = Array.from(el.childNodes).filter(
    (node) => !(node.classList && (node.classList.contains("md-code-warning") || node.classList.contains("md-math-preview") || node.classList.contains("md-code-toolbar") || node.classList.contains("md-table-preview")))
  );
  topLevelNodes.forEach((node, idx) => {
    if (targetNode) return;
    if (idx > 0) {
      if (remaining <= 0) {
        targetNode = el;
        targetOffset = Array.prototype.indexOf.call(el.childNodes, node);
        remaining = -1;
        return;
      }
      remaining -= 1;
    }
    walkInline(node);
  });

  if (!targetNode) {
    targetNode = el;
    targetOffset = el.childNodes.length;
  }

  const range = document.createRange();
  try {
    range.setStart(targetNode, targetOffset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (e) {
  }
}

function buildEditableHtml(text) {
  const rawLines = text.split("\n");
  const htmlLines = [];
  let i = 0;

  while (i < rawLines.length) {
    const rawLine = rawLines[i];
    const fenceMatch = rawLine.match(/^```\s*([a-zA-Z0-9_+-]*)\s*$/);

    if (fenceMatch) {
      const lang = (fenceMatch[1] || "").toLowerCase();
      htmlLines.push(`<div>${escapeHtml(rawLine)}</div>`);
      i++;
      const codeStart = i;
      while (i < rawLines.length && !/^```\s*$/.test(rawLines[i])) {
        const escaped = escapeHtml(rawLines[i]);
        const highlighted = highlightCodeLine(escaped, lang) || "";
        htmlLines.push(`<div class="code-line-editable">${highlighted || "<br>"}</div>`);
        i++;
      }
      if (i < rawLines.length) {
        htmlLines.push(`<div>${escapeHtml(rawLines[i])}</div>`);
        i++;
      }
      continue;
    }

    const escaped = escapeHtml(rawLine);
    htmlLines.push(`<div>${escaped || "<br>"}</div>`);
    i++;
  }

  if (htmlLines.length > 0) {
    htmlLines[0] = markAsTitleLine(htmlLines[0]);
  }

  return htmlLines.join("");
}

function refreshEditableHighlight() {
  const active = getActive();
  if (!active) return;
  const caret = getCaretOffset(bodyInput);
  bodyInput.innerHTML = buildEditableHtml(active.body);
  if (caret !== null) setCaretOffset(bodyInput, caret);
}

function updateCounts(body) {
  const charCount = Array.from(body).length;
  const lineCount = body.length === 0 ? 1 : body.split("\n").length;
  charCountEl.textContent = `${charCount}文字`;
  lineCountEl.textContent = `${lineCount}行`;
}


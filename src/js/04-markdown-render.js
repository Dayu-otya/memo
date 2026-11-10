

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderMarkdown(text) {
  const rawLines = text.split("\n");
  const htmlLines = [];
  let openBlock = null;
  let i = 0;

  function closeBlock() {
    if (openBlock) {
      htmlLines.push(`</${openBlock}>`);
      openBlock = null;
    }
  }

  function ensureBlock(tag) {
    if (openBlock !== tag) {
      closeBlock();
      htmlLines.push(`<${tag}>`);
      openBlock = tag;
    }
  }

  while (i < rawLines.length) {
    const rawLine = rawLines[i];
    const fenceMatch = rawLine.match(/^```\s*([a-zA-Z0-9_+-]*)\s*$/);

    if (fenceMatch) {
      closeBlock();
      const lang = (fenceMatch[1] || "").toLowerCase();
      const codeLines = [];
      i++;
      while (i < rawLines.length && !/^```\s*$/.test(rawLines[i])) {
        codeLines.push(rawLines[i]);
        i++;
      }
      i++;
      htmlLines.push(renderCodeBlock(codeLines, lang));
      continue;
    }

    if (/^\$\$\s*$/.test(rawLine)) {
      closeBlock();
      const mathLines = [];
      i++;
      while (i < rawLines.length && !/^\$\$\s*$/.test(rawLines[i])) {
        mathLines.push(rawLines[i]);
        i++;
      }
      i++;
      const tex = mathLines.join("\n");
      htmlLines.push(`<div class="md-math-block">${renderKatexSafe(escapeHtml(tex), true)}</div>`);
      continue;
    }

    if (rawLine.includes("|") && i + 1 < rawLines.length && isTableSeparatorRow(rawLines[i + 1])) {
      closeBlock();
      const headerCells = splitTableRow(rawLine);
      const aligns = tableAligns(splitTableRow(rawLines[i + 1]));
      i += 2;
      const bodyRows = [];
      while (i < rawLines.length && rawLines[i].includes("|") && rawLines[i].trim() !== "") {
        bodyRows.push(splitTableRow(rawLines[i]));
        i++;
      }
      htmlLines.push(renderTableHtml(headerCells, aligns, bodyRows));
      continue;
    }

    const cls = classifyLine(rawLine);

    if (cls.type === "heading") {
      closeBlock();
      htmlLines.push(`<h${cls.level}>${inlineMd(escapeHtml(cls.content))}</h${cls.level}>`);
      i++;
      continue;
    }

    if (cls.type === "checkbox") {
      ensureBlock("ul");
      const checkedAttr = cls.checked ? " checked" : "";
      htmlLines.push(
        `<li class="md-checkbox-item"><input type="checkbox" disabled${checkedAttr} />${inlineMd(escapeHtml(cls.content))}</li>`
      );
      i++;
      continue;
    }

    if (cls.type === "ordered") {
      ensureBlock("ol");
      htmlLines.push(`<li>${inlineMd(escapeHtml(cls.content))}</li>`);
      i++;
      continue;
    }

    if (cls.type === "list") {
      ensureBlock("ul");
      htmlLines.push(`<li>${inlineMd(escapeHtml(cls.content))}</li>`);
      i++;
      continue;
    }

    if (cls.type === "quote") {
      ensureBlock("blockquote");
      htmlLines.push(`<p>${inlineMd(escapeHtml(cls.content))}</p>`);
      i++;
      continue;
    }

    if (cls.type === "hr") {
      closeBlock();
      htmlLines.push("<hr />");
      i++;
      continue;
    }

    closeBlock();

    const line = escapeHtml(rawLine);
    if (line.trim() === "") {
      htmlLines.push("<br>");
    } else {
      htmlLines.push(`<p>${inlineMd(line)}</p>`);
    }
    i++;
  }
  closeBlock();
  return htmlLines.join("\n");
}

function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);
  const cells = [];
  let current = "";
  for (let idx = 0; idx < trimmed.length; idx++) {
    const ch = trimmed[idx];
    if (ch === "\\" && trimmed[idx + 1] === "|") {
      current += "|";
      idx++;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isTableSeparatorRow(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes("-")) return false;
  const cells = splitTableRow(trimmed);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{1,}:?$/.test(c));
}

function tableAligns(sepCells) {
  return sepCells.map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });
}

function renderTableHtml(headerCells, aligns, bodyRows) {
  const alignStyle = (idx) => (aligns[idx] ? ` style="text-align:${aligns[idx]}"` : "");
  const thead = headerCells
    .map((c, idx) => `<th${alignStyle(idx)}>${inlineMd(escapeHtml(c))}</th>`)
    .join("");
  const tbody = bodyRows
    .map((row) => {
      const tds = headerCells
        .map((_, idx) => `<td${alignStyle(idx)}>${inlineMd(escapeHtml(row[idx] !== undefined ? row[idx] : ""))}</td>`)
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return `<table class="md-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function classifyLine(rawLine) {
  const heading = rawLine.match(/^(#{1,6})\s+(.*)$/);
  if (heading) return { type: "heading", level: heading[1].length, content: heading[2] };
  const checkbox = rawLine.match(/^([-*])\s+\[([ xX])\]\s+(.*)$/);
  if (checkbox) {
    return { type: "checkbox", marker: checkbox[1], checked: checkbox[2].toLowerCase() === "x", content: checkbox[3] };
  }
  const orderedItem = rawLine.match(/^(\d+)\.\s+(.*)$/);
  if (orderedItem) return { type: "ordered", number: orderedItem[1], content: orderedItem[2] };
  const listItem = rawLine.match(/^([-*])\s+(.*)$/);
  if (listItem) return { type: "list", marker: listItem[1], content: listItem[2] };
  const quote = rawLine.match(/^>\s?(.*)$/);
  if (quote) return { type: "quote", content: quote[1] };
  if (/^(---|\*\*\*)\s*$/.test(rawLine.trim())) return { type: "hr", content: "" };
  return { type: "text", content: rawLine };
}

function buildFormattedLineHtml(rawLine) {
  const escaped = escapeHtml(rawLine);
  const cls = classifyLine(rawLine);
  if (cls.type === "heading") {
    return `<h${cls.level} class="md-line-content">${inlineMd(escapeHtml(cls.content)) || "<br>"}</h${cls.level}>`;
  }
  if (cls.type === "checkbox") {
    const checkedAttr = cls.checked ? " checked" : "";
    const checkedClass = cls.checked ? " md-checked" : "";
    return `<div class="md-line-content md-checkbox-item${checkedClass}"><input type="checkbox" class="md-checkbox" contenteditable="false"${checkedAttr} />${inlineMd(escapeHtml(cls.content)) || "<br>"}</div>`;
  }
  if (cls.type === "ordered") {
    return `<div class="md-line-content md-ordered-item"><span class="md-ordered-number">${escapeHtml(cls.number)}.</span>${inlineMd(escapeHtml(cls.content)) || "<br>"}</div>`;
  }
  if (cls.type === "list") {
    return `<div class="md-line-content md-list-item">${inlineMd(escapeHtml(cls.content)) || "<br>"}</div>`;
  }
  if (cls.type === "quote") {
    return `<div class="md-line-content md-quote-item">${inlineMd(escapeHtml(cls.content)) || "<br>"}</div>`;
  }
  if (cls.type === "hr") {
    return `<div class="md-line-content md-hr-item"><hr /></div>`;
  }
  if (escaped.trim() === "") {
    return `<div class="md-line-content"><br></div>`;
  }
  return `<div class="md-line-content">${inlineMd(escaped)}</div>`;
}

function buildRawLineHtml(rawLine) {
  const escaped = escapeHtml(rawLine);
  return `<div class="md-line-raw">${escaped || "<br>"}</div>`;
}

function buildMdEditableHtml(text, activeLineIndex) {
  const rawLines = text.split("\n");
  const htmlLines = [];
  let i = 0;

  while (i < rawLines.length) {
    const rawLine = rawLines[i];
    const fenceMatch = rawLine.match(/^```\s*([a-zA-Z0-9_+-]*)\s*$/);

    if (fenceMatch) {
      const lang = (fenceMatch[1] || "").toLowerCase();
      htmlLines.push(`<div class="md-line-raw" data-line="${i}">${escapeHtml(rawLine)}</div>`);
      i++;
      const codeStartLine = i;
      const codeBlockLines = [];
      while (i < rawLines.length && !/^```\s*$/.test(rawLines[i])) {
        codeBlockLines.push(rawLines[i]);
        i++;
      }
      const issues = checkCodeSyntax(codeBlockLines, lang);
      if (codeBlockLines.length > 0) {
        const guessedLang = !lang ? guessLanguage(codeBlockLines) : "";
        const langBadge = lang ? escapeHtml(lang) : guessedLang ? `${escapeHtml(guessedLang)}(自動判定)` : "";
        htmlLines.push(
          `<div class="md-code-toolbar" contenteditable="false">` +
            (langBadge ? `<span class="md-code-toolbar-lang">${langBadge}</span>` : "") +
            `<button type="button" class="code-block-copy-btn" data-copy-block>コピー</button>` +
            `</div>`
        );
      }
      codeBlockLines.forEach((rawCodeLine, offsetInBlock) => {
        const lineNo = offsetInBlock + 1;
        const absoluteLine = codeStartLine + offsetInBlock;
        const escaped = escapeHtml(rawCodeLine);
        const highlighted = highlightCodeLine(escaped, lang) || "";
        const lineIssues = issues.filter((iss) => iss.line === lineNo);
        const issueClass = lineIssues.length > 0 ? " code-line-issue" : "";
        const issueAttr = lineIssues.length > 0 ? ` title="${escapeHtml(lineIssues.map((iss) => iss.message).join(" / "))}"` : "";
        htmlLines.push(
          `<div class="md-line-code${issueClass}" data-line="${absoluteLine}"${issueAttr}><span class="code-line-text">${highlighted || "<br>"}</span></div>`
        );

        lineIssues.forEach((iss) => {
          htmlLines.push(
            `<div class="md-code-warning md-code-line-warning" contenteditable="false">⚠ ${escapeHtml(iss.message)}</div>`
          );
        });
      });
      if (issues.length > 0) {
        const warningText = issues.map((iss) => `${iss.line}行目 - ${iss.message}`).join(" / ");
        htmlLines.push(
          `<div class="md-code-warning" contenteditable="false">⚠ ${issues.length}件の構文の問題があります(実行はしていません): ${escapeHtml(warningText)}</div>`
        );
      }
      if (i < rawLines.length) {
        htmlLines.push(`<div class="md-line-raw" data-line="${i}">${escapeHtml(rawLines[i])}</div>`);
        i++;
      }
      continue;
    }

    if (/^\$\$\s*$/.test(rawLine)) {
      htmlLines.push(`<div class="md-line-raw" data-line="${i}">${escapeHtml(rawLine)}</div>`);
      i++;
      const mathStartLine = i;
      const mathLines = [];
      while (i < rawLines.length && !/^\$\$\s*$/.test(rawLines[i])) {
        mathLines.push(rawLines[i]);
        i++;
      }
      mathLines.forEach((rawMathLine, offset) => {
        const absoluteLine = mathStartLine + offset;
        htmlLines.push(`<div class="md-line-raw" data-line="${absoluteLine}">${escapeHtml(rawMathLine) || "<br>"}</div>`);
      });
      if (mathLines.length > 0) {
        const tex = mathLines.join("\n");
        htmlLines.push(
          `<div class="md-math-preview" contenteditable="false">${renderKatexSafe(escapeHtml(tex), true)}</div>`
        );
      }
      if (i < rawLines.length) {
        htmlLines.push(`<div class="md-line-raw" data-line="${i}">${escapeHtml(rawLines[i])}</div>`);
        i++;
      }
      continue;
    }

    if (rawLine.includes("|") && i + 1 < rawLines.length && isTableSeparatorRow(rawLines[i + 1])) {
      const headerCells = splitTableRow(rawLine);
      const aligns = tableAligns(splitTableRow(rawLines[i + 1]));
      htmlLines.push(`<div class="md-line-raw" data-line="${i}">${escapeHtml(rawLine) || "<br>"}</div>`);
      htmlLines.push(`<div class="md-line-raw" data-line="${i + 1}">${escapeHtml(rawLines[i + 1]) || "<br>"}</div>`);
      i += 2;
      const bodyRows = [];
      while (i < rawLines.length && rawLines[i].includes("|") && rawLines[i].trim() !== "") {
        bodyRows.push(splitTableRow(rawLines[i]));
        htmlLines.push(`<div class="md-line-raw" data-line="${i}">${escapeHtml(rawLines[i]) || "<br>"}</div>`);
        i++;
      }
      htmlLines.push(
        `<div class="md-table-preview" contenteditable="false">${renderTableHtml(headerCells, aligns, bodyRows)}</div>`
      );
      continue;
    }

    const isActive = i === activeLineIndex;
    if (isActive) {
      htmlLines.push(`<div class="md-line-raw" data-line="${i}">${escapeHtml(rawLine) || "<br>"}</div>`);
    } else {
      const formatted = buildFormattedLineHtml(rawLine);
      const withAttr = formatted.replace(/^<(\w+)/, `<$1 data-line="${i}"`);
      htmlLines.push(withAttr);
    }
    i++;
  }

  if (htmlLines.length > 0) {
    htmlLines[0] = markAsTitleLine(htmlLines[0]);
  }

  return htmlLines.join("");
}

function unescapeHtml(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function renderKatexSafe(tex, displayMode) {
  const rawTex = unescapeHtml(tex);
  if (!window.katex) {

    ensureKatexLoaded();
    return `<code class="katex-error">${tex}</code>`;
  }
  try {
    return window.katex.renderToString(rawTex, { throwOnError: false, displayMode });
  } catch (e) {
    return `<span class="katex-error" title="${escapeHtml(String(e.message || e))}">${tex}</span>`;
  }
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function inlineMd(text) {
  const placeholders = [];
  function protect(html) {
    placeholders.push(html);
    return `\u0000P${placeholders.length - 1}\u0000`;
  }

  let s = text;
  s = s.replace(/`([^`]+?)`/g, (_, code) => protect(`<code class="inline-code">${code}</code>`));

  s = s.replace(/\$\$(.+?)\$\$/g, (_, tex) => protect(renderKatexSafe(tex.trim(), true)));

  s = s.replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, tex) => protect(renderKatexSafe(tex.trim(), false)));
  

  s = s.replace(/\*\*\*(.+?)\*\*\*/g, (_, inner) => protect(`<strong><em>${inner}</em></strong>`));

  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  s = s.replace(/(^|[^\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "$1<em>$2</em>");
  s = s
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/)(?:[^\s()]|\([^\s()]*\))+)\)/g, (_, label, url) =>
      protect(`<a href="#" class="external-link" data-url="${escapeAttr(unescapeHtml(url))}">${label}</a>`)
    )
    .replace(/\[\[(.+?)\]\]/g, (match, name) => renderNoteLink(name));

  for (let pass = 0; pass <= placeholders.length && /\u0000P\d+\u0000/.test(s); pass++) {
    s = s.replace(/\u0000P(\d+)\u0000/g, (match, idx) => placeholders[Number(idx)] ?? match);
  }
  return s;
}

const CODE_KEYWORDS = {
  javascript: [
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "class", "extends", "new", "this", "import", "export", "default", "from",
    "async", "await", "try", "catch", "finally", "throw", "switch", "case",
    "break", "continue", "typeof", "instanceof", "null", "undefined", "true", "false",
  ],
  python: [
    "def", "return", "if", "elif", "else", "for", "while", "class", "import",
    "from", "as", "try", "except", "finally", "raise", "with", "lambda",
    "None", "True", "False", "and", "or", "not", "in", "is", "pass", "break", "continue",
  ],
};
CODE_KEYWORDS.js = CODE_KEYWORDS.javascript;
CODE_KEYWORDS.py = CODE_KEYWORDS.python;

function guessLanguage(rawCodeLines) {
  const sample = rawCodeLines.join("\n");
  if (/^\s*[{[]/.test(sample.trim())) {
    try {
      JSON.parse(sample);
      return "json";
    } catch (e) {

    }
  }
  if (/^\s*(def |class .+:|import |from .+ import )/m.test(sample) || /:\s*$/m.test(sample)) {
    return "python";
  }
  if (/\b(function|const|let|var)\b.*[({]|=>|console\.log/.test(sample)) {
    return "javascript";
  }
  return "";
}

function highlightCodeLine(escapedLine, lang) {
  const placeholders = [];
  function protect(html) {
    placeholders.push(html);
    return `\u0000P${placeholders.length - 1}\u0000`;
  }

  let s = escapedLine;

  s = s.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, (m) => protect(`<span class="tok-string">${m}</span>`));
  if (lang === "python" || lang === "py") {
    s = s.replace(/(#.*)$/, (m) => protect(`<span class="tok-comment">${m}</span>`));
  } else {
    s = s.replace(/(\/\/.*)$/, (m) => protect(`<span class="tok-comment">${m}</span>`));
  }
  s = s.replace(/\b(\d+(\.\d+)?)\b/g, (m) => protect(`<span class="tok-number">${m}</span>`));
  const keywords = CODE_KEYWORDS[lang];
  if (keywords) {
    const re = new RegExp(`\\b(${keywords.join("|")})\\b`, "g");
    s = s.replace(re, (m) => protect(`<span class="tok-keyword">${m}</span>`));
  }

  for (let pass = 0; pass <= placeholders.length && /\u0000P\d+\u0000/.test(s); pass++) {
    s = s.replace(/\u0000P(\d+)\u0000/g, (match, idx) => placeholders[Number(idx)] ?? match);
  }
  return s;
}

function renderCodeBlock(rawCodeLines, lang) {
  const issues = checkCodeSyntax(rawCodeLines, lang);
  const highlightedLines = rawCodeLines.map((raw, idx) => {
    const escaped = escapeHtml(raw);
    const html = highlightCodeLine(escaped, lang) || "&nbsp;";
    const lineIssues = issues.filter((iss) => iss.line === idx + 1);
    const issueClass = lineIssues.length > 0 ? " code-line-issue" : "";
    const issueAttr = lineIssues.length > 0 ? ` title="${escapeHtml(lineIssues.map((iss) => iss.message).join(" / "))}"` : "";

    const lineHtml = `<div class="code-line${issueClass}"${issueAttr}><span class="code-line-no" data-copy-line title="クリックでこの行をコピー">${idx + 1}</span><span class="code-line-text">${html}</span></div>`;

    const inlineWarnings = lineIssues
      .map((iss) => `<div class="code-line-warning-inline">⚠ ${escapeHtml(iss.message)}</div>`)
      .join("");
    return lineHtml + inlineWarnings;
  });

  const guessedLang = !lang ? guessLanguage(rawCodeLines) : "";
  const langLabel = lang ? escapeHtml(lang) : guessedLang ? `${escapeHtml(guessedLang)}(自動判定)` : "text";
  const warningHtml =
    issues.length > 0
      ? `<div class="code-block-warning">⚠ ${issues.length}件の構文の問題があります(実行はしていません): ${issues
          .map((iss) => `${iss.line}行目 - ${escapeHtml(iss.message)}`)
          .join(" / ")}</div>`
      : "";

  return `<div class="code-block">
    <div class="code-block-header">
      <span class="code-block-lang">${langLabel}</span>
      <button type="button" class="code-block-copy-btn" data-copy-block>コピー</button>
    </div>
    <pre class="code-block-body">${highlightedLines.join("\n")}</pre>
    ${warningHtml}
  </div>`;
}

function checkCodeSyntax(rawCodeLines, lang) {
  const issues = [];
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const closers = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  let quoteChar = null;
  let quoteStartLine = null;

  rawCodeLines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;

    if (/[ \t]+$/.test(rawLine)) {
      issues.push({ line: lineNo, message: "行末に余分な空白があります" });
    }

    const indentMatch = rawLine.match(/^[ \t]+/);
    if (indentMatch && indentMatch[0].includes(" ") && indentMatch[0].includes("\t")) {
      issues.push({ line: lineNo, message: "インデントにタブとスペースが混在しています" });
    }

    for (let ci = 0; ci < rawLine.length; ci++) {
      const ch = rawLine[ci];

      if (!quoteChar) {
        if ((lang === "python" || lang === "py") && ch === "#") break;
        if (
          lang !== "python" &&
          lang !== "py" &&
          ch === "/" &&
          rawLine[ci + 1] === "/" &&
          !quoteChar
        ) {
          break;
        }
      }

      if (quoteChar) {
        if (ch === quoteChar) {

          let backslashCount = 0;
          let bi = ci - 1;
          while (bi >= 0 && rawLine[bi] === "\\") {
            backslashCount++;
            bi--;
          }
          if (backslashCount % 2 === 0) quoteChar = null;
        }
        continue;
      }

      if (ch === '"' || ch === "'" || ch === "`") {
        quoteChar = ch;
        quoteStartLine = lineNo;
        continue;
      }

      if (pairs[ch]) {
        stack.push({ char: ch, line: lineNo });
      } else if (closers[ch]) {
        const top = stack[stack.length - 1];
        if (!top || top.char !== closers[ch]) {
          issues.push({ line: lineNo, message: `対応する開き括弧のない「${ch}」があります` });
        } else {
          stack.pop();
        }
      }
    }
    if (quoteChar && quoteChar !== "`") {
      issues.push({ line: lineNo, message: `${quoteChar} が閉じられていません` });
      quoteChar = null;
    }
  });

  if (quoteChar === "`") {
    issues.push({ line: quoteStartLine, message: "テンプレート文字列(`)が閉じられていません" });
  }

  stack.forEach((item) => {
    issues.push({ line: item.line, message: `「${item.char}」が閉じられていません` });
  });

  if (lang === "json") {
    try {
      JSON.parse(rawCodeLines.join("\n"));
    } catch (e) {
      issues.push({ line: rawCodeLines.length, message: `JSONとして読み込めません: ${e.message}` });
    }
  }

  return issues;
}

function findNoteByTitle(name) {
  const target = name.trim();
  return notes.find((n) => !isTrashed(n) && titleFromBody(n.body) === target) || null;
}

function renderNoteLink(name) {
  const target = findNoteByTitle(unescapeHtml(name));
  const safeName = name.trim();
  if (target) {
    return `<a href="#" class="note-link" data-note-id="${escapeAttr(target.id)}">${safeName}</a>`;
  }
  return `<a href="#" class="note-link note-link-missing" data-note-title="${safeName}">${safeName}(新規)</a>`;
}

mdPreview.addEventListener("click", (e) => {
  const checkboxInput = e.target.closest(".md-checkbox");
  if (checkboxInput) {
    e.preventDefault();
    e.stopPropagation();
    const lineEl = checkboxInput.closest("[data-line]");
    if (!lineEl) return;
    const lineIndex = Number(lineEl.getAttribute("data-line"));
    const active = getActive();
    if (!active) return;
    const rawLines = active.body.split("\n");
    const rawLine = rawLines[lineIndex];
    if (rawLine === undefined) return;
    const match = rawLine.match(/^(\s*[-*]\s+\[)([ xX])(\]\s+.*)$/);
    if (!match) return;
    const newMark = match[2].toLowerCase() === "x" ? " " : "x";
    rawLines[lineIndex] = match[1] + newMark + match[3];
    mdPushUndoSnapshot(active);
    active.body = rawLines.join("\n");
    active.updatedAt = Date.now();
    updateCounts(active.body);
    persist();
    renderList();
    refreshMdPreview();
    return;
  }
  if (e.target.closest("[data-copy-block], [data-copy-line]")) {
    handleCodeCopyClick(e);
    return;
  }
  const externalLink = e.target.closest(".external-link");
  if (externalLink) {
    e.preventDefault();
    const url = externalLink.getAttribute("data-url");
    if (url && window.shellAPI) {
      window.shellAPI.openExternal(url);
    }
    return;
  }
  const link = e.target.closest(".note-link");
  if (!link) return;
  e.preventDefault();
  const noteId = link.getAttribute("data-note-id");
  if (noteId) {
    clearSelection();
    activeId = noteId;
    viewMode = "editor";
    render();
    return;
  }
  const title = link.getAttribute("data-note-title");
  if (title) {
    const n = normalizeNote({
      id: uid(),
      body: title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      folderId: activeFolderId || "",
    });
    notes.unshift(n);
    activeId = n.id;
    viewMode = "editor";
    persist();
    render();
  }
});

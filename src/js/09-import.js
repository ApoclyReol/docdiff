async function extractPdfText(arrayBuffer) {
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
  const pageSections = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const pageHeight = viewport.height || 842;
    const textContent = await page.getTextContent();

    let lastY = null;
    let currentLine = '';
    let currentLineY = 0;
    const rawLines = [];

    for (const item of textContent.items) {
      const str = item.str;
      if (!str) continue;
      const y = item.transform ? item.transform[5] : 0;

      if (lastY !== null && Math.abs(y - lastY) > 5.5) {
        if (currentLine.trim()) {
          rawLines.push({ text: currentLine.trim(), y: currentLineY });
        }
        if (Math.abs(y - lastY) > 15) {
          rawLines.push({ text: '', y });
        }
        currentLine = str;
        currentLineY = y;
      } else {
        if (!currentLine) currentLineY = y;
        currentLine += (currentLine && !currentLine.endsWith(' ') && !str.startsWith(' ') ? ' ' : '') + str;
      }
      lastY = y;
    }
    if (currentLine.trim()) {
      rawLines.push({ text: currentLine.trim(), y: currentLineY });
    }

    const paragraphs = [`=== [SEITE ${pageNum}] ===`];
    let buffer = '';

    for (let i = 0; i < rawLines.length; i++) {
      const entry = rawLines[i];
      const line = entry.text;
      if (!line) {
        if (buffer) {
          paragraphs.push(buffer);
          buffer = '';
        }
        continue;
      }

      const inTopOrBottomMargin =
        pdf.numPages > 1 &&
        (entry.y > pageHeight * 0.91 || entry.y < pageHeight * 0.085) &&
        line.length < 120;

      if (inTopOrBottomMargin || isLikelyHeaderOrFooterLine(line)) {
        if (buffer) {
          paragraphs.push(buffer);
          buffer = '';
        }
        paragraphs.push(`[[HF]] ${line}`);
        continue;
      }

      const isNewStructuralBlock =
        /^(§\s*\d+|\(\d+\)|\d+\.\d+|\d+\.|[•‣▪◦–*-]\s|\([a-z]\)|[a-z]\)|Artikel\s+\d+|Anlage\s+\d+|Section\s+\d+|Exhibit\s+[A-Z0-9]+)/i.test(
          line
        );
      if (isNewStructuralBlock && buffer) {
        paragraphs.push(buffer);
        buffer = line;
      } else {
        buffer = buffer ? `${buffer} ${line}` : line;
      }
    }
    if (buffer) paragraphs.push(buffer);
    pageSections.push(paragraphs.join('\n\n'));
  }
  return pageSections.join('\n\n');
}

async function extractDocxText(arrayBuffer) {
  if (window.mammoth && typeof window.mammoth.convertToHtml === 'function') {
    const htmlResult = await window.mammoth.convertToHtml({ arrayBuffer });
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlResult.value || '', 'text/html');
    const out = [];

    const walkNodes = root => {
      for (const node of root.children) {
        const tag = node.tagName.toLowerCase();
        if (tag === 'h1') {
          const txt = (node.textContent || '').trim();
          if (txt) out.push(`# ${txt}`);
        } else if (tag === 'h2') {
          const txt = (node.textContent || '').trim();
          if (txt) out.push(`## ${txt}`);
        } else if (tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
          const txt = (node.textContent || '').trim();
          if (txt) out.push(`### ${txt}`);
        } else if (tag === 'ul') {
          node.querySelectorAll(':scope > li').forEach(li => {
            const txt = (li.textContent || '').replace(/\s+/g, ' ').trim();
            if (txt) out.push(`• ${txt}`);
          });
        } else if (tag === 'ol') {
          let idx = 1;
          node.querySelectorAll(':scope > li').forEach(li => {
            const txt = (li.textContent || '').replace(/\s+/g, ' ').trim();
            if (txt) out.push(`(${idx++}) ${txt}`);
          });
        } else if (tag === 'table') {
          node.querySelectorAll('tr').forEach(tr => {
            const cells = Array.from(tr.querySelectorAll('th, td'))
              .map(c => (c.textContent || '').replace(/\s+/g, ' ').trim())
              .filter(Boolean);
            if (cells.length) out.push(cells.join(' · '));
          });
        } else if (tag === 'p') {
          const txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (txt) out.push(txt);
        } else if (node.children && node.children.length > 0) {
          walkNodes(node);
        } else {
          const txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (txt) out.push(txt);
        }
      }
    };

    walkNodes(doc.body);
    if (out.length > 0) return out.join('\n\n');
  }

  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function handleFileUpload(file, side) {
  if (!file) return;
  const fnLabel = document.getElementById(side === 'left' ? 'filename-left' : 'filename-right');
  const prevName = fnLabel.textContent;
  fnLabel.textContent = `${t('readingFile')} ${file.name}…`;

  try {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let extractedText = '';

    if (ext === 'pdf') {
      const buffer = await file.arrayBuffer();
      extractedText = await extractPdfText(buffer);
    } else if (ext === 'docx') {
      const buffer = await file.arrayBuffer();
      extractedText = await extractDocxText(buffer);
    } else {
      extractedText = await file.text();
    }

    if (side === 'left') {
      state.leftName = file.name;
      state.leftFormat = ext.toUpperCase() || 'TEXT';
      state.leftText = extractedText;
    } else {
      state.rightName = file.name;
      state.rightFormat = ext.toUpperCase() || 'TEXT';
      state.rightText = extractedText;
    }
    runComparison();
  } catch (err) {
    fnLabel.textContent = prevName;
    alert(`${t('readError')} "${file.name}": ${err.message}`);
  }
}

let dragCounter = 0;
window.addEventListener('dragenter', e => {
  if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
    dragCounter++;
    document.body.classList.add('is-dragging-file');
  }
});
window.addEventListener('dragleave', () => {
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) document.body.classList.remove('is-dragging-file');
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragCounter = 0;
  document.body.classList.remove('is-dragging-file');
});

async function handleDropFiles(files, targetSide) {
  if (!files || !files.length) return;
  if (files.length >= 2) {
    await handleFileUpload(files[0], 'left');
    await handleFileUpload(files[1], 'right');
  } else {
    await handleFileUpload(files[0], targetSide);
  }
}

[
  { el: paneLeft, side: 'left' },
  { el: paneRight, side: 'right' },
  { el: paneUnified, side: 'right' },
  { el: document.querySelector('.col-bar-left'), side: 'left' },
  { el: document.querySelector('.col-bar-right'), side: 'right' },
].forEach(({ el, side }) => {
  if (!el) return;
  el.addEventListener('dragover', e => {
    e.preventDefault();
    (side === 'left' ? paneLeft : paneRight).classList.add('drag-over');
  });
  el.addEventListener('dragleave', () => {
    (side === 'left' ? paneLeft : paneRight).classList.remove('drag-over');
  });
  el.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    document.body.classList.remove('is-dragging-file');
    paneLeft.classList.remove('drag-over');
    paneRight.classList.remove('drag-over');
    const actualSide = !state.leftText ? 'left' : side;
    await handleDropFiles(e.dataTransfer.files, actualSide);
  });
});

const fileInputLeft = document.getElementById('file-input-left');
const fileInputRight = document.getElementById('file-input-right');
document.getElementById('btn-upload-left').addEventListener('click', () => fileInputLeft.click());
document.getElementById('btn-upload-right').addEventListener('click', () => fileInputRight.click());
fileInputLeft.addEventListener('change', e => handleFileUpload(e.target.files[0], 'left'));
fileInputRight.addEventListener('change', e => handleFileUpload(e.target.files[0], 'right'));

document.getElementById('btn-clear-left').addEventListener('click', () => {
  state.leftText = '';
  state.leftName = '';
  state.leftFormat = '';
  fileInputLeft.value = '';
  runComparison();
});

document.getElementById('btn-clear-right').addEventListener('click', () => {
  state.rightText = '';
  state.rightName = '';
  state.rightFormat = '';
  state.undoStack = [];
  state.redoStack = [];
  fileInputRight.value = '';
  runComparison();
});

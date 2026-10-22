/* ── Client-Side Multi-Format Export Engine (PDF, Word .doc, HTML, Markdown) */
function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildExportHtmlDocument(forWord = false) {
  const rows = state.onlyChanges ? state.changeRows : state.alignedRows;
  const title = `Doc Diff — ${state.leftName || 'Original'} vs. ${state.rightName || 'Revised'}`;
  const bodyRows = rows
    .map(row => {
      const primaryBlock = row.rightBlock || row.leftBlock;
      const isHeading = primaryBlock && primaryBlock.isHeading;
      const tag = isHeading ? 'h3' : 'p';
      const borderColor =
        row.type === 'modified'
          ? '#0058b8'
          : row.type === 'inserted'
          ? '#2a9d4e'
          : row.type === 'deleted'
          ? '#b30027'
          : 'transparent';
      const bgColor =
        row.type === 'inserted'
          ? '#f2fbf5'
          : row.type === 'deleted'
          ? '#fff5f7'
          : 'transparent';
      return `<${tag} style="margin:0 0 8px 0;padding:4px 10px;border-left:3px solid ${borderColor};background:${bgColor};font-size:${
        isHeading ? '13px' : '11.5px'
      };line-height:1.5;">${renderUnifiedBlockHtml(row, '')}</${tag}>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${state.lang}">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #1e293b; max-width: 820px; margin: 32px auto; padding: 0 20px; font-size: 12px; line-height: 1.5; }
  header { border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 20px; }
  h1 { font-size: 16px; margin: 0 0 4px 0; }
  .meta { font-size: 11px; color: #64748b; }
  del.tok-del { background: #ffe4e8; color: #b30027; text-decoration: line-through; padding: 1px 3px; border-radius: 2px; }
  ins.tok-ins { background: #dcfce7; color: #166534; text-decoration: none; font-weight: 600; padding: 1px 3px; border-radius: 2px; }
</style>
</head>
<body>
  <header>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${escapeHtml(t('colLeft'))}: ${escapeHtml(state.leftName || '-')} · ${escapeHtml(t('colRight'))}: ${escapeHtml(state.rightName || '-')} · ${state.changeRows.length} ${escapeHtml(t('changesLabel'))}</div>
  </header>
  <main>
${bodyRows}
  </main>
</body>
</html>`;
}

function buildExportMarkdown() {
  const rows = state.onlyChanges ? state.changeRows : state.alignedRows;
  const lines = [
    `# Doc Diff: ${state.leftName || 'Original'} vs. ${state.rightName || 'Revised'}`,
    '',
    `- **${t('colLeft')}:** ${state.leftName || '-'}`,
    `- **${t('colRight')}:** ${state.rightName || '-'}`,
    `- **${t('sidebarTitle')}:** ${state.changeRows.length}`,
    '',
    '---',
    '',
  ];

  for (const row of rows) {
    const primaryBlock = row.rightBlock || row.leftBlock;
    const prefix = primaryBlock && primaryBlock.isHeading ? '### ' : '';
    if (row.type === 'equal') {
      lines.push(`${prefix}${row.rightBlock.text}`);
    } else if (row.type === 'deleted') {
      lines.push(`${prefix}~~${row.leftBlock.text}~~`);
    } else if (row.type === 'inserted') {
      lines.push(`${prefix}**${row.rightBlock.text}**`);
    } else if (row.type === 'modified') {
      const mdDiff = coalesceUnifiedTokens(row.wordDiffs)
        .map(p => (p.removed ? `~~${p.value}~~` : p.added ? `**${p.value}**` : p.value))
        .join('');
      lines.push(`${prefix}${mdDiff}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

let copyLabelTimer = null;
function copyFinalTextToClipboard() {
  const finalText = state.alignedRows
    .filter(r => r.rightBlock && !r.rightBlock.isHeaderFooter)
    .map(r => r.rightBlock.text)
    .join('\n\n');

  const flashCopied = () => {
    const labelEl = document.getElementById('i18n-btn-export');
    const mobLabelEl = document.getElementById('i18n-mob-export');
    if (labelEl) labelEl.textContent = t('copiedLabel');
    if (mobLabelEl) mobLabelEl.textContent = t('copiedLabel');
    clearTimeout(copyLabelTimer);
    copyLabelTimer = setTimeout(() => {
      if (labelEl) labelEl.textContent = t('exportBtn');
      if (mobLabelEl) mobLabelEl.textContent = t('mobExport');
    }, 1800);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(finalText).then(flashCopied).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = finalText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      flashCopied();
    });
  } else {
    const ta = document.createElement('textarea');
    ta.value = finalText;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    flashCopied();
  }
}

function handleExportAction(type) {
  if (type === 'print') {
    window.print();
    return;
  }
  if (!state.alignedRows.length) {
    const sample = SAMPLES[state.lang] || SAMPLES.de;
    state.leftName = t('sampleLeftName');
    state.leftFormat = 'DEMO';
    state.leftText = sample.v1;
    state.rightName = t('sampleRightName');
    state.rightFormat = 'DEMO';
    state.rightText = sample.v2;
    runComparison();
  }
  if (type === 'copy') {
    copyFinalTextToClipboard();
    return;
  }
  const baseName = `DocDiff_${(state.rightName || 'Comparison').replace(/\.[^.]+$/, '')}`;
  if (type === 'txt') {
    const finalText = state.alignedRows
      .filter(r => r.rightBlock && !r.rightBlock.isHeaderFooter)
      .map(r => r.rightBlock.text)
      .join('\n\n');
    downloadBlob(finalText, 'text/plain;charset=utf-8', `${baseName}_Neu.txt`);
  } else if (type === 'word') {
    const html = buildExportHtmlDocument(true);
    downloadBlob('\ufeff' + html, 'application/msword;charset=utf-8', `${baseName}_Redline.doc`);
  } else if (type === 'html') {
    const html = buildExportHtmlDocument(false);
    downloadBlob(html, 'text/html;charset=utf-8', `${baseName}_Report.html`);
  } else if (type === 'md') {
    const md = buildExportMarkdown();
    downloadBlob(md, 'text/markdown;charset=utf-8', `${baseName}_Report.md`);
  }
}

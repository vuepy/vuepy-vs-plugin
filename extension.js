/**
 * Vue <script lang="py"> 跳转、悬停、引用：用临时 .py 文件转发给 Pylance（仅 file: 才生效）。
 */
function activate(context) {
  const vscode = require('vscode');
  const path = require('path');
  const fs = require('fs');
  const crypto = require('crypto');

  const CACHE_DIR_IN_WORKSPACE = '.vue-py-cache';
  const TEMP_SUBDIR = 'vue-py-scripts';

  /** 从 Vue 文档中解析 <script lang="py"> 块：{ content, startLine1Based } 或 null */
  function getScriptPyBlock(text) {
    const re = /<script\s+[^>]*lang\s*=\s*["']py["'][^>]*>([\s\S]*?)<\/script>/i;
    const m = text.match(re);
    if (!m) return null;
    const content = m[1] || '';
    const contentStartIndex = m.index + m[0].indexOf('>') + 1;
    const startLine1Based = text.slice(0, contentStartIndex).split(/\r?\n/).length;
    return { content, startLine1Based };
  }

  /** 判断 position 是否在 script py 块内 */
  function isInScriptPy(document, position) {
    const block = getScriptPyBlock(document.getText());
    if (!block) return null;
    const line = position.line + 1;
    const endLine = block.startLine1Based + block.content.split(/\r?\n/).length - 1;
    if (line < block.startLine1Based || line > endLine) return null;
    return block;
  }

  /** 将原始 script 内容包入 setup 函数：def setup(props, ctx, app): + 缩进内容 + return locals() */
  function wrapInSetup(rawContent) {
    const lines = rawContent.split(/\r?\n/);
    const indented = lines.map((line) => '    ' + line).join('\n');
    return 'def setup(props, ctx, app):\n' + indented + '\n    return locals()\n';
  }

  const INDENT = 4; // 临时文件中每行原内容前的空格数

  /** Vue 位置 -> 临时 .py 文件内位置（0-based）。临时文件第 0 行为 def setup，第 1 行起为缩进后的原内容，列号需 +INDENT。 */
  function vueToTemp(block, vuePosition) {
    const scriptLine0Based = vuePosition.line - (block.startLine1Based - 1);
    const tempLine0Based = 1 + scriptLine0Based;
    const tempChar = tempLine0Based >= 1 ? vuePosition.character + INDENT : vuePosition.character;
    return new vscode.Position(tempLine0Based, tempChar);
  }

  /** 临时文件内行号(0-based) -> Vue 文档行号(0-based) */
  function tempLineToVueLine(block, tempLine0Based) {
    if (tempLine0Based <= 0) return block.startLine1Based - 1;
    return block.startLine1Based - 2 + tempLine0Based;
  }

  /** 获取/创建当前 Vue 对应的临时 .py 文件路径，并写入包在 setup 中的 content。文件名：原 vue 名-短 hash.py。 */
  function getTempPyPathAndWrite(vueUri, rawContent) {
    const folder = vscode.workspace.getWorkspaceFolder(vueUri);
    const dir = folder
      ? path.join(folder.uri.fsPath, CACHE_DIR_IN_WORKSPACE)
      : path.join(context.globalStoragePath || require('os').tmpdir(), TEMP_SUBDIR);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
    const key = vueUri.toString();
    const hash = crypto.createHash('md5').update(key).digest('hex').slice(0, 8);
    const baseName = path.basename(vueUri.fsPath, path.extname(vueUri.fsPath)) || 'vue';
    const fileName = baseName + '-' + hash + '.py';
    const filePath = path.join(dir, fileName);
    const content = wrapInSetup(rawContent);
    try {
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (e) {
      console.warn('[vue-py-highlight] write temp file failed', e);
    }
    return filePath;
  }

  /** 返回 { tempUri, tempPosition, block } 或 { block: null } */
  function getTempUriAndPosition(vueDocument, vuePosition) {
    const block = isInScriptPy(vueDocument, vuePosition);
    if (!block) return { tempUri: null, tempPosition: null, block: null };
    const tempPath = getTempPyPathAndWrite(vueDocument.uri, block.content);
    const tempUri = vscode.Uri.file(tempPath);
    const tempPosition = vueToTemp(block, vuePosition);
    return { tempUri, tempPosition, block };
  }

  /** 临时文件中的列号 -> Vue 中的列号（内容行需减 INDENT） */
  function tempCharToVueChar(tempLine0Based, tempChar) {
    if (tempLine0Based >= 1) return Math.max(0, tempChar - INDENT);
    return tempChar;
  }

  /** 临时文件中的 Range -> Vue 中的 Range */
  function tempRangeToVueRange(block, tempRange) {
    const startLine = tempLineToVueLine(block, tempRange.start.line);
    const endLine = tempLineToVueLine(block, tempRange.end.line);
    const startChar = tempCharToVueChar(tempRange.start.line, tempRange.start.character);
    const endChar = tempCharToVueChar(tempRange.end.line, tempRange.end.character);
    return new vscode.Range(startLine, startChar, endLine, endChar);
  }

  /** 若 loc 指向临时文件，则映射回 Vue 的 document.uri 和 range */
  function mapLocationToVue(loc, document, block, tempUri) {
    if (!loc || !loc.uri) return loc;
    const isTemp = loc.uri.fsPath === tempUri.fsPath || loc.uri.toString() === tempUri.toString();
    if (!isTemp) return loc;
    const sl = loc.range.start.line;
    const el = loc.range.end.line;
    const vueStartLine = tempLineToVueLine(block, sl);
    const vueEndLine = tempLineToVueLine(block, el);
    const vueStartChar = tempCharToVueChar(sl, loc.range.start.character);
    const vueEndChar = tempCharToVueChar(el, loc.range.end.character);
    return new vscode.Location(
      document.uri,
      new vscode.Range(vueStartLine, vueStartChar, vueEndLine, vueEndChar)
    );
  }

  /** 先打开临时文档，让 Pylance 能识别为 Python 文件 */
  async function ensureTempDocOpen(tempUri) {
    try {
      await vscode.workspace.openTextDocument(tempUri);
    } catch (_) {}
  }

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider([{ language: 'vue' }], {
      async provideDefinition(document, position) {
        const { tempUri, tempPosition, block } = getTempUriAndPosition(document, position);
        if (!tempUri || !block) return null;
        await ensureTempDocOpen(tempUri);
        let locations = await vscode.commands.executeCommand(
          'vscode.executeDefinitionProvider',
          tempUri,
          tempPosition
        );
        if (!locations) return undefined;
        if (!Array.isArray(locations)) locations = [locations];
        return locations.map((loc) => mapLocationToVue(loc, document, block, tempUri));
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider([{ language: 'vue' }], {
      async provideHover(document, position) {
        const { tempUri, tempPosition } = getTempUriAndPosition(document, position);
        if (!tempUri) return null;
        await ensureTempDocOpen(tempUri);
        const hovers = await vscode.commands.executeCommand(
          'vscode.executeHoverProvider',
          tempUri,
          tempPosition
        );
        return Array.isArray(hovers) ? hovers[0] : hovers;
      },
    })
  );

  context.subscriptions.push(
    vscode.languages.registerReferenceProvider([{ language: 'vue' }], {
      async provideReferences(document, position, _refContext) {
        const { tempUri, tempPosition, block } = getTempUriAndPosition(document, position);
        if (!tempUri || !block) return null;
        await ensureTempDocOpen(tempUri);
        const refs = await vscode.commands.executeCommand(
          'vscode.executeReferenceProvider',
          tempUri,
          tempPosition
        );
        if (!Array.isArray(refs) || refs.length === 0) return refs;
        return refs.map((ref) => mapLocationToVue(ref, document, block, tempUri));
      },
    })
  );

  /** 补全：转发 Pylance 的补全，并把 range / additionalTextEdits 映射回 Vue 坐标 */
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [{ language: 'vue' }],
      {
        async provideCompletionItems(document, position, _token, _context) {
          const { tempUri, tempPosition, block } = getTempUriAndPosition(document, position);
          if (!tempUri || !block) return undefined;
          await ensureTempDocOpen(tempUri);
          const list = await vscode.commands.executeCommand(
            'vscode.executeCompletionItemProvider',
            tempUri,
            tempPosition,
            undefined
          );
          if (!list) return undefined;
          const items = list.items || (Array.isArray(list) ? list : []);
          const wordRange = document.getWordRangeAtPosition(position) || new vscode.Range(position, position);
          for (const item of items) {
            item.range = wordRange;
            if (item.textEdit && item.textEdit.range) {
              item.textEdit = new vscode.TextEdit(wordRange, item.insertText || item.label);
            }
            if (item.additionalTextEdits && item.additionalTextEdits.length) {
              item.additionalTextEdits = item.additionalTextEdits.map((edit) => {
                const vueRange = tempRangeToVueRange(block, edit.range);
                return new vscode.TextEdit(vueRange, edit.newText);
              });
            }
          }
          return Array.isArray(list) ? items : new vscode.CompletionList(items, list.isIncomplete);
        },
      },
      undefined,
      undefined
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

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

  // 默认不显示 Run 按钮，等 updateRunButtonContext 检查后再决定
  vscode.commands.executeCommand('setContext', 'vuepy.hasScriptPy', false);

  /** 从 Vue 文档中解析 <script lang="py"> 块：{ content, startLine1Based, startOffset, endOffset } 或 null */
  function getScriptPyBlock(text) {
    const re = /<script\s+[^>]*lang\s*=\s*["']py["'][^>]*>([\s\S]*?)<\/script>/i;
    const m = text.match(re);
    if (!m) return null;
    const content = m[1] || '';
    const contentStartIndex = m.index + m[0].indexOf('>') + 1;
    const startLine1Based = text.slice(0, contentStartIndex).split(/\r?\n/).length;
    const startOffset = contentStartIndex;
    const endOffset = contentStartIndex + content.length;
    return { content, startLine1Based, startOffset, endOffset };
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

  /** 获取/创建用于格式化的临时 .py 文件路径（不包在 setup 中，直接用原内容） */
  function getTempPyPathForFormat(vueUri, rawContent) {
    const folder = vscode.workspace.getWorkspaceFolder(vueUri);
    const dir = folder
      ? path.join(folder.uri.fsPath, CACHE_DIR_IN_WORKSPACE)
      : path.join(context.globalStoragePath || require('os').tmpdir(), TEMP_SUBDIR);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
    const key = vueUri.toString() + ':fmt';
    const hash = crypto.createHash('md5').update(key).digest('hex').slice(0, 8);
    const baseName = path.basename(vueUri.fsPath, path.extname(vueUri.fsPath)) || 'vue';
    const fileName = baseName + '-' + hash + '.py';
    const filePath = path.join(dir, fileName);
    try {
      fs.writeFileSync(filePath, rawContent, 'utf8');
    } catch (e) {
      console.warn('[vue-py-highlight] write temp fmt file failed', e);
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

  /** 在给定文本上按 TextEdit 应用格式化结果（使用原始 temp 文档的 offset 计算） */
  function applyEditsToText(text, edits, tempDoc) {
    if (!Array.isArray(edits) || !edits.length) {
      return text;
    }
    // 按起始 offset 从后往前应用，避免影响后续位置
    const sorted = edits.slice().sort((a, b) => {
      const ao = tempDoc.offsetAt(a.range.start);
      const bo = tempDoc.offsetAt(b.range.start);
      return bo - ao;
    });
    let result = text;
    for (const e of sorted) {
      const start = tempDoc.offsetAt(e.range.start);
      const end = tempDoc.offsetAt(e.range.end);
      result = result.slice(0, start) + e.newText + result.slice(end);
    }
    return result;
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

  /** 从 document.uri 解析出对应的 .vue 源文件（支持 Volar 虚拟 URI 等） */
  function resolveVueDocument(uri) {
    if (uri.scheme === 'file' && uri.fsPath.endsWith('.vue')) return uri;
    const s = uri.toString();
    const vueMatch = s.match(/([^/]+\.vue)(?:\?|$)/);
    if (vueMatch) {
      const workspaceFolders = vscode.workspace.workspaceFolders || [];
      for (const folder of workspaceFolders) {
        const candidate = vscode.Uri.joinPath(folder.uri, vueMatch[1]);
        try {
          if (fs.existsSync(candidate.fsPath)) return candidate;
        } catch (_) {}
      }
      const pathMatch = s.match(/[\/]([^\/]+\/[^\/]+\.vue)/);
      if (pathMatch) {
        for (const folder of workspaceFolders) {
          const candidate = vscode.Uri.joinPath(folder.uri, pathMatch[1]);
          try {
            if (fs.existsSync(candidate.fsPath)) return candidate;
          } catch (_) {}
        }
      }
    }
    return null;
  }

  /** 从 template 中的标识符跳转到 script 里的定义（简单基于 Python 源码查找 def / 赋值行） */
  function findDefsInScriptFromTemplate(document, position) {
    let text = document.getText();
    let block = getScriptPyBlock(text);
    let targetUri = document.uri;

    if (!block) {
      const resolved = resolveVueDocument(document.uri);
      if (resolved && resolved.toString() !== document.uri.toString()) {
        try {
          const vueDoc = fs.readFileSync(resolved.fsPath, 'utf8');
          block = getScriptPyBlock(vueDoc);
          text = vueDoc;
          targetUri = resolved;
        } catch (_) {}
      }
    }
    if (!block) return [];

    let wordRange = document.getWordRangeAtPosition(position);
    let name = wordRange ? document.getText(wordRange) : '';
    if (!name) {
      const docLines = document.getText().split(/\r?\n/);
      const line = (position.line < docLines.length ? docLines[position.line] : '') || '';
      const pyIdMatch = line.match(/([a-zA-Z_][a-zA-Z0-9_]*)/g);
      if (pyIdMatch) {
        for (const id of pyIdMatch) {
          const idx = line.indexOf(id);
          if (position.character >= idx && position.character <= idx + id.length) {
            name = id;
            break;
          }
        }
      }
    }
    if (!name) return [];

    const lines = block.content.split(/\r?\n/);
    const results = [];
    // 支持 async def 和普通 def
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const defRe = new RegExp('^\\s*(?:async\\s+)?def\\s+' + escapedName + '\\s*\\(');
    const assignRe = new RegExp('^\\s*' + escapedName + '\\s*=');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m = defRe.exec(line);
      if (m) {
        const col = m.index + m[0].indexOf(name);
        const vueLine = block.startLine1Based - 1 + i;
        const range = new vscode.Range(vueLine, col, vueLine, col + name.length);
        results.push(new vscode.Location(targetUri, range));
        continue;
      }
      m = assignRe.exec(line);
      if (m) {
        const col = m.index;
        const vueLine = block.startLine1Based - 1 + i;
        const range = new vscode.Range(vueLine, col, vueLine, col + name.length);
        results.push(new vscode.Location(targetUri, range));
      }
    }
    return results;
  }

  /** 解析当前 .vue 的运行上下文；失败时提示并返回 null */
  async function resolveVuepyRunContext(doc) {
    if (doc.languageId !== 'vue' || !doc.uri.fsPath.endsWith('.vue')) {
      vscode.window.showWarningMessage('当前文件不是 .vue 文件');
      return null;
    }
    if (!getScriptPyBlock(doc.getText())) {
      vscode.window.showWarningMessage('当前文件不含 <script lang="py">，无法运行或调试');
      return null;
    }
    const filePath = doc.uri.fsPath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(filePath);
    let pythonPath = 'python';
    try {
      const cfg = vscode.workspace.getConfiguration('python', doc.uri);
      const interpreterPath = cfg.get('defaultInterpreterPath');
      if (interpreterPath && typeof interpreterPath === 'string') {
        pythonPath = interpreterPath.trim();
      }
    } catch (_) {}
    try {
      const pyExt = vscode.extensions.getExtension('ms-python.python');
      if (pyExt?.isActive && pyExt.exports?.settings?.getExecutionDetails) {
        const details = await pyExt.exports.settings.getExecutionDetails(doc.uri);
        if (details?.execCommand?.[0]) pythonPath = details.execCommand[0];
      }
    } catch (_) {}
    return { filePath, cwd, pythonPath, workspaceFolder };
  }

  /** 运行 Vuepy .vue 文件（需含 <script lang="py">）：在终端执行 python -m vuepy run */
  context.subscriptions.push(
    vscode.commands.registerCommand('vuepy.runVueFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('请先打开一个 .vue 文件');
        return;
      }
      const ctx = await resolveVuepyRunContext(editor.document);
      if (!ctx) return;
      const { filePath, pythonPath } = ctx;
      const VUEPY_TERM_NAME = 'vuepy';
      let term = vscode.window.terminals.find((t) => t.name === VUEPY_TERM_NAME);
      if (!term) {
        term = vscode.window.createTerminal({ name: VUEPY_TERM_NAME });
      }
      term.show();
      const runCmd = `${JSON.stringify(pythonPath)} -m vuepy run ${JSON.stringify(filePath)}`;
      term.sendText(runCmd);
    })
  );

  /** 调试：用 Python 扩展启动 debugpy，等价 python -m vuepy run <file> */
  context.subscriptions.push(
    vscode.commands.registerCommand('vuepy.debugVueFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('请先打开一个 .vue 文件');
        return;
      }
      const ctx = await resolveVuepyRunContext(editor.document);
      if (!ctx) return;
      const { filePath, cwd, pythonPath, workspaceFolder } = ctx;
      const launch = {
        name: 'Vuepy: debug .vue',
        type: 'python',
        request: 'launch',
        module: 'vuepy',
        args: ['run', filePath],
        cwd,
        console: 'integratedTerminal',
        python: pythonPath,
        justMyCode: true,
      };
      const started = await vscode.debug.startDebugging(workspaceFolder || undefined, launch);
      if (!started) {
        vscode.window.showErrorMessage(
          '无法启动调试：请确认已安装 Python 扩展，且工作区已选择解释器'
        );
      }
    })
  );

  const vueDocSelector = [{ language: 'vue' }, { scheme: 'file', pattern: '**/*.vue' }];
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(vueDocSelector, {
      async provideDefinition(document, position) {
        // 先看是否在 <script lang=\"py\"> 内部，如果是则走 Pylance 的跳转
        const inScript = isInScriptPy(document, position);
        if (inScript) {
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
        }

        // 不在 script 中（一般是 template），尝试在 script 里基于源码查找 def / 赋值作为定义位置
        const templateDefs = findDefsInScriptFromTemplate(document, position);
        if (templateDefs.length) {
          return templateDefs;
        }
        return null;
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

  /** 在 template 中查找对 script 符号的引用（基于简单文本匹配） */
  function findTemplateRefsForName(document, name, block) {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const scriptStart0 = block.startLine1Based - 1;
    const scriptLen = block.content.split(/\r?\n/).length;
    const scriptEnd0 = scriptStart0 + scriptLen - 1;

    // 简单转义 name 中的正则特殊字符
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b' + escaped + '\\b', 'g');

    const locations = [];
    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      if (lineNo >= scriptStart0 && lineNo <= scriptEnd0) continue; // 跳过 script 区域
      const line = lines[lineNo];
      let m;
      while ((m = re.exec(line)) !== null) {
        const col = m.index;
        const range = new vscode.Range(lineNo, col, lineNo, col + name.length);
        locations.push(new vscode.Location(document.uri, range));
      }
    }
    return locations;
  }

  context.subscriptions.push(
    vscode.languages.registerReferenceProvider([{ language: 'vue' }], {
      async provideReferences(document, position, _refContext) {
        const inScript = isInScriptPy(document, position);

        // 先尝试从 Pylance 获取 script 内部的引用
        let scriptRefs = [];
        let block = null;
        if (inScript) {
          const res = getTempUriAndPosition(document, position);
          const { tempUri, tempPosition } = res;
          block = res.block;
          if (tempUri && block) {
            await ensureTempDocOpen(tempUri);
            const refs = await vscode.commands.executeCommand(
              'vscode.executeReferenceProvider',
              tempUri,
              tempPosition
            );
            if (Array.isArray(refs) && refs.length) {
              scriptRefs = refs.map((ref) => mapLocationToVue(ref, document, block, tempUri));
            }
          }
        } else {
          // 不在 script 中时，也需要 block 信息用于查 template 引用
          block = getScriptPyBlock(document.getText());
        }

        if (!block) {
          return scriptRefs.length ? scriptRefs : null;
        }

        // 基于当前光标处的名字，在 template 中做简单文本匹配，补充为引用位置
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
          return scriptRefs.length ? scriptRefs : null;
        }
        const name = document.getText(wordRange);
        if (!name) {
          return scriptRefs.length ? scriptRefs : null;
        }

        const templateRefs = findTemplateRefsForName(document, name, block);
        if (!templateRefs.length) {
          return scriptRefs.length ? scriptRefs : null;
        }

        return scriptRefs.concat(templateRefs);
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

  /** 大纲：转发 Pylance 的 DocumentSymbol，并把 range / selectionRange 映射回 Vue 坐标 */
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider([{ language: 'vue' }], {
      async provideDocumentSymbols(document) {
        const text = document.getText();
        const block = getScriptPyBlock(text);
        if (!block) {
          return [];
        }
        const tempPath = getTempPyPathAndWrite(document.uri, block.content);
        const tempUri = vscode.Uri.file(tempPath);
        await ensureTempDocOpen(tempUri);
        const baseSymbols = await vscode.commands.executeCommand(
          'vscode.executeDocumentSymbolProvider',
          tempUri
        );
        if (!baseSymbols || !Array.isArray(baseSymbols) || baseSymbols.length === 0) {
          return [];
        }

        function mapDocSymbol(sym) {
          const mapped = new vscode.DocumentSymbol(
            sym.name,
            sym.detail || '',
            sym.kind,
            tempRangeToVueRange(block, sym.range),
            tempRangeToVueRange(block, sym.selectionRange || sym.range)
          );
          if (sym.children && sym.children.length) {
            mapped.children = sym.children.map(mapDocSymbol);
          }
          return mapped;
        }

        // 只处理 DocumentSymbol[]，SymbolInformation[] 直接忽略（避免坐标错乱）。
        if (baseSymbols[0].range && baseSymbols[0].selectionRange) {
          return baseSymbols.map(mapDocSymbol);
        }
        return [];
      },
    })
  );

  /** 使用 Python 格式化器（Pylance/black 等）格式化 <script lang="py"> 代码块（只替换内部内容，不改 <script> 标签） */
  async function formatScriptBlock(document, options, _rangeOpt, _token) {
    const text = document.getText();
    const block = getScriptPyBlock(text);
    if (!block) {
      return [];
    }
    const tempPath = getTempPyPathForFormat(document.uri, block.content);
    const tempUri = vscode.Uri.file(tempPath);
    const tempDoc = await vscode.workspace.openTextDocument(tempUri);
    const edits = await vscode.commands.executeCommand(
      'vscode.executeFormatDocumentProvider',
      tempUri,
      options
    );
    if (!Array.isArray(edits) || edits.length === 0) {
      return [];
    }

    // 在临时 Python 文档文本上按 TextEdit 计算出完整的格式化后内容
    const formattedFull = applyEditsToText(tempDoc.getText(), edits, tempDoc);

    // 标准化为：标签后换行一行，再是格式化后的代码，最后再换行一行
    const trimmed = formattedFull.replace(/\s+$/u, '');
    const newContent = '\n' + trimmed + '\n';

    // 仅替换 <script lang="py"> 内部内容，不动前后的 <script> 标签
    const startPos = document.positionAt(block.startOffset);
    const endPos = document.positionAt(block.endOffset);
    const vueRange = new vscode.Range(startPos, endPos);
    return [new vscode.TextEdit(vueRange, newContent)];
  }

  /** 文档整体格式化：只对 <script lang=\"py\"> 部分调用 Python 格式化器 */
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider([{ language: 'vue' }], {
      async provideDocumentFormattingEdits(document, options, token) {
        return formatScriptBlock(document, options, undefined, token);
      },
    })
  );

  /** 选区格式化：若选区与 script 重叠，同样按整个 script 块来格式化 */
  context.subscriptions.push(
    vscode.languages.registerDocumentRangeFormattingEditProvider([{ language: 'vue' }], {
      async provideDocumentRangeFormattingEdits(document, range, options, token) {
        const text = document.getText();
        const block = getScriptPyBlock(text);
        if (!block) {
          return [];
        }
        const scriptStart = block.startLine1Based - 1;
        const scriptLen = block.content.split(/\r?\n/).length;
        const scriptEnd = scriptStart + scriptLen - 1;
        // 若选区与 script 无交集，则不处理
        if (range.end.line < scriptStart || range.start.line > scriptEnd) {
          return [];
        }
        return formatScriptBlock(document, options, range, token);
      },
    })
  );

  /**
   * 将 Pylance 返回的 WorkspaceEdit 中指向临时文件的编辑映射回 Vue 文件坐标。
   * 其余文件（如跨文件重构）原样保留。
   */
  function mapWorkspaceEditToVue(wsEdit, document, block, tempUri) {
    const newWsEdit = new vscode.WorkspaceEdit();
    for (const [uri, edits] of wsEdit.entries()) {
      const isTemp = uri.fsPath === tempUri.fsPath || uri.toString() === tempUri.toString();
      if (isTemp) {
        const vueEdits = edits.map((edit) => {
          const vueRange = tempRangeToVueRange(block, edit.range);
          return new vscode.TextEdit(vueRange, edit.newText);
        });
        newWsEdit.set(document.uri, vueEdits);
      } else {
        newWsEdit.set(uri, edits);
      }
    }
    return newWsEdit;
  }

  /** 重命名（F2）：转发给 Pylance，将返回的 WorkspaceEdit 坐标映射回 Vue 文件 */
  context.subscriptions.push(
    vscode.languages.registerRenameProvider([{ language: 'vue' }], {
      prepareRename(document, position) {
        const inScript = isInScriptPy(document, position);
        if (!inScript) {
          throw new Error('只支持在 <script lang="py"> 内重命名');
        }
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) {
          throw new Error('光标处无可重命名的符号');
        }
        return wordRange;
      },

      async provideRenameEdits(document, position, newName) {
        const inScript = isInScriptPy(document, position);
        if (!inScript) return null;
        const { tempUri, tempPosition, block } = getTempUriAndPosition(document, position);
        if (!tempUri || !block) return null;
        await ensureTempDocOpen(tempUri);
        let wsEdit;
        try {
          wsEdit = await vscode.commands.executeCommand(
            'vscode.executeDocumentRenameProvider',
            tempUri,
            tempPosition,
            newName
          );
        } catch (e) {
          vscode.window.showErrorMessage('重命名失败: ' + (e && e.message ? e.message : String(e)));
          return null;
        }
        if (!wsEdit) return null;
        return mapWorkspaceEditToVue(wsEdit, document, block, tempUri);
      },
    })
  );

  /** 代码重构动作（Extract/Inline/QuickFix 等）：转发 Pylance 的 CodeAction，映射 WorkspaceEdit 坐标 */
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'vue' }],
      {
        async provideCodeActions(document, range, _context, _token) {
          const inScript = isInScriptPy(document, range.start);
          if (!inScript) return [];
          const block = inScript;
          const tempPath = getTempPyPathAndWrite(document.uri, block.content);
          const tempUri = vscode.Uri.file(tempPath);
          await ensureTempDocOpen(tempUri);
          const tempStart = vueToTemp(block, range.start);
          const tempEnd = vueToTemp(block, range.end);
          const tempRange = new vscode.Range(tempStart, tempEnd);
          let actions;
          try {
            actions = await vscode.commands.executeCommand(
              'vscode.executeCodeActionProvider',
              tempUri,
              tempRange
            );
          } catch (_) {
            return [];
          }
          if (!Array.isArray(actions) || !actions.length) return [];
          return actions
            .map((action) => {
              if (!action.edit) return action;
              action.edit = mapWorkspaceEditToVue(action.edit, document, block, tempUri);
              return action;
            })
            .filter(Boolean);
        },
      },
      {
        providedCodeActionKinds: [
          vscode.CodeActionKind.Refactor,
          vscode.CodeActionKind.RefactorExtract,
          vscode.CodeActionKind.RefactorInline,
          vscode.CodeActionKind.RefactorRewrite,
          vscode.CodeActionKind.QuickFix,
        ],
      }
    )
  );

  /** 更新 Run 按钮可见性：仅在含 <script lang="py"> 时显示 */
  function updateRunButtonContext() {
    try {
      const editor = vscode.window.activeTextEditor;
      const uri = editor?.document?.uri;
      let has = false;
      if (uri?.scheme === 'file' && uri.fsPath.endsWith('.vue')) {
        const text = editor.document.getText();
        has = getScriptPyBlock(text) != null;
      }
      vscode.commands.executeCommand('setContext', 'vuepy.hasScriptPy', has);
    } catch (_) {
      vscode.commands.executeCommand('setContext', 'vuepy.hasScriptPy', false);
    }
  }

  vscode.commands.executeCommand('setContext', 'vuepy.hasScriptPy', false);
  updateRunButtonContext();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateRunButtonContext),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) updateRunButtonContext();
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

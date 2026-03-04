# Vue `<script lang="py">` Python 高亮与语言功能扩展

- **语法高亮**：给 Vue SFC 里 `<script lang="py">` 代码块加上 Python 高亮；给 `<PnMarkdown>` 内的内容加上 Markdown 高亮（含标题、列表、代码块等）。
- **跳转 / 悬停 / 引用**：在 `<script lang="py">` 内支持 **Go to Definition**、**Hover**、**Find References**，通过虚拟文档转发给已安装的 Python 语言服务（Pylance / Python 扩展）。

## 依赖的扩展（会自动安装）

本扩展在 `package.json` 中声明了 **extensionDependencies**，安装本扩展时 VS Code/Cursor 会**自动安装或提示安装**以下扩展：

| 扩展 ID | 说明 |
|--------|------|
| `Vue.volar` | Vue - Official (Volar)，提供 Vue 语言与 `source.vue` / `text.html.vue` 语法，高亮与 LSP 基础 |
| `ms-python.python` | Python，提供 Python 运行与基础支持。Pylance 是 Python 扩展的一部分，会自动安装，提供跳转、悬停、引用、补全、大纲、格式化等 Python 语言服务 |

若通过「从 VSIX 安装」或「复制到扩展目录」方式安装，未安装上述依赖时请到扩展市场手动安装 **Vue - Official** 和 **Python**（通常已带 Pylance）。

## 方式一：开发模式（不用打包，推荐先试）

1. 在 Cursor 里 **文件 → 打开文件夹**，选 **本目录 `vs-plugin-py-highlight`**（不要选仓库根目录）。
2. 按 **F5** 启动「Extension Development Host」（会新开一个编辑器窗口）。
3. 在新窗口里 **文件 → 打开文件夹** 选你的 `vp` 仓库，然后打开 `src/textual_vuepy/_research/test_genai.vue`。
4. 看 `<script lang="py">` 里是否已是 Python 高亮。

若要在「主 Cursor 窗口」里用，见方式二或三。

## 方式二：复制到扩展目录（免 Node 20、免 vsce）

1. 把整个 `vs-plugin-py-highlight` 文件夹复制到 Cursor 扩展目录下，并改名为带版本号的形式，例如：
   - Linux/macOS: `~/.cursor/extensions/vue-python-highlight-0.0.1/`
   - 即复制后目录内要直接是 `package.json`、`syntaxes/` 等，不要多一层 `vs-plugin-py-highlight`。
2. 重启 Cursor。
3. 打开 `.vue` 文件检查高亮。

## 方式三：打包成 VSIX 再安装

**注意**：`vsce package` 在 Node 19 下会报 `File is not defined`，需 **Node 20 或更高**（如 20 LTS、22）。

```bash
cd vs-plugin-py-highlight
nvm use 20   # 若用 nvm；或改用系统/其它方式安装的 Node 20+
npm install -g @vscode/vsce
vsce package
```

然后在 Cursor 里：扩展 → 右上角 ⋯ → **从 VSIX 安装**，选生成的 `.vsix`，重启。

---

## 若仍不高亮

1. 确认已安装 **Vue - Official (Volar)**，当前文件右下角语言为 **Vue**。
2. **开发者: 重新加载窗口**（Ctrl/Cmd+Shift+P → Reload Window）。
3. **查实际 scope**：打开一个 `.vue` 文件，把光标放在 `<script lang="py">` 那一行任意位置，按 Ctrl/Cmd+Shift+P → 输入 **Inspect Editor Tokens and Scopes** 并执行。在弹出面板里看 **Scope** 那一行（或 Token 的 scope），记下最前面的根 scope（如 `source.vue`、`text.html.vue`、`vue` 等）。若根 scope 不在我们已支持的列表里，可在本扩展 `package.json` 的 `contributes.grammars[0].injectTo` 和 `syntaxes/vue-python.tmLanguage.json` 的 `injectionSelector` 里加上该 scope 后再试。

---

## 跳转、悬停、引用

- 需已安装 **Python 扩展**（Pylance）。**可不选 Python 解释器**：扩展会把 `<script lang="py">` 内容写入工作区内的 `.vue-py-cache/*.py`，让 Pylance 按工作区文件分析，从而避免“选了解释器后 Vue template 高亮异常”的问题。
- 在 `<script lang="py">` 内：
  - **F12 / 右键 Go to Definition**：跳转到定义（若定义在同一块内，会留在当前 .vue 文件对应位置；若在 .py 中则打开对应文件）。
  - **悬停**：显示类型/文档（由 Pylance 提供）。
  - **Shift+F12 / 右键 Find All References**：查找引用。
- 实现方式：扩展把当前 Vue 文件中的 Python 块写入 **工作区根目录下的 `.vue-py-cache/<hash>.py`**，再对该文件调用 Pylance 的 definition/hover/reference，并把返回位置映射回 .vue 或 .py。建议在项目根目录 `.gitignore` 中加入一行：` .vue-py-cache/`。

---

## 格式化（`<script lang="py">`）

- 本扩展**未依赖**某个具体的 Python 格式化插件；格式化通过 VS Code 的「为当前文档执行格式化」命令，由**你为 Python 配置的 formatter** 完成。
- 实际调用的通常是 **Python 扩展**（`ms-python.python`）根据设置选用的 formatter，例如：
  - **Black**（如安装 `ms-python.black-formatter` 或在设置中指定 Black）
  - **autopep8**
  - **Ruff**（如安装 `charliermarsh.ruff`）
  - 或你在「Python 格式化」相关设置里指定的其它工具。
- 使用方式：在 `.vue` 中执行 **格式化文档** 或选中 `<script lang="py">` 内一段后 **格式化选区**，仅该 script 块内容会被上述 formatter 重排，`<script>` 标签与 template/style 不会被修改。

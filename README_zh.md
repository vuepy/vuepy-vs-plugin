# Vuepy（VS Code / Cursor 扩展）

为 **Vue SFC（`.vue`）** 提供 Vuepy 相关语法与语言功能：`<script lang="py">` 的 Python 高亮、**语法诊断**与 **Pylance 转发**、`<PnMarkdown>` / `<markdown>` 等块内的 Markdown 高亮，以及运行入口等。

扩展标识：`name` 为 `vuepy`，`publisher` 为 `vuepy-org`，`displayName` 为 **Vuepy**。

---

## 功能概览

### 语法高亮（`package.json` → `contributes.grammars`）

1. **`vue.injections.python`**（`syntaxes/vue-python.tmLanguage.json`）  
   在 `source.vue`、`text.html.vue` 中，为 `<script lang="py">` 内嵌 **Python** 作用域，便于与 Volar 的 Vue 语法叠加高亮。

2. **`vue.injections.pnmarkdown`**（`syntaxes/vue-pnmarkdown.tmLanguage.json`）  
   在下列根语法上**注入** Markdown 风格高亮（排除注释区域）：
   - `source.vue`
   - `text.html.vue`
   - `text.html.derivative`（部分环境 / 衍生 HTML 视图也会用到，与 Volar 等配合时更稳）

   **支持的标签名**（开始/结束标签需配对，大小写按正则允许的形式）：  
   `PnMarkdown`、`pn-markdown`、`Markdown`、`markdown`。

   **块内规则要点**：
   - **ATX 标题** `#`～`######`：允许行首缩进（适配 template 里缩进排版）。
   - **围栏代码块** `` ```lang ``：按语言切换内嵌语法，并在 `package.json` 的 `embeddedLanguages` 中与编辑器语言 id 对齐，例如：
     - `python` / `py` → Python  
     - `json` / `jsonc` → JSON  
     - `javascript` / `js` → JavaScript  
     - `typescript` / `ts` → TypeScript  
     - `bash` / `sh` / `shell` / `zsh` → Shell  
     - `html` / `htm` / `vue` → HTML  
     - `css` / `scss` / `less` → CSS  
     - `yaml` / `yml` → YAML  
     - 其它 `` ``` `` 语言标记：回退为通用围栏块（内嵌规则见该 tmLanguage 文件中的 fallback 定义）。
   - **引用** `>`、**无序列表**、**行内代码** `` `...` ``、**粗体/斜体/删除线** 等常见 Markdown 片段高亮。

### 语言服务转发（`extension.js`）

在 **`<script lang="py">`** 区域内，扩展会把块内源码同步到临时 `.py` 文件，再调用 VS Code 内置的 `vscode.execute*` 命令，把 **Pylance（Python 扩展）** 的结果**映射回当前 `.vue`**。

| 能力 | 行为说明 |
|------|----------|
| **转到定义** | 在 script 内：走 Pylance，返回位置映射回 `.vue` 或外部 `.py`。在 **template** 等 script 外：对当前词在 script 中做简单源码匹配（`def` / `async def`、顶层 `name =`），跳转到匹配行。 |
| **悬停** | 仅在 script 块内生效，悬停内容来自 Pylance。 |
| **查找引用** | script 内：Pylance 引用 + 映射；同时可在 **template** 中对同名标识符做简单全文匹配，合并结果（跳过 script 区域避免重复）。 |
| **补全** | script 内：转发 Pylance 补全，并把 `range` / `additionalTextEdits` 从临时文件坐标映射回 `.vue`。 |
| **大纲（文档符号）** | 对整块 script 生成临时文件并取 Pylance 的 DocumentSymbol，将 `range` / `selectionRange` 映射回 `.vue`（仅处理 `DocumentSymbol` 树状结构）。 |
| **格式化** | **格式化文档** / **格式化选区**：仅替换 `<script lang="py">` 与 `</script>` **之间**的内容；标签与 template/style 不动。格式化使用**未包在 `setup()` 里**的原始块内容写入临时 `.py`，再调用 `vscode.executeFormatDocumentProvider`，避免把整块强行包成函数后破坏格式化器语义。 |
| **重命名（F2）** | 仅在 script 块内生效。`prepareRename` 阶段检查光标是否在可重命名的标识符上；`provideRenameEdits` 将请求转发给 Pylance（`vscode.executeDocumentRenameProvider`），把返回的 `WorkspaceEdit` 中临时文件的坐标映射回 `.vue` 文件；跨文件重构（如其他 `.py`）的编辑原样保留。**注意**：由于临时文件是孤立的，template 中同名用法不在 Pylance 的重命名范围内，仅 script 内部生效。 |
| **代码重构动作** | 在 script 块内，把当前选区映射到临时文件后调用 `vscode.executeCodeActionProvider`，将 Pylance 返回的 `CodeAction`（Extract Function、Inline Variable、Quick Fix 等）中的 `WorkspaceEdit` 坐标映射回 `.vue`。支持的 `CodeActionKind`：`Refactor`、`RefactorExtract`、`RefactorInline`、`RefactorRewrite`、`QuickFix`。 |
| **诊断** | 打开包在 `setup()` 里的临时 `.py`，把来源为 **Pylance / Pyright** 的诊断映射回 `.vue`。详见下方「语法诊断」。 |

**临时文件与缓存**：

- 默认写入工作区文件夹下的 **`.vue-py-cache/`**，文件名为 `原vue基名-<8位hash>.py`；若无工作区则退回到扩展全局存储目录下的 `vue-py-scripts/`（或系统临时目录策略以代码为准）。
- 跳转/悬停/补全/大纲等使用的「包在 `setup` 里」的临时文件与「纯格式化用」临时文件 **key 不同**，避免互相覆盖逻辑混乱。
- 建议在仓库 **`.gitignore`** 中加入：`.vue-py-cache/`。

**Volar 虚拟文档**：若当前编辑器 URI 不是直接 `file://…/*.vue`，扩展会尝试从 URI 字符串中解析 `.vue` 路径并在工作区内解析真实文件，以便从 template 侧仍能读取 `<script lang="py">` 做定义查找等。

### 语法诊断（`extension.js`）

`.vue` 的语言 ID 是 `vue`，Pylance 不会直接检查它。扩展把 `<script lang="py">` 包进 `def setup(props, ctx, app):`，写入并**打开**临时 `.py`。Pylance 对已打开文件做分析（默认会排除 `**/.*`，但打开后的文件仍会检查），再把诊断映射回当前 `.vue`。诊断集合名是 `vuepy`，来源、消息和严重级别保持 Pylance 原文。

- **映射**：减去 `setup` 那一行和每行多出来的 4 个空格。`def setup` 与结尾 `return locals()` 上的报错属于包装代码，不显示。例如 `1a = 1` 在 Pylance 里是数字 token 后面紧跟标识符，波浪线落在 `a` 上，消息为 `Statements must be separated by newlines or semicolons`。
- **范围**：语法错误、未定义名字、类型不匹配等，凡来源是 `Pylance` 或 `Pyright` 的都会映射。其它 linter（如 Pylint）的结果留在临时文件上。
- **触发时机**：打开、编辑或切换到 `.vue` 后约 300ms 同步一次。script 未变则跳过。Pylance 随后更新时会跟着刷新。去掉 `<script lang="py">` 或关闭文件时清除 `.vue` 上的波浪线。
- **兜底**：同步后约 1.6 秒仍没有 Pylance 诊断时，用当前解释器对同一段 `setup` 源码执行 `ast.parse`，只标第一处语法错误，来源为 `vuepy`。解释器顺序与运行命令相同，失败后再试 `python3`、`python`。Pylance 稍后返回时，以 Pylance 的结果替换兜底提示。
- **问题面板**：临时 `.py` 仍是 Pylance 的诊断目标，同一条错误可能同时出现在缓存文件和 `.vue` 上。编辑器里看 `.vue` 的波浪线即可。

### 运行与调试 Vuepy 文件（`package.json` + `extension.js`）

- **运行命令**：`vuepy.runVueFile`，标题 **▶ Run Vuepy file**。
- **调试命令**：`vuepy.debugVueFile`，标题 **Debug Vuepy file**。使用 Python 扩展的调试适配器（`type: python`），以 `module: vuepy`、`args: ['run', <当前文件>]` 启动，可在 `.vue` 编译出的 Python / 依赖库中打断点（需在对应 `.py` 中设断点或调整 `justMyCode`）。
- **菜单**：当 **`vuepy.hasScriptPy`** 为真时，在编辑器标题栏 **Run** 下拉中显示上述两项（`when`: `resourceExtname == .vue && vuepy.hasScriptPy`）。
- **逻辑**：当前文件为 `.vue` 且包含 `<script lang="py">` 时，在终端中执行：  
  `<python> -m vuepy run <当前文件绝对路径>`  
  其中解释器优先 **Python 扩展** `getExecutionDetails`，否则 `python.defaultInterpreterPath`，再否则 `python`。**不会**先 `cd` 到工作区目录，也不为新建终端指定 `cwd`，由当前 shell 所在目录决定相对路径行为。
- **终端复用**：优先复用名称为 **`vuepy`** 的终端；若已关闭则新建。调试启动仍使用 `launch` 里的 `cwd`（工作区根或文件所在目录），便于 Python 解析相对导入。

**上下文 `vuepy.hasScriptPy`**：扩展在激活时与切换活动编辑器、当前文档变更时扫描活动 `.vue` 是否含 `<script lang="py">`，动态更新该上下文，从而控制 Run 按钮是否出现。

### 激活与依赖

- **`activationEvents`**：`onLanguage:vue`（打开 Vue 语言文件时激活）。
- **`extensionDependencies`**：`ms-python.python`、`ms-python.vscode-pylance`、`Vue.volar`（安装本扩展时会拉取或提示安装 Python、Pylance 与 Vue - Official）。

---

## 安装与开发

### 依赖的扩展（会自动安装或提示）

| 扩展 ID | 说明 |
|--------|------|
| `Vue.volar` | Vue - Official (Volar)，提供 `source.vue` / `text.html.vue` 等基础语法与语言服务 |
| `ms-python.python` | Python。运行、调试，以及语法兜底时用的解释器路径，走这个扩展 |
| `ms-python.vscode-pylance` | Pylance。跳转、悬停、引用、补全、大纲、格式化，以及映射回 `.vue` 的诊断都转给它。Python 扩展的 `extensionPack` 只会在安装 Python 时顺便装上 Pylance，并不阻止之后单独禁用 |

若通过 **从 VSIX 安装** 或复制扩展目录，请确认上述扩展已启用。

### 方式一：开发模式（推荐先试）

1. 用 Cursor / VS Code **打开本扩展目录**（包含 `package.json`、`extension.js`、`syntaxes/` 的文件夹）。
2. **F5** 启动 Extension Development Host。
3. 在新窗口中打开你的 Vuepy 项目，打开含 `<script lang="py">` 或 `<PnMarkdown>` 的 `.vue` 验证高亮、语法诊断与语言功能。

### 方式二：复制到扩展目录

将整个扩展文件夹复制到用户扩展目录下，例如：

- Linux/macOS：`~/.cursor/extensions/vuepy-0.0.1/`（目录内直接可见 `package.json`）

重启编辑器后生效。

### 方式三：打包 VSIX

`vsce package` 建议使用 **Node 20+**。

```bash
cd /path/to/vs-plugin-vuepy
npm install -g @vscode/vsce
vsce package
```

在扩展视图中选择 **从 VSIX 安装** 即可。

---

## 故障排除

1. 确认已安装 **Vue - Official** 与 **Python**，当前 `.vue` 的语言模式为 **Vue**。
2. **Developer: Reload Window** 重载窗口。
3. 高亮仍异常时，用 **Inspect Editor Tokens and Scopes** 查看光标处 **Scope**；若根 scope 不在 `injectTo` 列表中，可在 `package.json` 的 `contributes.grammars[].injectTo` 与对应 `tmLanguage.json` 的 `injectionSelector` 中按需追加（需与 Volar / 当前 Vue 语法包一致）。
4. 语法波浪线不出现时，确认已安装并启用 **Pylance**（`python.languageServer` 不要设为 `None`），然后重载窗口。语言服务器正常时，诊断来源是 `Pylance`。约 1.6 秒没有结果时，扩展改用 `ast.parse`，来源变为 `vuepy`。

---

## 版本与变更说明（相对早期「仅 py 高亮」版本）

- 扩展包名与入口统一为 **Vuepy**（`vuepy` / `extension.js`），并声明对 **Volar**、**Python**、**Pylance**（`ms-python.vscode-pylance`）的硬依赖。
- **PnMarkdown 语法注入** 增加对 **`text.html.derivative`** 的注入目标；块内支持多种围栏语言与更完整的 Markdown 片段；标签名兼容 `PnMarkdown`、`pn-markdown`、`Markdown`、`markdown`。
- **语言功能**：在原有跳转/悬停/引用基础上，增加 **补全**、**大纲**、**仅 script 块的格式化**（独立临时文件策略）。
- **重命名与重构**：新增 **重命名（F2）** 与 **代码重构动作（Extract / Inline / QuickFix）**，均通过 `mapWorkspaceEditToVue` 将临时文件坐标映射回 `.vue`；重命名限 script 内部（template 侧用法不在 Pylance 识别范围内）。
- **Template ↔ Script**：template 中简单 **转到定义**、**引用** 与 script 符号的联动；兼容 Volar 虚拟 URI 的 **真实 .vue 路径解析**。
- **运行**：新增 **Run Vuepy file** 命令与标题栏 Run 按钮（仅当存在 `<script lang="py">` 时显示）。
- **语法诊断**：打开包进 `setup()` 的临时 `.py`，把 Pylance / Pyright 的诊断映射回 `.vue`（含语法、未定义名字和类型错误）。Pylance 没有返回时，用 `ast.parse` 兜底第一处语法错误。

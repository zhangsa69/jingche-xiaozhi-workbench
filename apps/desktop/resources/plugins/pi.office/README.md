# pi.office

内置插件：三个 agent 工具，一步生成 Office 文件并写进工作区。

| 工具 | 产物 | 参数 |
| --- | --- | --- |
| `OfficeDoc` | `.docx` | `path`（必填）、`title`、`paragraphs: string[]` |
| `OfficeSheet` | `.xlsx` | `path`（必填）、`sheetName`、`rows: string[][]` |
| `OfficeSlides` | `.pptx` | `path`（必填）、`title`、`slides: { title, bullets? }[]` |

- `path` 是**工作区相对路径**，必须以上表对应的扩展名结尾；绝对路径、`..`、扩展名不符都会在插件里被拒，返回 `isError` 文本而不是抛异常。
- 落盘只走 `pi.fs.writeBase64(path, base64)`，由宿主按 `manifest.fs.write` 的 scope 校验并记审计——插件不直接调用 Node 的 `fs`。
- `main.js` 是 ESM 入口，`lib/*.js` 是 CommonJS 生成器（`buildDocx` / `buildXlsx` / `buildPptx`，返回 Buffer），所以入口用 `createRequire(import.meta.url)` 去 require。生成器按需加载：`lib/` 出问题时是工具报错，不会让整个插件加载失败。
- 这个 ESM/CJS 分裂由两个 `type` 显式声明，**两边都别动**：根 `package.json` 是 `"type": "module"`（`main.js` 用 `import`），`lib/package.json` 是 `"type": "commonjs"`（生成器用 `module.exports`）。删掉前者，`main.js` 会按 CJS 解析 → `import` 语法报错；删掉后者，`require("./lib/docx.js")` 会按 ESM 解析 → `module is not defined`。两侧都只坏一半工具，所以有测试锁住这两个字段。
- 为什么自己拼 OOXML：docx/xlsx/pptx 都是 zip + XML，最小包只需要几个部件；自带 zip 写入器就够用，插件因此零依赖、可离线、体积可控。代价是没有公式、样式、图片与宏。
- `OfficeSlides` 收到空 `slides` 数组**不是错误**：空 `sldIdLst` 会让 PowerPoint 判定文件损坏，所以生成器回落成「只有标题的一页」——这正是做纯封面页的用法，工具描述里已写明，别改成报错。
- 参数形状在插件层校验：生成器对缺参是宽容的（`paragraphs: "a, b"` 会当成"没有段落"静默产出空文档并回报成功），所以 `main.js` 的 `paragraphList` / `rowGrid` / `slideList` 先把「不是数组 / 行不是数组 / 幻灯片不是对象」拒成 `isError`；空数组仍然合法（只含标题的文档、封面演示、空表）。
- 标题类参数单独走 `optionalTextArg`：`lib/` 只在 `typeof === "string"` 时才写标题段（`docx.js` / `pptx.js` 的 `title`、`slides[i].title` 都是），所以 `title: 2026` 会被**静默丢弃**。这里把标量 `String()` 后传入（与 `paragraphs`/`bullets` 元素同一策略），对象/数组则拒成 `isError`。
- `buildZip` 对不安全的 entry 名会抛 `Error`；生成器内部部件名都是硬编码的，正常路径不会触发，插件层已 try/catch 成 `isError`。`buildZip` 不暴露给 agent。
- 权限只声明 `fs.write`：`fs.writeBase64` 是宿主 API 名，不是权限名（见 `PLUGIN_PERMISSIONS`）；`writeBase64` 走的是 `resolveFsRequest(..., "write", ...)` → `assertPermission("fs.write")`。**别**顺手把 `fs.writeBase64` 也加成权限：宿主安装阶段不校验权限是否在清单内（`validateManifest` 只查形状和 contributes 配套），但 `pi-plugin check` 会把它记成 `permission.unknown` 的 **error**，`pack` 随即 `throw new Error("plugin check failed: …")` —— 安装能过、打包中止。
- `pi-plugin check` 一度会报 `permission.unused`（"`main.js` never calls `fs.writeText`"），因为 devkit 的 `PERMISSION_API_HINTS["fs.write"]` 只列了 `fs.writeText`；本插件走 `writeBase64`，所以已在 `packages/plugin-devkit/src/check.ts` 把 `fs.writeBase64` 补进该权限的提示表，避免所有二进制写插件都吃这条误报。`pi-plugin check` 实测 `OK pi.office@0.1.0`，exit 0。
- 产物结构故意从简（段落 / 单表内联文本 / 标题+要点），换个说法：这是「把文字交出去」的通道，不是排版工具。同路径重复生成会覆盖。
- 新增生成器时保持签名不变，并在 `test/office-plugin.test.mjs` 里补一条用例。

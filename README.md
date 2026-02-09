# 📈 LeetCurve

> 基于艾宾浩斯遗忘曲线的 LeetCode 智能复习管理工具

**解决刷题"遗忘快"的核心痛点。** 通过自动监听提交状态，利用动态优先级算法管理复习队列，实现自动化、无感化的复习管理。同时提供可独立运行的 Web 面板，支持脱离插件使用。

---

## 功能特性

### 🎯 自动化捕获
- **智能检测**：仅在 LeetCode 题目页面检测到 `Accepted` 状态时触发
- **冷冻期机制**：同一题目 1 小时内的多次 AC 仅计为一次，防止曲线跳级
- **自动复习推进**：已在队列中的题目再次 AC，自动推进复习阶段

### 🧠 科学复习算法
- **艾宾浩斯曲线**：6 个复习阶段 (1天 → 2天 → 4天 → 7天 → 15天 → 30天 → 掌握)
- **动态优先级**：综合"逾期时间"与"难度系数"计算复习优先级
- **难度加权**：Hard ×1.5, Medium ×1.0, Easy ×0.8
- **标签权重**：可对 DP、BFS 等特定标签设置权重偏移

### 📊 极简 UI + 完整 Web 面板
- **Popup 弹窗**：快速查看队列、一键跳转
- **Web Dashboard**：完整仪表盘，独立运行，包含手动添加题目、数据可视化等高级功能
- **标签筛选**：按 Tag / 难度 / 状态多维度过滤
- **极简笔记**：每道题一个文本框，记录核心思路
- **学习热力图**：仿 GitHub 风格，可视化每日刷题活跃度
- **暗色/亮色双主题**

### 💾 数据管理
- **本地持久化**：`chrome.storage.local` 或 `localStorage` 存储，数据安全可靠
- **备份恢复**：支持 JSON 格式的一键导出 / 导入
- **双模式存储**：扩展内使用 chrome.storage（与插件共享），独立运行使用 localStorage

---

## 项目架构

```
LeetCurve/
├── manifest.json              # Chrome MV3 配置
├── background.js              # Service Worker (核心逻辑)
├── content/
│   ├── inject.js              # MAIN World - fetch/XHR 拦截
│   └── content.js             # ISOLATED World - 桥接 & DOM 提取
├── popup/
│   ├── popup.html             # Popup 弹窗页面
│   ├── popup.css              # Popup 样式
│   └── popup.js               # Popup 逻辑
├── web/                       # ★ 独立 Web 面板
│   ├── index.html             # 完整仪表盘页面
│   ├── style.css              # 全页面响应式样式
│   └── app.js                 # 完整业务逻辑 + 存储适配层
├── icons/                     # 扩展图标
├── scripts/
│   └── generate-icons.js      # 图标生成脚本
└── README.md                  # 本文档
```

### 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                         │
│                                                                 │
│  ┌──────────┐    CustomEvent     ┌───────────┐    Message       │
│  │ inject.js├───────────────────►│content.js ├──────────┐      │
│  │(MAIN)    │  leetcurve-accepted│(ISOLATED) │          │      │
│  └──────────┘                    └───────────┘          ▼      │
│       ▲                                          ┌──────────┐  │
│  intercept                                       │background │  │
│  fetch/XHR                                       │   .js     │  │
│       │                                          │(Service   │  │
│  ┌────┴────┐                                     │ Worker)   │  │
│  │LeetCode │                                     └─────┬────┘  │
│  │  Page   │                                           │       │
│  └─────────┘                              chrome.storage.local  │
│                                                   │            │
│  ┌──────────┐                              ┌──────┴──────┐     │
│  │  popup/  ├──── sendMessage ────────────►│             │     │
│  └──────────┘                              │   Storage   │     │
│  ┌──────────┐                              │             │     │
│  │  web/    ├──── direct access ──────────►│             │     │
│  └──────────┘                              └─────────────┘     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    独立 Web 模式                                  │
│                                                                 │
│  ┌──────────┐        localStorage         ┌─────────────┐      │
│  │  web/    ├──── StorageAdapter ────────►│  Browser    │      │
│  │ app.js   │     (自动适配)               │  Storage    │      │
│  └──────────┘                             └─────────────┘      │
│                                                                 │
│  ★ 内嵌完整算法，无需 background.js                               │
│  ★ 支持手动添加题目                                               │
│  ★ 导入/导出兼容扩展数据格式                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 安装与使用

### 方式一：Chrome 扩展（完整功能）

```bash
# 1. 克隆仓库
git clone <repo-url>
cd LeetCurve

# 2. 生成图标
node scripts/generate-icons.js

# 3. 加载扩展
# 打开 chrome://extensions/ → 开发者模式 → 加载已解压的扩展程序 → 选择 LeetCurve 目录

# 4. 使用
# - 去 LeetCode 刷题，Accepted 后自动捕获
# - 点击工具栏图标查看 Popup
# - 点击 Popup 中的 🖥️ 按钮打开完整 Web 面板
```

### 方式二：独立 Web 面板（无需安装扩展）

```bash
# 直接在浏览器中打开
open web/index.html

# 或使用任意静态服务器
npx serve web
# 然后访问 http://localhost:3000
```

> 独立模式下使用 `localStorage` 存储，支持手动添加题目和导入/导出数据。
> 导出的 JSON 文件格式与扩展完全兼容，可以互相导入。

---

## Web 面板功能详情

| 页面 | 功能 |
|------|------|
| **仪表盘** | 统计概览（待复习/总数/已掌握/连续天数）、最紧急题目列表、难度分布图、阶段分布图、近 90 天迷你热力图 |
| **复习队列** | 搜索 + 多维度筛选、按优先级排序的题目卡片、一键跳转 LeetCode、编辑笔记 |
| **热力图** | 完整 365 天 GitHub 风格热力图、总活动次数/活跃天数/最长连续/当前连续统计 |
| **添加题目** | 手动录入题号/名称/难度/标签/链接/笔记 |
| **设置** | 标签权重管理、复习阶段说明、数据导出/导入/清空 |

---

## 核心算法设计

### 艾宾浩斯复习阶段

| 阶段 | 间隔 | 说明 |
|------|------|------|
| Stage 0 | 1 天 | 首次记忆后第一个遗忘高峰 |
| Stage 1 | 2 天 | 短期记忆巩固 |
| Stage 2 | 4 天 | 中期记忆强化 |
| Stage 3 | 7 天 | 一周后复习 |
| Stage 4 | 15 天 | 半月复习 |
| Stage 5 | 30 天 | 月度复习 |
| Stage 6 | ∞ | 已转化为长期记忆 |

### 优先级计算公式

```
priority = overdueRatio × difficultyWeight × tagWeight
```

- **overdueRatio** = `(已过时间 - 预定间隔) / 预定间隔`
  - `> 0`：已逾期，需要复习
  - `< 0`：尚未到期
- **difficultyWeight**：Easy = 0.8, Medium = 1.0, Hard = 1.5
- **tagWeight**：取该题所有标签中用户设定的最大权重值（默认 1.0）

### 冷冻期机制

同一题目 1 小时内的多次 Accepted 仅计为一次，防止复习阶段异常跳级。

---

## 数据结构

```json
{
  "slug": "two-sum",
  "questionId": "1",
  "title": "Two Sum",
  "difficulty": "Easy",
  "tags": ["Array", "Hash Table"],
  "url": "https://leetcode.com/problems/two-sum/",
  "first_accepted_time": 1700000000000,
  "last_review_time": 1700100000000,
  "stage": 2,
  "note": "用 HashMap 存储已遍历元素的下标",
  "review_history": [1700000000000, 1700100000000],
  "priority_score": 1.35
}
```

---

## 技术栈

| 技术 | 用途 |
|------|------|
| Chrome Manifest V3 | 扩展规范 |
| Service Worker | 后台逻辑 (background.js) |
| Content Scripts (MAIN + ISOLATED) | 页面数据采集 |
| chrome.storage.local / localStorage | 持久化（自动适配） |
| chrome.alarms | 定时优先级刷新 |
| Vanilla JS / CSS | 零依赖前端 |

---

## 兼容性

- **浏览器**：Chrome 111+（扩展需要 `"world": "MAIN"` 支持）
- **Web 面板**：任何现代浏览器（Chrome, Firefox, Safari, Edge）
- **网站**：`leetcode.com`（国际版）、`leetcode.cn`（中国版）

---

## 调试方法

| 目标 | 方法 |
|------|------|
| Background | `chrome://extensions/` → LeetCurve → "Service Worker" 链接 |
| Content Script | LeetCode 页面 → DevTools → Console（过滤 `[LeetCurve]`） |
| Popup | 右键插件图标 → "审查弹出式窗口" |
| Web 面板 | 直接打开 DevTools |
| 查看存储 | Background Console: `chrome.storage.local.get(null, d => console.log(d))` |

---

## License

MIT

# dstime · DSH 使用时间记录

一个把「用了多久」记成「真正操作了多久」的 DSH 插件。右下角一个浮框实时显示本次与今日用时，点开是年 / 月 / 次三级日历，数据只存在本机的一个 JSON 文件里。

- 只在**窗口可见且最近 60 秒内有输入**时计时，空闲自动暂停
- 单次不足 1 分钟不记录、不计数，不把切窗口的几秒钟算成一次使用
- 全程本地：没有账号、没有联网上报、不读取会话内容
- 前端 React + 宿主一个本地 HTTP 路由，两种存储互为兜底

---

## 它解决什么问题

大部分「使用时长」统计记的是**会话存在了多久**：开着窗口挂一整天，数字就涨一整天。可真正的问题是另一件事——今天到底在这上面动手做了多久、哪些天是真的在用、一次连续工作有多长。

dstime 只对「有人在操作」的时间计时：

| 状态 | 什么时候 |
| --- | --- |
| 使用中 | 窗口可见，且最近 60 秒内有点击 / 键盘 / 滚动等输入 |
| 已暂停 | 窗口可见，但已经空闲超过 60 秒 |
| 待机 | 窗口不可见（最小化、切到别的应用、锁屏） |

暂停或待机超过 15 分钟后，本次使用结束并归档；下一次输入会开一次新的使用记录。单次不足 1 分钟的片段直接丢弃——它几乎总是切窗口留下的噪声。

## 界面

**右下角浮框**：显示「本次使用」与「今日」两个数字，以及当前状态。可以按住拖动位置，从右下角拉动调整大小，字号跟随界面缩放。计时满 1 分钟时落一次记录，浮框会提示「本次 12 分 30 秒 已保存，计时已清零」。

**日历**：点浮框，或点左侧栏的「dstime」，进入日历页，三种视图：

- **月**：当月每天一格，格子里是当天的总时长；点某一天，下面列出这一天里的每一次使用（第几次、起止时间、时长、是否跨天、是否还在进行中）
- **年**：一年的活跃天数、使用次数，以及每天的热度格子
- **次**：全部使用记录的列表，按时间倒序

底部显示数据文件的实际路径，并提供「导出 JSON」。

## 安装

需要 DSH 0.2.x（带 `dsh plugin` 命令与 Web 界面）。桌面版与 Web 版都可以。

从 GitHub 安装（profile 名按你的客户端填 `web` 或 `desktop`）：

```sh
dsh plugin --profile web add github:uJoea/dsh-time-ledger
```

或者用 Release 里的预构建包（不需要构建步骤，装得更快）：

```sh
dsh plugin --profile web add "https://github.com/uJoea/dsh-time-ledger/releases/latest/download/dsh-time-ledger.tgz"
```

安装后**重启一次 DSH**，左侧栏会出现「dstime」条目，右下角出现浮框。

卸载：

```sh
dsh plugin --profile web remove dsh-time-ledger
```

卸载不会删除已经记录的数据文件。

## 数据存在哪

默认：

```
D:\dsh_common\dstime_data\time-ledger.json
```

想换个位置，在启动 DSH 之前设置环境变量 `DSTIME_DATA_DIR`，插件会把文件写到该目录下。

写入方式：先写临时文件再原子替换；同一时刻只允许一个写操作。多个窗口提交的记录按会话 id 合并，同一段使用以 `updatedAt` 更新的那条为准，不同使用各自保留。

记录内容只有时间戳与按天的时长桶，不包含任何会话标题、消息或文件路径。插件不发起任何外部网络请求——宿主只在 `127.0.0.1` 上暴露一个 `/dsh-time-ledger/state` 路由供自己的前端读写，并且每个请求都要先通过 DSH 宿主的准入检查（`connection.admit`，即宿主对 `/api` 用的同一道 Host/Origin 校验加浏览器会话认证），未通过的请求返回 401/403，不会读写任何数据。

浏览器里会同时留一份 localStorage 副本：宿主服务没连上时前端照常计时，连通后再合并上去（浮框上会提示「服务未连接，暂存在浏览器本地」）。

## 关于「一次使用」

两次输入之间的间隔在 15 分钟以内，算同一次使用；超过 15 分钟，就是两次。跨过午夜的那一次使用不会在这一天结束，第二天它仍然显示为「跨天」，直到你再次空闲下来。所以「次」这一栏回答的是「今天开工了几回」，而不是「点开了几次窗口」。

## 常见问题

**装完没看到浮框？** 重启一次 DSH。宿主会缓存已加载的插件。

**数字一直是 0？** 计时需要窗口可见并且有真实输入；只在后台开着窗口不算。

**和别的计时插件冲突吗？** 不会，它不挂钩子、不改会话，只是自己记自己的。

**支持多显示器 / 多窗口？** 每个窗口各自计时，记录合并到同一个文件里。

## 开发

本仓库就是插件本体，没有构建步骤：`index.js` 是宿主端，`client.js` 是前端，`cordis.patch.yml` 把它插进 profile。改完代码重启一次 DSH 即可生效；本地以 `link:` 方式安装时不需要重新 `add`。

打一个可发布的包：

```powershell
npm.cmd pack     # 生成 dsh-time-ledger-1.0.0.tgz，上传 Release 前改名为 dsh-time-ledger.tgz
```

发布步骤（建仓库、发 Release、给插件市场提 PR）见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。测量语义、单位定义与设计取舍见 [docs/INTRO.md](docs/INTRO.md)。

## English

dstime is a DSH plugin that records how long you actually work in the harness rather than how long a window stayed open. It counts only when the window is visible and there has been input in the last 60 seconds, pauses when idle, and closes a session after 15 idle minutes. Fragments shorter than one minute are discarded.

A floating card in the bottom-right corner shows the current session and today's total; clicking it opens a calendar with year, month and per-session views. Everything is stored locally in one JSON file (atomic writes, sessions merged by `updatedAt`), with a localStorage fallback while the host route is unreachable. No account, no telemetry, no external requests.

Install with `dsh plugin --profile web add github:uJoea/dsh-time-ledger`, then restart DSH.

## License

[MIT](LICENSE)

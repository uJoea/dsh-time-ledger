# 发布指南

这份文档记录 dstime 从本机目录到 GitHub、再到 DSH 插件市场的完整步骤。所有命令都在**普通终端**（Windows Terminal / PowerShell / Git Bash）里执行，不要放在受限沙箱里跑——沙箱内 HTTPS 连接会被重置，`~/.ssh` 也不可写。

## 0. 发布目录从哪来

```
D:\dsh_common\time-ledger              ← 源码目录，本机以 link: 方式安装（包名 @local/dsh-time-ledger）
D:\dsh_common\dist\release\dsh-time-ledger   ← 发布副本，包名 dsh-time-ledger，只有这个目录推上 GitHub
```

两份分开是刻意的：改源码目录的 `package.json` 名字会让本机 profile 里的 `cordis.patch.yml` 找不到模块，正在使用的安装会失效。发布副本由源码目录复制而来，只改了两处（包名、patch 里的 name）并补了 LICENSE / .gitignore。

改完源码后重新生成发布副本：把 `index.js`、`client.js`、`icon.svg`、`README.md` 复制过去，并保持 `package.json` 与 `cordis.patch.yml` 里 `dsh-time-ledger` 的写法不变。

## 1. 仓库已经建好了

https://github.com/uJoea/dsh-time-ledger 已于 2026-11-23T15:52:45Z 创建，Public，默认分支 `main`。仓库里目前只有 GitHub 建仓时顺手生成的三份模板文件：`.gitignore`、`LICENSE`、17 字节的 `README.md` 占位。下面的推送会用本地版本覆盖它们（README 换正式文案、LICENSE 同为 MIT 但作者写 `uJoea`、`.gitignore` 换精简版），没有内容损失，所以直接强推最省事。

还差一步：仓库页 → **Settings → Topics** 加 `dsh-plugin`。市场 CI 会检查这个 topic。

## 2. 首次推送

```powershell
cd D:\dsh_common\dist\release\dsh-time-ledger
git init -b main
git add -A
git commit -m "feat: dstime 1.0.0 — interaction-gated usage time for DSH"
git remote add origin https://github.com/uJoea/dsh-time-ledger.git
git push -u origin main --force
```

`--force` 是必要的：远端已有那三份模板文件的提交，和本地这份历史没有共同祖先，普通 push 会被拒绝。

本机没有 `gh` CLI，用的是 Git Credential Manager（system 配置里 `credential.helper=manager`）：第一次 `push` 会弹出浏览器让你登录 GitHub，登录后凭据由 Windows 凭据管理器保存，之后不再询问。**不需要**手输 token。

提交身份来自 `git config --global user.name / user.email`（当前是 `3048238952` / `3048238952@qq.com`）。想让提交关联到 GitHub 账号，先设置成账号邮箱或 GitHub 的 noreply 地址：

```powershell
git config user.email "you@example.com"
```

### 备用：走 SSH

本机已有 `~/.ssh/id_ed25519`（公钥 `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIItO2g9B+9iGuhBkPtiaikdZROSmKlto+AiHl8S7ErvG`），但 GitHub 上还没登记，探测结果是 `Permission denied (publickey)`。要用 SSH：

1. 复制 `C:\Users\30482\.ssh\id_ed25519.pub` 的全部内容
2. GitHub → Settings → SSH and GPG keys → New SSH key → 粘贴 → Add
3. `git remote set-url origin git@github.com:uJoea/dsh-time-ledger.git`
4. `ssh -T git@github.com` 应返回 `Hi uJoea! You've successfully authenticated...`

若 22 端口被网络封掉，在 `~/.ssh/config` 里写：

```
Host github.com
  Hostname ssh.github.com
  Port 443
  User git
```

## 3. 生成安装包，发一个 Release

```powershell
cd D:\dsh_common\dist\release\dsh-time-ledger
npm.cmd pack
```

得到 `dsh-time-ledger-1.0.0.tgz`。把它改名为不带版本号的 `dsh-time-ledger.tgz`（重要：市场条目用 `latest/download/dsh-time-ledger.tgz`，文件名带版本号的话下次发版就会 404）。

> 注意用 `npm.cmd` 而不是 `npm`：本机 PowerShell 执行策略会拦住 `npm.ps1`。

接着在 GitHub 上：

1. 仓库页 → **Releases → Draft a new release**
2. Tag 填 `v1.0.0`，Target 选 `main`
3. Title 填 `dstime 1.0.0`
4. 附件上传 `dsh-time-ledger.tgz`
5. Publish release

发布后的固定下载地址（市场条目会用到）：

```
https://github.com/uJoea/dsh-time-ledger/releases/latest/download/dsh-time-ledger.tgz
```

## 4. 验证装得上

在另一台机器、或先卸后装的干净 profile 上：

```powershell
dsh plugin --profile web add github:uJoea/dsh-time-ledger
# 或者预构建包：
dsh plugin --profile web add "https://github.com/uJoea/dsh-time-ledger/releases/latest/download/dsh-time-ledger.tgz"
```

装完重启一次 DSH，左侧栏应出现「dstime」，右下角出现浮框。测试完可以 `dsh plugin --profile web remove dsh-time-ledger` 卸掉。

## 5. 提交到 DSH 插件市场

市场列表就是 GitHub 上的精选库 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。市场（dsh-market）和官网都从它生成，所以**只需要在那边提一个 PR**，不要往 dsh-market 仓库提条目。

1. Fork 该仓库
2. 在 `data/plugins/` 下新建文件 **`uJoea__dsh-time-ledger.yml`**（文件名必须是 `<owner>__<repo>.yml`）：

```yaml
url: https://github.com/uJoea/dsh-time-ledger
name: uJoea/dsh-time-ledger
category: usage
description:
  en: 'Records time only while the window is visible and there has been input in the last 60 seconds, shown in a bottom-right card and a year / month / per-session calendar, with everything kept in one local JSON file.'
  zh: '只在窗口可见且最近 60 秒内有输入时计时，右下角浮框实时显示，按年 / 月 / 次查看使用记录；数据只存在本机的一个 JSON 文件里。'
tarball: https://github.com/uJoea/dsh-time-ledger/releases/latest/download/dsh-time-ledger.tgz
```

3. 提交 PR，标题写成 `Add uJoea/dsh-time-ledger`，描述里写一句这个插件做什么即可

硬性要求（CI 会逐条检查）：

- `package.json` 必须声明 `dsh.bundle`（发布副本里已有），只声明 `dsh.client` 会被拒
- 仓库创建满 1 天；刚建好的仓库要等第二天再提
- 仓库打了 `dsh-plugin` topic
- 描述里的每个说法都会被对照源码核对，不要写「支持 46 种统计」这类没有对应实现的数字
- 一个 PR 最多 3 个条目
- 描述里出现「: 」（半角冒号加空格）必须加引号，上面示例已经加了

PR 合并后官网与市场会在下一次构建时收录，通常一天内生效。

### 截图（可选）

市场详情页会从 README 抽图。想自己控制顺序，就在仓库根放 `screenshots.json`：

```json
["assets/screenshot-1.png"]
```

1–8 张，相对路径不能含 `..`，不能指到插件目录之外。

### npm（可选）

发到 npm 能让市场显示下载量，与是否收录无关。发布包里 `repository` 字段已指回本仓库，市场会自动关联：

```powershell
npm.cmd login
npm.cmd publish --access public
```

## 常见问题

**`push` 报 `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`** — 这是沙箱环境的 TLS 限制。换到普通终端执行。

**`push` 报 `Recv failure: Connection was reset`** — 同上，或代理/防火墙拦了 443；可改用 SSH。

**`ssh -T git@github.com` 报 `Permission denied (publickey)`** — 公钥还没登记到 GitHub，见第 2 节备用步骤。

**市场 PR 的 CI 报 "repo is 0.5 days old"** — 等满 1 天后 CI 会自动重跑，不用推空提交。

**Release 的 tarball 链接 404** — 附件名带了版本号，而 URL 用的是 `latest/download/dsh-time-ledger.tgz`。重命名附件，或改成钉住 tag 的 URL。

# Windows 启动说明

本文档说明如何在 Windows 上启动 `gpt-image-2-station` 开发服务。该方式不使用 Docker。

## 前置要求

- 已安装 Node.js 20 或更高版本。
- 已安装 pnpm，或已启用 Corepack。
- 在项目根目录运行脚本：`D:\gpt-image-2-station\gpt-image-2-station`。

如果没有 pnpm，可以先在 PowerShell 中执行：

```powershell
corepack enable
```

如果你的 Node.js 发行版没有启用 Corepack，也可以执行：

```powershell
npm install -g pnpm
```

## 一键启动

在项目根目录双击：

```text
start-windows.bat
```

或在 PowerShell 中执行：

```powershell
.\scripts\start-windows.ps1
```

脚本会自动完成以下步骤：

- 检查 `node` 是否可用。
- 检查 `pnpm` 是否可用。
- 执行 `pnpm install` 安装依赖。
- 检查 `3000` 端口是否被占用。
- 如果 `3000` 被占用，自动尝试 `3001` 到 `3010`。
- 使用可用端口启动 `pnpm dev -- --port <port>`。
- 自动打开浏览器访问 `http://localhost:<port>`。

## 常见问题

### 提示未检测到 Node.js

请先安装 Node.js 20 或更高版本。安装完成后，重新打开 PowerShell，再运行脚本。

### 提示未检测到 pnpm

先尝试：

```powershell
corepack enable
```

如果仍不可用，再执行：

```powershell
npm install -g pnpm
```

### 3000 端口被占用

脚本会自动改用 `3001` 到 `3010` 中的可用端口，并在控制台显示实际访问地址。

### 3000-3010 都被占用

关闭其他占用这些端口的开发服务后重新运行脚本。可以用下面命令查看端口占用：

```powershell
Get-NetTCPConnection -LocalPort 3000,3001,3002,3003,3004,3005,3006,3007,3008,3009,3010
```

### PowerShell 禁止运行脚本

推荐使用根目录的 `start-windows.bat`，它会以当前窗口临时绕过执行策略运行本项目脚本，不会修改系统执行策略。

### 依赖安装失败

通常是网络或 npm 源问题。确认网络可用后重新运行脚本；脚本每次启动都会执行 `pnpm install`，已安装的依赖会被 pnpm 复用。

## 停止服务

开发服务运行后，回到启动窗口按 `Ctrl+C`，按提示确认即可停止。

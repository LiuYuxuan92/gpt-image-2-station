Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Test-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-PortInUse {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    return $null -ne $connections
}

function Get-AvailablePort {
    foreach ($port in 3000..3010) {
        if (-not (Test-PortInUse -Port $port)) {
            return $port
        }
    }

    throw "3000-3010 端口均已被占用，请关闭占用进程后重试。"
}

if (-not (Test-Command -Name "node")) {
    throw "未检测到 Node.js。请先安装 Node.js 20 或更高版本，然后重新运行本脚本。"
}

if (-not (Test-Command -Name "pnpm")) {
    throw "未检测到 pnpm。请先执行 corepack enable，或运行 npm install -g pnpm 后重新运行本脚本。"
}

$nodeVersion = (& node --version).Trim()
$pnpmVersion = (& pnpm --version).Trim()
Write-Host "Node: $nodeVersion"
Write-Host "pnpm: $pnpmVersion"
Write-Host "项目目录: $repoRoot"

Write-Host "正在安装依赖..."
& pnpm install
if ($LASTEXITCODE -ne 0) {
    throw "pnpm install 执行失败，请根据上方错误信息处理后重试。"
}

$port = Get-AvailablePort
$url = "http://localhost:$port"

if ($port -ne 3000) {
    Write-Host "3000 端口已被占用，自动改用 $port。"
}

Write-Host "即将启动开发服务: $url"
Start-Process $url

& pnpm dev -- --port $port
if ($LASTEXITCODE -ne 0) {
    throw "pnpm dev 启动失败，请根据上方错误信息处理后重试。"
}

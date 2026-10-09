<#
.SYNOPSIS
  다른 AI 리뷰용 번들 파일을 만든다.

.DESCRIPTION
  docs/review/REVIEW_PROMPT.md + docs/Requirement.md + docs/구현계획서.md 를
  하나의 파일(docs/review/review-bundle.md)로 합친다.
  - 파일 접근이 되는 AI(Claude Code, Codex, Gemini CLI 등): 번들 없이
    "docs/review/REVIEW_PROMPT.md 를 읽고 지시대로 리뷰해줘" 라고만 하면 된다.
  - 채팅형 AI(ChatGPT, Gemini 웹, Claude.ai 등): 생성된 review-bundle.md 를
    업로드하거나, -Clipboard 옵션으로 복사해 붙여넣는다.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\make-review-bundle.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\make-review-bundle.ps1 -Clipboard
#>
param(
    [switch]$Clipboard
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$parts = @(
    @{ Title = '리뷰 지시서';     Path = 'docs\review\REVIEW_PROMPT.md' },
    @{ Title = 'docs/Requirement.md';  Path = 'docs\Requirement.md' },
    @{ Title = 'docs/구현계획서.md';    Path = 'docs\구현계획서.md' },
    @{ Title = 'docs/guide/Firebase_설정가이드.md';      Path = 'docs\guide\Firebase_설정가이드.md' },
    @{ Title = 'docs/guide/GitHub_데이터저장소_가이드.md'; Path = 'docs\guide\GitHub_데이터저장소_가이드.md' }
)

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("<!-- 생성: $(Get-Date -Format 'yyyy-MM-dd HH:mm') / scripts\make-review-bundle.ps1 -->")
[void]$sb.AppendLine()

foreach ($p in $parts) {
    $full = Join-Path $root $p.Path
    if (-not (Test-Path $full)) { throw "파일이 없습니다: $full" }
    $text = [System.IO.File]::ReadAllText($full, [System.Text.Encoding]::UTF8)
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('=' * 80)
    [void]$sb.AppendLine("# 📄 $($p.Title)")
    [void]$sb.AppendLine('=' * 80)
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine($text)
}

$out = Join-Path $root 'docs\review\review-bundle.md'
[System.IO.File]::WriteAllText($out, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))

$sizeKb = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Output "번들 생성 완료: $out ($sizeKb KB)"

if ($Clipboard) {
    Set-Clipboard -Value $sb.ToString()
    Write-Output '클립보드에 복사했습니다. 채팅창에 붙여넣으세요.'
}

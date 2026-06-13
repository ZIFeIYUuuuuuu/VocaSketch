param(
  [string]$Path = (Join-Path $PSScriptRoot ".env.live-image.local")
)

if (-not (Test-Path -LiteralPath $Path)) {
  throw "Env file not found: $Path"
}

$loaded = @()
Get-Content -LiteralPath $Path | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) {
    return
  }

  $parts = $line -split "=", 2
  if ($parts.Count -ne 2) {
    return
  }

  $name = $parts[0].Trim()
  $value = $parts[1].Trim()
  if (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  Set-Item -Path "Env:$name" -Value $value
  $loaded += $name
}

Write-Host ("Loaded VocaSketch live image env variables: " + ($loaded -join ", "))

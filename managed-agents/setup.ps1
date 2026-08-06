# Cria o ambiente compartilhado e os dois agentes de design.
# Idempotente: se já existir um ids.json com env_id, reaproveita o ambiente
# e só recria o que faltar (ex: agentes, se a criação anterior falhou).

$ant = "$env:LOCALAPPDATA\ant\ant.exe"
$dir = $PSScriptRoot

Write-Host "== Status de autenticação =="
& $ant auth status
Write-Host ""

$existing = $null
if (Test-Path "$dir\ids.json") {
    try { $existing = Get-Content "$dir\ids.json" | ConvertFrom-Json } catch { $existing = $null }
}

if ($existing -and $existing.env_id -and ($existing.env_id -match '^env_')) {
    $envId = $existing.env_id
    Write-Host "== Reaproveitando ambiente existente =="
    Write-Host "Environment ID: $envId"
} else {
    Write-Host "== Criando ambiente compartilhado (design-env) =="
    $envId = Get-Content -Raw "$dir\design.environment.yaml" | & $ant beta:environments create --transform id -r
    Write-Host "Environment ID: $envId"
}
Write-Host ""

if ($existing -and $existing.android_agent_id -and ($existing.android_agent_id -match '^agent_')) {
    $androidId = $existing.android_agent_id
    Write-Host "== Agente Android já existe =="
    Write-Host "Android Agent ID: $androidId"
} else {
    Write-Host "== Criando agente: Especialista Design Mobile Android =="
    $androidId = Get-Content -Raw "$dir\android-design.agent.yaml" | & $ant beta:agents create --transform id -r
    Write-Host "Android Agent ID: $androidId"
}
Write-Host ""

if ($existing -and $existing.web_agent_id -and ($existing.web_agent_id -match '^agent_')) {
    $webId = $existing.web_agent_id
    Write-Host "== Agente Web já existe =="
    Write-Host "Web Agent ID: $webId"
} else {
    Write-Host "== Criando agente: Especialista Design Web =="
    $webId = Get-Content -Raw "$dir\web-design.agent.yaml" | & $ant beta:agents create --transform id -r
    Write-Host "Web Agent ID: $webId"
}
Write-Host ""

$ids = @{
    env_id           = $envId
    android_agent_id = $androidId
    web_agent_id     = $webId
} | ConvertTo-Json

Set-Content -Path "$dir\ids.json" -Value $ids
Write-Host "== IDs salvos em ids.json =="
Write-Host $ids

if ($androidId -notmatch '^agent_' -or $webId -notmatch '^agent_') {
    Write-Host ""
    Write-Host "AVISO: um ou mais agentes não foram criados (veja o erro acima)." -ForegroundColor Yellow
    Write-Host "Resolva o problema e rode o script de novo — ele vai pular o que já deu certo." -ForegroundColor Yellow
}

# Inicia (ou continua) uma sessão com um dos agentes de design.
#
# Nova conversa:
#   .\start-design-session.ps1 -Agent android -Message "Quero redesenhar a tela de login do meu app"
#   .\start-design-session.ps1 -Agent web -Message "Preciso de uma landing page para minha loja"
#
# Continuar a mesma conversa (use o SessionId impresso na primeira chamada):
#   .\start-design-session.ps1 -SessionId sesn_xxxxx -Message "Sim, pode usar essa paleta"
#
# Enquanto a resposta estiver sendo exibida, pressione Ctrl+C para voltar ao
# prompt quando o agente terminar (a conexão de streaming fica aberta).

param(
    [ValidateSet("android", "web")][string]$Agent,
    [Parameter(Mandatory = $true)][string]$Message,
    [string]$SessionId
)

$ant = "$env:LOCALAPPDATA\ant\ant.exe"
$dir = $PSScriptRoot

if (-not (Test-Path "$dir\ids.json")) {
    throw "ids.json não encontrado. Rode .\setup.ps1 primeiro."
}
$ids = Get-Content "$dir\ids.json" | ConvertFrom-Json

if (-not $SessionId) {
    if (-not $Agent) {
        throw "Para iniciar uma nova conversa, informe -Agent android ou -Agent web."
    }
    $agentId = if ($Agent -eq "android") { $ids.android_agent_id } else { $ids.web_agent_id }

    $SessionId = & $ant beta:sessions create --agent $agentId --environment-id $ids.env_id --title "Sessao de design" --transform id -r
    Write-Host "Nova sessão: $SessionId"
    Write-Host "Acompanhe ao vivo em: https://platform.claude.com/workspaces/default/sessions/$SessionId"
    Write-Host "(guarde este ID para continuar a conversa depois: -SessionId $SessionId)"
    Write-Host ""
}

$eventBody = @{
    events = @(
        @{
            type    = "user.message"
            content = @(@{ type = "text"; text = $Message })
        }
    )
} | ConvertTo-Json -Depth 10

$eventBody | & $ant beta:sessions:events send --session-id $SessionId | Out-Null

& $ant beta:sessions:events stream --session-id $SessionId

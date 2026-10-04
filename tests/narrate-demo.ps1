$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
New-Item -ItemType Directory -Force submission | Out-Null
Add-Type -AssemblyName System.Speech
$waypointSpeech=[System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $waypointSpeech.SelectVoice('Microsoft Zira Desktop')
    $waypointSpeech.Rate=0
    $waypointScenes=Get-Content docs/VIDEO_NARRATION.json -Raw | ConvertFrom-Json
    foreach($waypointScene in $waypointScenes) {
        $waypointWav=Join-Path (Get-Location) ('submission/'+$waypointScene.id+'.wav')
        $waypointSpeech.SetOutputToWaveFile($waypointWav)
        $waypointSpeech.Speak($waypointScene.text)
        $waypointSpeech.SetOutputToNull()
        Write-Output ('Narrated '+$waypointScene.id)
    }
} finally { $waypointSpeech.Dispose() }

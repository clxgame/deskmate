param([Parameter(Mandatory = $true)][string]$ArchivePath)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead([System.IO.Path]::GetFullPath($ArchivePath))
try {
    $manifestEntry = $archive.GetEntry('pack.json')
    if ($null -eq $manifestEntry) { throw 'Archive has no pack.json' }
    $reader = New-Object System.IO.StreamReader($manifestEntry.Open())
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    $entries = @(foreach ($entry in $archive.Entries) {
        $stream = $entry.Open()
        $hash = [System.Security.Cryptography.SHA256]::Create()
        try {
            [ordered]@{
                path = $entry.FullName
                sha256 = [System.BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
            }
        } finally { $hash.Dispose(); $stream.Dispose() }
    })
    [ordered]@{ manifest = $manifest; entries = $entries } | ConvertTo-Json -Depth 20
} finally { $archive.Dispose() }

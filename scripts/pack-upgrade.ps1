param(
    [Parameter(Mandatory = $true)][string]$SourceArchive,
    [Parameter(Mandatory = $true)][string]$OutputArchive,
    [Parameter(Mandatory = $true)][string]$MetadataPath,
    [Parameter(Mandatory = $true)][string]$ReportPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\') + '\'
$source = [System.IO.Path]::GetFullPath($SourceArchive)
$output = [System.IO.Path]::GetFullPath($OutputArchive)
$report = [System.IO.Path]::GetFullPath($ReportPath)
foreach ($destination in @($output, $report)) {
    if (!$destination.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Upgrade outputs must stay inside the project workspace'
    }
    if (Test-Path -LiteralPath $destination) { throw "Destination already exists: $destination" }
}
if ($source -eq $output) { throw 'The original archive must never be overwritten' }
$metadata = Get-Content -LiteralPath $MetadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($language in @('zh', 'en', 'ja', 'ko')) {
    if ($metadata.name.$language -isnot [string] -or [string]::IsNullOrWhiteSpace($metadata.name.$language)) {
        throw "Missing display name: $language"
    }
}
if ($metadata.thumbnail -notmatch '^personas/[A-Za-z0-9_-]{1,64}/pack-thumbnail\.png$') {
    throw 'The cover must be a PNG within a persona directory'
}
if ($metadata.cover -notmatch '^[A-Za-z0-9_-]+\.png$') { throw 'Invalid build-only cover filename' }
$cover = Join-Path $PSScriptRoot ('persona-packs/' + $metadata.cover)
$outputDirectory = [System.IO.Path]::GetDirectoryName($output)
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($report)) | Out-Null
$working = Join-Path $outputDirectory ('.dmpack-upgrade-' + [guid]::NewGuid().ToString('N') + '.tmp')

function Get-EntryHashes([System.IO.Compression.ZipArchive]$Archive) {
    $hashes = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([System.StringComparer]::Ordinal)
    $normalizedNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $Archive.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        if ($name -ne 'pack.json' -and $name -notmatch '^(personas|skills)/[A-Za-z0-9_-]{1,64}/[^:]+') {
            throw "Unexpected archive path: $name"
        }
        if (@($name.TrimEnd('/').Split('/') | Where-Object { $_ -eq '.' -or $_ -eq '..' -or $_ -eq '' }).Count -gt 0) {
            throw "Unsafe archive path: $name"
        }
        if (!$normalizedNames.Add($name)) { throw "Duplicate archive path: $name" }
        $stream = $entry.Open()
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hashes.Add($entry.FullName, [System.BitConverter]::ToString(
                $hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant())
        } finally { $hasher.Dispose(); $stream.Dispose() }
    }
    return ,$hashes
}

$sourceStream = [System.IO.File]::Open($source, [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
try {
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    $sourceSize = $sourceStream.Length
    $original = New-Object System.IO.Compression.ZipArchive($sourceStream,
        [System.IO.Compression.ZipArchiveMode]::Read, $true)
    try {
        $originalHashes = Get-EntryHashes $original
        $originalDirectoryCount = @($original.Entries | Where-Object { $_.FullName.EndsWith('/') }).Count
        $manifestEntry = $original.GetEntry('pack.json')
        if ($null -eq $manifestEntry) { throw 'Original archive has no root pack.json' }
        $reader = New-Object System.IO.StreamReader($manifestEntry.Open())
        try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        $originalVersion = $manifest.version
        $originalPersonas = $manifest.personas | ConvertTo-Json -Depth 40 -Compress
        $thumbnailPersona = $metadata.thumbnail.Split('/')[1]
        if ($manifest.personas.id -notcontains $thumbnailPersona) {
            throw 'The cover refers to a persona missing from the source archive'
        }
        if ($originalHashes.ContainsKey($metadata.thumbnail)) { throw 'The new cover would overwrite an original asset' }
    } finally { $original.Dispose() }

    $sourceStream.Position = 0
    $workingStream = [System.IO.File]::Open($working, [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $sourceStream.CopyTo($workingStream) } finally { $workingStream.Dispose() }
    $updated = [System.IO.Compression.ZipFile]::Open($working, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $manifest.version = $Version
        $manifest | Add-Member -NotePropertyName name -NotePropertyValue $metadata.name -Force
        $manifest | Add-Member -NotePropertyName thumbnail -NotePropertyValue $metadata.thumbnail -Force
        $updated.GetEntry('pack.json').Delete()
        $entry = $updated.CreateEntry('pack.json', [System.IO.Compression.CompressionLevel]::Optimal)
        $writer = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding($false)))
        try { $writer.WriteLine(($manifest | ConvertTo-Json -Depth 40)) } finally { $writer.Dispose() }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $updated, $cover, $metadata.thumbnail, [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    } finally { $updated.Dispose() }

    $verified = [System.IO.Compression.ZipFile]::OpenRead($working)
    try {
        $updatedHashes = Get-EntryHashes $verified
        $reader = New-Object System.IO.StreamReader($verified.GetEntry('pack.json').Open())
        try { $updatedManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if (($updatedManifest.personas | ConvertTo-Json -Depth 40 -Compress) -cne $originalPersonas) {
            throw 'The upgrade changed the per-persona manifest data'
        }
        if ($updatedHashes.Count -ne $originalHashes.Count + 1) { throw 'Unexpected archive entry count' }
        $assetChecks = @(foreach ($entryPath in $originalHashes.Keys | Sort-Object) {
            if ($entryPath -eq 'pack.json') { continue }
            if (!$updatedHashes.ContainsKey($entryPath) -or $originalHashes[$entryPath] -cne $updatedHashes[$entryPath]) {
                throw "Original asset changed: $entryPath"
            }
            [ordered]@{ path = $entryPath; sha256 = $originalHashes[$entryPath]; unchanged = $true }
        })
        $coverHash = (Get-FileHash -LiteralPath $cover -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($updatedHashes[$metadata.thumbnail] -cne $coverHash) { throw 'Cover bytes differ from the build-only asset' }
    } finally { $verified.Dispose() }
    $sourceHashAfter = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceHashAfter -cne $sourceHash) { throw 'The original archive changed during upgrade' }
    $result = [ordered]@{
        source = [ordered]@{ path = $source; version = $originalVersion; bytes = $sourceSize; sha256 = $sourceHash; entryCount = $originalHashes.Count }
        output = [ordered]@{ path = $output; version = $Version; bytes = (Get-Item -LiteralPath $working).Length; sha256 = (Get-FileHash -LiteralPath $working -Algorithm SHA256).Hash.ToLowerInvariant(); entryCount = $updatedHashes.Count }
        personaCount = @($updatedManifest.personas).Count
        originalFileUnchanged = $true
        perPersonaManifestUnchanged = $true
        originalAssetsVerified = $assetChecks.Count - $originalDirectoryCount
        originalNonManifestEntriesVerified = $assetChecks.Count
        originalDirectoryEntriesVerified = $originalDirectoryCount
        allOriginalAssetsUnchanged = $true
        addedEntries = @([ordered]@{ path = $metadata.thumbnail; sha256 = $coverHash })
        changedOriginalEntries = @('pack.json')
        manifest = $updatedManifest
        entryChecks = $assetChecks
    }
    [System.IO.File]::Move($working, $output)
    $reportStream = [System.IO.File]::Open($report, [System.IO.FileMode]::CreateNew)
    $writer = New-Object System.IO.StreamWriter($reportStream, (New-Object System.Text.UTF8Encoding($false)))
    try { $writer.WriteLine(($result | ConvertTo-Json -Depth 40)) } finally { $writer.Dispose() }
    $result.output | ConvertTo-Json
} finally {
    $sourceStream.Dispose()
    if ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($working)) -ne $outputDirectory) {
        throw 'Temporary archive cleanup must stay inside the output directory'
    }
    if (Test-Path -LiteralPath $working) { Remove-Item -LiteralPath $working }
}

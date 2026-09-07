param(
    [Parameter(Mandatory = $true)][string]$SourceDirectory,
    [Parameter(Mandatory = $true)][string]$ArchivePath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source = [System.IO.Path]::GetFullPath($SourceDirectory).TrimEnd('\') + '\'
$archive = [System.IO.Compression.ZipFile]::Open(
    [System.IO.Path]::GetFullPath($ArchivePath), [System.IO.Compression.ZipArchiveMode]::Create
)
try {
    foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse) {
        if (!$file.FullName.StartsWith($source, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'Archive source must remain inside its staging directory'
        }
        $entryName = $file.FullName.Substring($source.Length).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally { $archive.Dispose() }

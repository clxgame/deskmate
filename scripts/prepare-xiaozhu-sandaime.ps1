param([Parameter(Mandatory)][string]$SourceDirectory)
$ErrorActionPreference = 'Stop'
$states = @('等待', '思考', '打招呼', '跳舞', '哭', '开心', '争辩')
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\public\personas\xiaozhu-sandaime'))
$tables = @{}
foreach ($table in @('nodes','animations','materials','meshes','textures','images','skins','accessors','bufferViews','samplers')) {
    $tables[$table] = [Collections.Generic.List[object]]::new()
}
$roots = [Collections.Generic.List[int]]::new()
$provenance = [Collections.Generic.List[object]]::new()
$viewCache = @{}; $imageCache = @{}; $samplerCache = @{}; $textureCache = @{}
$binary = [IO.MemoryStream]::new()

function Add-BufferView([byte[]]$Bytes, [hashtable]$View, [int]$BinaryStart) {
    if ([int]$View.buffer -ne 0) { throw 'Only embedded buffer 0 is supported' }
    $data = [byte[]]::new([int]$View.byteLength)
    [Array]::Copy($Bytes, ($BinaryStart + [int]$View.byteOffset), $data, 0, $data.Length)
    $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($data))
    $key = "$hash|$($View.byteStride)|$($View.target)"
    if ($viewCache.ContainsKey($key)) { return $viewCache[$key] }
    while ($binary.Length % 4) { $binary.WriteByte(0) }
    $copy = $View.Clone(); $copy.buffer = 0; $copy.byteOffset = $binary.Length
    $binary.Write($data, 0, $data.Length)
    $index = $tables.bufferViews.Count
    $tables.bufferViews.Add($copy); $viewCache[$key] = $index
    return $index
}

function Update-TextureReferences([System.Collections.IDictionary]$Object, [int[]]$Map) {
    foreach ($key in @($Object.Keys)) {
        $value = $Object[$key]
        if ($value -is [System.Collections.IDictionary]) {
            if ($key -like '*Texture' -and $value.Contains('index')) { $value.index = $Map[[int]$value.index] }
            Update-TextureReferences $value $Map
        }
    }
}

try {
    foreach ($state in $states) {
        $path = Join-Path $SourceDirectory "$state.glb"
        $bytes = [IO.File]::ReadAllBytes($path)
        if ([BitConverter]::ToUInt32($bytes, 0) -ne 0x46546C67 -or [BitConverter]::ToInt32($bytes, 4) -ne 2 -or [BitConverter]::ToInt32($bytes, 8) -ne $bytes.Length) { throw "Invalid GLB: $path" }
        $jsonLength = [BitConverter]::ToInt32($bytes, 12)
        if ([BitConverter]::ToUInt32($bytes, 16) -ne 0x4E4F534A -or [BitConverter]::ToUInt32($bytes, 24 + $jsonLength) -ne 0x004E4942) { throw "Unexpected GLB chunks: $path" }
        $doc = [Text.Encoding]::UTF8.GetString($bytes, 20, $jsonLength) | ConvertFrom-Json -AsHashtable
        if ($doc.animations.Count -ne 1 -or $doc.buffers.Count -ne 1 -or $doc.buffers[0].ContainsKey('uri') -or $doc.ContainsKey('cameras')) { throw "Unsupported source layout: $path" }
        foreach ($extension in $doc.extensionsUsed) { if ($extension -ne 'KHR_materials_specular') { throw "Unsupported extension: $extension" } }
        $nodeBase = $tables.nodes.Count; $accessorBase = $tables.accessors.Count
        $meshBase = $tables.meshes.Count; $skinBase = $tables.skins.Count; $materialBase = $tables.materials.Count
        $viewMap = [int[]]::new($doc.bufferViews.Count)
        for ($i = 0; $i -lt $viewMap.Length; $i++) { $viewMap[$i] = Add-BufferView $bytes $doc.bufferViews[$i] (28 + $jsonLength) }
        foreach ($accessor in $doc.accessors) {
            if ($accessor.ContainsKey('bufferView')) { $accessor.bufferView = $viewMap[[int]$accessor.bufferView] }
            if ($accessor.ContainsKey('sparse')) {
                $accessor.sparse.indices.bufferView = $viewMap[[int]$accessor.sparse.indices.bufferView]
                $accessor.sparse.values.bufferView = $viewMap[[int]$accessor.sparse.values.bufferView]
            }
            $tables.accessors.Add($accessor)
        }
        $samplerMap = [int[]]::new($doc.samplers.Count)
        for ($i = 0; $i -lt $samplerMap.Length; $i++) {
            $key = $doc.samplers[$i] | ConvertTo-Json -Compress -Depth 10
            if (!$samplerCache.ContainsKey($key)) { $samplerCache[$key] = $tables.samplers.Count; $tables.samplers.Add($doc.samplers[$i]) }
            $samplerMap[$i] = $samplerCache[$key]
        }
        $imageMap = [int[]]::new($doc.images.Count)
        for ($i = 0; $i -lt $imageMap.Length; $i++) {
            $img = $doc.images[$i]
            if (!$img.ContainsKey('bufferView') -or $img.ContainsKey('uri')) { throw 'Images must be embedded' }
            $img.bufferView = $viewMap[[int]$img.bufferView]
            $key = "$($img.bufferView)|$($img.mimeType)"
            if (!$imageCache.ContainsKey($key)) { $imageCache[$key] = $tables.images.Count; $tables.images.Add($img) }
            $imageMap[$i] = $imageCache[$key]
        }
        $textureMap = [int[]]::new($doc.textures.Count)
        for ($i = 0; $i -lt $textureMap.Length; $i++) {
            $texture = $doc.textures[$i]; $texture.source = $imageMap[[int]$texture.source]
            if ($texture.ContainsKey('sampler')) { $texture.sampler = $samplerMap[[int]$texture.sampler] }
            $key = $texture | ConvertTo-Json -Compress -Depth 10
            if (!$textureCache.ContainsKey($key)) { $textureCache[$key] = $tables.textures.Count; $tables.textures.Add($texture) }
            $textureMap[$i] = $textureCache[$key]
        }
        foreach ($material in $doc.materials) { Update-TextureReferences $material $textureMap; $tables.materials.Add($material) }
        foreach ($mesh in $doc.meshes) {
            foreach ($primitive in $mesh.primitives) {
                foreach ($key in @($primitive.attributes.Keys)) { $primitive.attributes[$key] = [int]$primitive.attributes[$key] + $accessorBase }
                if ($primitive.ContainsKey('indices')) { $primitive.indices = [int]$primitive.indices + $accessorBase }
                if ($primitive.ContainsKey('material')) { $primitive.material = [int]$primitive.material + $materialBase }
                foreach ($target in $primitive.targets) { foreach ($key in @($target.Keys)) { $target[$key] = [int]$target[$key] + $accessorBase } }
            }
            $tables.meshes.Add($mesh)
        }
        foreach ($skin in $doc.skins) {
            $skin.joints = @($skin.joints | ForEach-Object { [int]$_ + $nodeBase })
            if ($skin.ContainsKey('inverseBindMatrices')) { $skin.inverseBindMatrices = [int]$skin.inverseBindMatrices + $accessorBase }
            if ($skin.ContainsKey('skeleton')) { $skin.skeleton = [int]$skin.skeleton + $nodeBase }
            $tables.skins.Add($skin)
        }
        for ($i = 0; $i -lt $doc.nodes.Count; $i++) {
            $node = $doc.nodes[$i]; $node.name = "Sandaime_${state}__${i}_$($node.name)"
            if ($node.ContainsKey('children')) { $node.children = @($node.children | ForEach-Object { [int]$_ + $nodeBase }) }
            if ($node.ContainsKey('mesh')) { $node.mesh = [int]$node.mesh + $meshBase }
            if ($node.ContainsKey('skin')) { $node.skin = [int]$node.skin + $skinBase }
            $tables.nodes.Add($node)
        }
        $roots.Add($tables.nodes.Count)
        $tables.nodes.Add(@{name="Sandaime_$state";children=@($doc.scenes[[int]$doc.scene].nodes | ForEach-Object { [int]$_ + $nodeBase })})
        $animation = $doc.animations[0]; $animation.name = $state
        foreach ($sampler in $animation.samplers) { $sampler.input = [int]$sampler.input + $accessorBase; $sampler.output = [int]$sampler.output + $accessorBase }
        foreach ($channel in $animation.channels) { $channel.target.node = [int]$channel.target.node + $nodeBase }
        $tables.animations.Add($animation)
        $provenance.Add([ordered]@{action=$state;file="$state.glb";sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant();bytes=$bytes.Length})
    }
    while ($binary.Length % 4) { $binary.WriteByte(0) }
    $result = [ordered]@{asset=@{version='2.0';generator='YUME lossless state-variant packer'};extensionsUsed=@('KHR_materials_specular');scene=0;scenes=@(@{name='小著（三代目）';nodes=$roots.ToArray()});buffers=@(@{byteLength=$binary.Length})}
    foreach ($key in $tables.Keys) { $result[$key] = $tables[$key].ToArray() }
    $json = [Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json -Depth 100 -Compress))
    $paddedJsonLength = $json.Length + (4 - $json.Length % 4) % 4
    $output = [IO.MemoryStream]::new()
    $writer = [IO.BinaryWriter]::new($output)
    try {
        $writer.Write([uint32]0x46546C67); $writer.Write([uint32]2); $writer.Write([uint32](28 + $paddedJsonLength + $binary.Length))
        $writer.Write([uint32]$paddedJsonLength); $writer.Write([uint32]0x4E4F534A); $writer.Write($json)
        while (($output.Length - 20) % 4) { $writer.Write([byte]32) }
        $writer.Write([uint32]$binary.Length); $writer.Write([uint32]0x004E4942); $writer.Write($binary.ToArray())
        [void][IO.Directory]::CreateDirectory($outputDirectory)
        [IO.File]::WriteAllBytes((Join-Path $outputDirectory 'figure.glb'), $output.ToArray())
    } finally { $writer.Dispose(); $output.Dispose() }
    $receipt = [ordered]@{description='Seven independent authored rigs, meshes, materials and clips. Runtime selects one clip root. Only byte-identical buffer views, images, textures and samplers are shared.';sourceFiles=$provenance.ToArray();images=$tables.images.Count;meshes=$tables.meshes.Count;outputBytes=(Get-Item -LiteralPath (Join-Path $outputDirectory 'figure.glb')).Length}
    [IO.File]::WriteAllText((Join-Path $outputDirectory 'provenance.json'), ($receipt|ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    $receipt | ConvertTo-Json -Depth 8
} finally { $binary.Dispose() }
# ==============================
# Parse Colorado ACL -> normalized JSON
# Server version
# ==============================

$TargetRoot = "C:\PrintGuard\ColoradoAccounting"
$LogPath = Join-Path $TargetRoot "parse-acl-log.txt"

$Printers = @(
    @{
        Name = "Colorado-91"
        PrinterIp = "10.25.1.91"
        SerialPrefix = "990402625"
        AclFolder = Join-Path $TargetRoot "Colorado-91\acl"
        JsonFolder = Join-Path $TargetRoot "Colorado-91\normalized-acl"
    },
    @{
        Name = "Colorado-92"
        PrinterIp = "10.25.1.92"
        SerialPrefix = "990402624"
        AclFolder = Join-Path $TargetRoot "Colorado-92\acl"
        JsonFolder = Join-Path $TargetRoot "Colorado-92\normalized-acl"
    }
)

function Write-Log {
    param(
        [string]$Message
    )

    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Ensure-Folder {
    param(
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function To-NullableInt {
    param(
        $Value
    )

    if ($null -eq $Value -or $Value -eq '') {
        return $null
    }

    $n = 0
    if ([int]::TryParse([string]$Value, [ref]$n)) {
        return $n
    }

    return $null
}

function To-NullableDurationSeconds {
    param(
        $Value
    )

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return $null
    }

    $text = [string]$Value
    $direct = To-NullableInt -Value $text
    if ($null -ne $direct) {
        return $direct
    }

    try {
        $span = [timespan]::Parse($text)
        return [int][math]::Round($span.TotalSeconds)
    }
    catch {
        return $null
    }
}

function To-BoolFromResult {
    param(
        [string]$Result,
        [string]$Expected
    )

    if ([string]::IsNullOrWhiteSpace($Result)) {
        return $false
    }

    return ($Result.Trim().ToLowerInvariant() -eq $Expected.Trim().ToLowerInvariant())
}

function Build-DateTime {
    param(
        [string]$DatePart,
        [string]$TimePart
    )

    if ([string]::IsNullOrWhiteSpace($DatePart) -or [string]::IsNullOrWhiteSpace($TimePart)) {
        return $null
    }

    try {
        return ([datetime]::Parse("$DatePart $TimePart")).ToString("yyyy-MM-ddTHH:mm:ss")
    }
    catch {
        return $null
    }
}

function Get-SourceDateFromFileName {
    param(
        [string]$FileName
    )

    if ($FileName -match '(\d{8})\.(ACL|acl)$') {
        $d = $matches[1]
        return ("{0}-{1}-{2}" -f $d.Substring(0, 4), $d.Substring(4, 2), $d.Substring(6, 2))
    }

    return $null
}

function Get-NormalizedFieldName {
    param(
        [string]$Name
    )

    if ([string]::IsNullOrWhiteSpace($Name)) {
        return $null
    }

    $normalized = $Name.Trim().ToLowerInvariant()
    $normalized = [regex]::Replace($normalized, '[^a-z0-9]+', '_')
    $normalized = $normalized.Trim('_')

    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return $null
    }

    return $normalized
}

function Get-AclSchemaInfo {
    param(
        [string[]]$Lines
    )

    $nonEmptyLines = @($Lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($nonEmptyLines.Count -eq 0) {
        return $null
    }

    $headerLine = $nonEmptyLines | Where-Object { $_ -match '^\s*4302(?:;|$)' } | Select-Object -First 1
    if (-not $headerLine) {
        $headerLine = $nonEmptyLines | Where-Object { $_ -match ';' } | Select-Object -First 1
    }

    if (-not $headerLine) {
        return $null
    }

    $tokens = @($headerLine.Split(';') | ForEach-Object { $_.Trim() })
    if ($tokens.Count -lt 2) {
        return $null
    }

    $formatCode = $tokens[0]
    $columns = if ($tokens.Count -gt 1) { $tokens[1..($tokens.Count - 1)] } else { @() }
    $normalizedColumns = @(
        $columns |
        ForEach-Object { Get-NormalizedFieldName -Name $_ }
    )
    $dataLines = @($nonEmptyLines | Where-Object { $_ -match '^\s*4303(?:;|$)' })

    return [ordered]@{
        format            = "acl-4302-4303"
        formatCode        = $formatCode
        headerColumns     = $columns
        normalizedColumns = $normalizedColumns
        columnCount       = $columns.Count
        dataRowCount      = $dataLines.Count
        hasDataRows       = ($dataLines.Count -gt 0)
    }
}

function Get-DedupeKey {
    param(
        $Row
    )

    if ($Row.rowType -eq "acl_file") {
        return (@(
            $Row.printerName,
            $Row.sourceFile,
            $Row.rowType
        ) -join "|")
    }

    $jobIdentity = if ($null -ne $Row.jobId -and [string]$Row.jobId -ne '') {
        $Row.jobId
    }
    elseif ($Row.documentId) {
        $Row.documentId
    }
    else {
        "no-job-id"
    }

    $readyIdentity = if ($Row.readyAt) { $Row.readyAt } else { "no-ready-at" }

    return (@(
        $Row.printerName,
        $Row.sourceFile,
        $jobIdentity,
        $Row.result,
        $readyIdentity
    ) -join "|")
}

function New-AclFileRecord {
    param(
        [string]$ImportedAt,
        [string]$PrinterName,
        [string]$PrinterIp,
        [string]$SerialPrefix,
        $File,
        [string]$SourceDate,
        [string[]]$Lines,
        [string]$RawText,
        [string]$ContentHash,
        $SchemaInfo
    )

    $parsedFields = [ordered]@{}
    if ($SchemaInfo) {
        $parsedFields["detected_format"] = $SchemaInfo.format
        $parsedFields["format_code"] = $SchemaInfo.formatCode
        $parsedFields["header_columns"] = $SchemaInfo.headerColumns
        $parsedFields["normalized_columns"] = $SchemaInfo.normalizedColumns
        $parsedFields["column_count"] = $SchemaInfo.columnCount
        $parsedFields["data_row_count"] = $SchemaInfo.dataRowCount
        $parsedFields["has_data_rows"] = $SchemaInfo.hasDataRows
    }

    $obj = [ordered]@{
        importedAt        = $ImportedAt
        printerName       = $PrinterName
        printerIp         = $PrinterIp
        serialPrefix      = $SerialPrefix
        sourceFile        = $File.Name
        sourceDate        = $SourceDate
        rowType           = "acl_file"
        fileSizeBytes     = [int64]$File.Length
        lineCount         = $Lines.Count
        nonEmptyLineCount = @($Lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
        detectedFormat    = if ($SchemaInfo) { $SchemaInfo.format } else { "raw-text" }
        contentHash       = $ContentHash
        parsedFields      = [pscustomobject]$parsedFields
        rawLines          = $Lines
        rawText           = $RawText
    }

    $obj.dedupeKey = Get-DedupeKey -Row $obj
    return [pscustomobject]$obj
}

function New-AclJobRecord {
    param(
        [string]$ImportedAt,
        [string]$PrinterName,
        [string]$PrinterIp,
        [string]$SerialPrefix,
        [string]$SourceFile,
        [string]$SourceDate,
        $RowData
    )

    $readyAt = Build-DateTime -DatePart $RowData.readydate -TimePart $RowData.readytime
    $startAt = Build-DateTime -DatePart $RowData.startdate -TimePart $RowData.starttime
    $receptionAt = Build-DateTime -DatePart $RowData.receptiondate -TimePart $RowData.receptiontime
    $activeTimeSec = To-NullableDurationSeconds -Value $RowData.activetime
    $idleTimeSec = To-NullableDurationSeconds -Value $RowData.idletime

    $obj = [ordered]@{
        importedAt      = $ImportedAt
        printerName     = $PrinterName
        printerIp       = $PrinterIp
        serialPrefix    = $SerialPrefix
        sourceFile      = $SourceFile
        sourceDate      = $SourceDate
        rowType         = "print"
        documentId      = $RowData.documentid
        jobId           = To-NullableInt -Value $RowData.jobid
        jobType         = $RowData.jobtype
        jobName         = $RowData.jobname
        printMode       = $RowData.printmode
        startAt         = $startAt
        readyAt         = $readyAt
        receptionAt     = $receptionAt
        activeTimeSec   = $activeTimeSec
        idleTimeSec     = $idleTimeSec
        durationSec     = $null
        result          = $RowData.result
        isPrinted       = To-BoolFromResult -Result $RowData.result -Expected "Done"
        isDeleted       = To-BoolFromResult -Result $RowData.result -Expected "Deleted"
        isAborted       = (To-BoolFromResult -Result $RowData.result -Expected "Abrt") -or (To-BoolFromResult -Result $RowData.result -Expected "Aborted")
        finishedSets    = To-NullableInt -Value $RowData.noffinishedsets
        copiesRequested = To-NullableInt -Value $RowData.copiesrequested
        mediaTypeId     = $RowData.mediatypeid
        mediaType       = $RowData.mediatype
        mediaWidth      = To-NullableInt -Value $RowData.mediawidth
        mediaLengthUsed = To-NullableInt -Value $RowData.medialengthused
        printedArea     = To-NullableInt -Value $RowData.printedarea
        inkCyan         = To-NullableInt -Value $RowData.inkcolorcyan
        inkMagenta      = To-NullableInt -Value $RowData.inkcolormagenta
        inkYellow       = To-NullableInt -Value $RowData.inkcoloryellow
        inkBlack        = To-NullableInt -Value $RowData.inkcolorblack
        inkWhite        = To-NullableInt -Value $RowData.inkcolorwhite
        numberOfLayers  = To-NullableInt -Value $RowData.numberoflayers
        layerStructure  = $RowData.layerstructure
        rawRow          = $RowData
    }

    if ($obj.startAt -and $obj.readyAt) {
        try {
            $ts1 = [datetime]::Parse($obj.startAt)
            $ts2 = [datetime]::Parse($obj.readyAt)
            $obj.durationSec = [int][math]::Round(($ts2 - $ts1).TotalSeconds)
        }
        catch {
            $obj.durationSec = $activeTimeSec
        }
    }
    elseif ($null -ne $activeTimeSec) {
        $obj.durationSec = $activeTimeSec
    }

    $obj.dedupeKey = Get-DedupeKey -Row $obj
    return [pscustomobject]$obj
}

function Get-AclJobRows {
    param(
        [string[]]$Lines,
        [string]$ImportedAt,
        [string]$PrinterName,
        [string]$PrinterIp,
        [string]$SerialPrefix,
        [string]$SourceFile,
        [string]$SourceDate
    )

    $headerLine = $Lines | Where-Object { $_ -match '^\s*4302(?:;|$)' } | Select-Object -First 1
    if (-not $headerLine) {
        return @()
    }

    $headerTokens = @($headerLine.Split(';') | ForEach-Object { $_.Trim() })
    if ($headerTokens.Count -lt 2) {
        return @()
    }

    $columnNames = if ($headerTokens.Count -gt 1) { $headerTokens[1..($headerTokens.Count - 1)] } else { @() }
    $normalizedColumns = @($columnNames | ForEach-Object { Get-NormalizedFieldName -Name $_ })
    $dataLines = @($Lines | Where-Object { $_ -match '^\s*4303(?:;|$)' })
    $rows = @()

    foreach ($line in $dataLines) {
        $tokens = @($line.Split(';'))
        if ($tokens.Count -lt 2) {
            continue
        }

        $valueTokens = if ($tokens.Count -gt 1) { $tokens[1..($tokens.Count - 1)] } else { @() }
        $rowData = [ordered]@{}

        for ($i = 0; $i -lt $normalizedColumns.Count; $i++) {
            $key = $normalizedColumns[$i]
            if (-not $key) {
                continue
            }

            $value = if ($i -lt $valueTokens.Count) { $valueTokens[$i].Trim() } else { $null }
            $rowData[$key] = $value
        }

        if ($valueTokens.Count -gt $normalizedColumns.Count) {
            $rowData["_extra_tokens"] = @($valueTokens[$normalizedColumns.Count..($valueTokens.Count - 1)] | ForEach-Object { $_.Trim() })
        }

        $rows += New-AclJobRecord `
            -ImportedAt $ImportedAt `
            -PrinterName $PrinterName `
            -PrinterIp $PrinterIp `
            -SerialPrefix $SerialPrefix `
            -SourceFile $SourceFile `
            -SourceDate $SourceDate `
            -RowData ([pscustomobject]$rowData)
    }

    return $rows
}

Ensure-Folder -Path $TargetRoot
Write-Log "==================== START ACL PARSE ===================="

foreach ($printer in $Printers) {
    $printerName = $printer.Name
    $printerIp = $printer.PrinterIp
    $serialPrefix = $printer.SerialPrefix
    $aclFolder = $printer.AclFolder
    $jsonFolder = $printer.JsonFolder

    Ensure-Folder -Path $jsonFolder

    if (-not (Test-Path $aclFolder)) {
        Write-Log "[$printerName] ACL folder neexistuje: $aclFolder"
        continue
    }

    $aclFiles = Get-ChildItem -Path $aclFolder -Filter *.acl -File -ErrorAction SilentlyContinue

    foreach ($file in $aclFiles) {
        try {
            Write-Log "[$printerName] Parsuji ACL: $($file.Name)"

            $raw = Get-Content -Path $file.FullName -Raw -Encoding UTF8
            if ($null -eq $raw) {
                $raw = ""
            }

            $raw = $raw -replace "^\uFEFF", ""
            $lines = [regex]::Split($raw, "\r?\n")
            $sourceDate = Get-SourceDateFromFileName -FileName $file.Name
            $contentHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            $schemaInfo = Get-AclSchemaInfo -Lines $lines
            $importedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")

            $normalized = @()
            $normalized += New-AclFileRecord `
                -ImportedAt $importedAt `
                -PrinterName $printerName `
                -PrinterIp $printerIp `
                -SerialPrefix $serialPrefix `
                -File $file `
                -SourceDate $sourceDate `
                -Lines $lines `
                -RawText $raw `
                -ContentHash $contentHash `
                -SchemaInfo $schemaInfo

            $jobRows = Get-AclJobRows `
                -Lines $lines `
                -ImportedAt $importedAt `
                -PrinterName $printerName `
                -PrinterIp $printerIp `
                -SerialPrefix $serialPrefix `
                -SourceFile $file.Name `
                -SourceDate $sourceDate

            if ($jobRows.Count -gt 0) {
                $normalized += $jobRows
            }

            $jsonPath = Join-Path $jsonFolder ($file.BaseName + ".json")
            $normalized | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath -Encoding UTF8

            Write-Log "[$printerName] OK ACL: $($file.Name) -> $jsonPath (jobs: $($jobRows.Count))"
        }
        catch {
            Write-Log "[$printerName] CHYBA pri parsovani ACL $($file.Name): $($_.Exception.Message)"
        }
    }
}

Write-Log "===================== END ACL PARSE ====================="

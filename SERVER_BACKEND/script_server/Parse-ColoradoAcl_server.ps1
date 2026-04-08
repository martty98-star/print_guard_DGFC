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

function Get-ParsedFields {
    param(
        [string[]]$Lines
    )

    $fields = [ordered]@{}

    foreach ($line in $Lines) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        if ($line -match '^\s*([^:=;]+?)\s*[:=;]\s*(.+?)\s*$') {
            $key = Get-NormalizedFieldName -Name $matches[1]
            $value = $matches[2].Trim()

            if ($key -and -not $fields.Contains($key)) {
                $fields[$key] = $value
            }
        }
    }

    return $fields
}

function Get-DedupeKey {
    param(
        $Row
    )

    $parts = @(
        $Row.printerName,
        $Row.sourceFile,
        $Row.rowType
    )

    return ($parts -join "|")
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
            $parsedFields = Get-ParsedFields -Lines $lines
            $sourceDate = Get-SourceDateFromFileName -FileName $file.Name
            $contentHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash

            $obj = [ordered]@{
                importedAt        = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
                printerName       = $printerName
                printerIp         = $printerIp
                serialPrefix      = $serialPrefix
                sourceFile        = $file.Name
                sourceDate        = $sourceDate
                rowType           = "acl"
                fileSizeBytes     = [int64]$file.Length
                lineCount         = $lines.Count
                nonEmptyLineCount = @($lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
                contentHash       = $contentHash
                parsedFields      = [pscustomobject]$parsedFields
                rawLines          = $lines
                rawText           = $raw
            }

            $obj.dedupeKey = Get-DedupeKey -Row $obj

            $jsonPath = Join-Path $jsonFolder ($file.BaseName + ".json")
            $obj | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath -Encoding UTF8

            Write-Log "[$printerName] OK ACL: $($file.Name) -> $jsonPath"
        }
        catch {
            Write-Log "[$printerName] CHYBA pri parsovani ACL $($file.Name): $($_.Exception.Message)"
        }
    }
}

Write-Log "===================== END ACL PARSE ====================="

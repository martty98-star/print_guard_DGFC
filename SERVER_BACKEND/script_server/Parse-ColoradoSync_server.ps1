# ==============================
# Parse Colorado CSV -> normalized JSON
# Server version
# ==============================

$TargetRoot = "C:\PrintGuard\ColoradoAccounting"
$LogPath = Join-Path $TargetRoot "parse-log.txt"

$Printers = @(
    @{
        Name = "Colorado-91"
        PrinterIp = "10.25.1.91"
        SerialPrefix = "990402625"
        CsvFolder = Join-Path $TargetRoot "Colorado-91\csv"
        JsonFolder = Join-Path $TargetRoot "Colorado-91\normalized"
    },
    @{
        Name = "Colorado-92"
        PrinterIp = "10.25.1.92"
        SerialPrefix = "990402624"
        CsvFolder = Join-Path $TargetRoot "Colorado-92\csv"
        JsonFolder = Join-Path $TargetRoot "Colorado-92\normalized"
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

    if ($FileName -match '(\d{8})\.(CSV|csv)$') {
        $d = $matches[1]
        return ("{0}-{1}-{2}" -f $d.Substring(0, 4), $d.Substring(4, 2), $d.Substring(6, 2))
    }

    return $null
}

function Get-DedupeKey {
    param(
        $Row
    )

    $parts = @(
        $Row.printerName,
        $Row.sourceFile,
        $Row.jobId,
        $Row.result,
        $Row.readyAt
    )

    return ($parts -join "|")
}

Ensure-Folder -Path $TargetRoot
Write-Log "==================== START PARSE ===================="

foreach ($printer in $Printers) {
    $printerName = $printer.Name
    $printerIp = $printer.PrinterIp
    $serialPrefix = $printer.SerialPrefix
    $csvFolder = $printer.CsvFolder
    $jsonFolder = $printer.JsonFolder

    Ensure-Folder -Path $jsonFolder

    if (-not (Test-Path $csvFolder)) {
        Write-Log "[$printerName] CSV folder neexistuje: $csvFolder"
        continue
    }

    $csvFiles = Get-ChildItem -Path $csvFolder -Filter *.csv -File -ErrorAction SilentlyContinue

    foreach ($file in $csvFiles) {
        try {
            Write-Log "[$printerName] Parsuji: $($file.Name)"

            $rows = Import-Csv -Path $file.FullName -Delimiter ';'
            $normalized = @()

            foreach ($r in $rows) {
                $readyAt = Build-DateTime -DatePart $r.readydate -TimePart $r.readytime
                $startAt = Build-DateTime -DatePart $r.startdate -TimePart $r.starttime
                $receptionAt = Build-DateTime -DatePart $r.receptiondate -TimePart $r.receptiontime
                $sourceDate = Get-SourceDateFromFileName -FileName $file.Name

                $obj = [ordered]@{
                    importedAt      = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
                    printerName     = $printerName
                    printerIp       = $printerIp
                    serialPrefix    = $serialPrefix
                    sourceFile      = $file.Name
                    sourceDate      = $sourceDate
                    rowType         = "print"
                    documentId      = $r.documentid
                    jobId           = To-NullableInt $r.jobid
                    jobType         = $r.jobtype
                    jobName         = $r.jobname
                    printMode       = $r.printmode
                    startAt         = $startAt
                    readyAt         = $readyAt
                    receptionAt     = $receptionAt
                    activeTimeSec   = To-NullableInt $r.activetime
                    idleTimeSec     = To-NullableInt $r.idletime
                    durationSec     = $null
                    result          = $r.result
                    isPrinted       = To-BoolFromResult -Result $r.result -Expected "Done"
                    isDeleted       = To-BoolFromResult -Result $r.result -Expected "Deleted"
                    isAborted       = To-BoolFromResult -Result $r.result -Expected "Abrt"
                    finishedSets    = To-NullableInt $r.noffinishedsets
                    copiesRequested = To-NullableInt $r.copiesrequested
                    mediaTypeId     = $r.mediatypeid
                    mediaType       = $r.mediatype
                    mediaWidth      = To-NullableInt $r.mediawidth
                    mediaLengthUsed = To-NullableInt $r.medialengthused
                    printedArea     = To-NullableInt $r.printedarea
                    inkCyan         = To-NullableInt $r.inkcolorcyan
                    inkMagenta      = To-NullableInt $r.inkcolormagenta
                    inkYellow       = To-NullableInt $r.inkcoloryellow
                    inkBlack        = To-NullableInt $r.inkcolorblack
                    inkWhite        = To-NullableInt $r.inkcolorwhite
                    numberOfLayers  = To-NullableInt $r.numberoflayers
                    layerStructure  = $r.layerstructure
                    rawRow          = $r
                }

                if ($obj.startAt -and $obj.readyAt) {
                    try {
                        $ts1 = [datetime]::Parse($obj.startAt)
                        $ts2 = [datetime]::Parse($obj.readyAt)
                        $obj.durationSec = [int][math]::Round(($ts2 - $ts1).TotalSeconds)
                    }
                    catch {
                        $obj.durationSec = $null
                    }
                }

                $obj.dedupeKey = Get-DedupeKey -Row $obj
                $normalized += [pscustomobject]$obj
            }

            $jsonPath = Join-Path $jsonFolder ($file.BaseName + ".json")
            $normalized | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath -Encoding UTF8

            Write-Log "[$printerName] OK: $($file.Name) -> $jsonPath"
        }
        catch {
            Write-Log "[$printerName] CHYBA pri parsovani $($file.Name): $($_.Exception.Message)"
        }
    }
}

Write-Log "===================== END PARSE ====================="
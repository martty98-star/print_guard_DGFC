# ==============================
# Colorado Accounting Downloader
# Server version
# PowerShell 5.1 compatible
# FIXED: response.Content byte[] -> string
# ==============================

$TargetRoot = "C:\PrintGuard\ColoradoAccounting"
$TimeoutSec = 30
$DownloadCsv = $true
$DownloadAcl = $true
$AlwaysRefreshAcl = $true

$Printers = @(
    @{
        Name = "Colorado-91"
        Ip = "10.25.1.91"
        BaseUrl = "http://10.25.1.91/accounting/"
        SerialPrefix = "990402625"
    },
    @{
        Name = "Colorado-92"
        Ip = "10.25.1.92"
        BaseUrl = "http://10.25.1.92/accounting/"
        SerialPrefix = "990402624"
    }
)

function Write-Log {
    param(
        [string]$LogPath,
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

function Load-Manifest {
    param(
        [string]$ManifestPath
    )

    if (Test-Path $ManifestPath) {
        try {
            $raw = Get-Content -Path $ManifestPath -Raw -Encoding UTF8
            if (-not [string]::IsNullOrWhiteSpace($raw)) {
                return ($raw | ConvertFrom-Json)
            }
        }
        catch {
        }
    }

    return [pscustomobject]@{
        csvFiles = @()
        aclFiles = @()
    }
}

function Save-Manifest {
    param(
        $Manifest,
        [string]$ManifestPath
    )

    $Manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $ManifestPath -Encoding UTF8
}

function Get-AbsoluteUrl {
    param(
        [string]$BaseUrl,
        [string]$RelativePath
    )

    if ([string]::IsNullOrWhiteSpace($RelativePath)) {
        return $null
    }

    if ($RelativePath -match '^https?://') {
        return $RelativePath
    }

    $baseUri = New-Object System.Uri($BaseUrl)
    $absoluteUri = New-Object System.Uri($baseUri, $RelativePath)
    return $absoluteUri.AbsoluteUri
}

function Get-DownloadLinksFromHtml {
    param(
        [string]$Html,
        [string]$BaseUrl
    )

    $results = @()

    if ([string]::IsNullOrWhiteSpace($Html)) {
        return $results
    }

    $parts = $Html -split 'href="'

    foreach ($part in $parts) {
        if ($part -notmatch '"') {
            continue
        }

        $href = $part.Split('"')[0]

        if ([string]::IsNullOrWhiteSpace($href)) {
            continue
        }

        $hrefLower = $href.ToLowerInvariant()

        if ($hrefLower.EndsWith(".csv") -or $hrefLower.EndsWith(".acl")) {
            $fileName = [System.IO.Path]::GetFileName($href)

            if (-not [string]::IsNullOrWhiteSpace($fileName)) {
                $ext = [System.IO.Path]::GetExtension($fileName).ToUpperInvariant()
                $url = Get-AbsoluteUrl -BaseUrl $BaseUrl -RelativePath $href

                $results += [pscustomobject]@{
                    FileName = $fileName
                    Url      = $url
                    Ext      = $ext
                }
            }
        }
    }

    return ($results | Sort-Object FileName -Unique)
}

function Download-File {
    param(
        [string]$Url,
        [string]$DestinationPath,
        [int]$TimeoutSec
    )

    Invoke-WebRequest -Uri $Url -OutFile $DestinationPath -TimeoutSec $TimeoutSec -UseBasicParsing
}

function Contains-Value {
    param(
        [array]$Array,
        [string]$Value
    )

    return ($Array -contains $Value)
}

function Convert-ResponseContentToString {
    param(
        $Content
    )

    if ($null -eq $Content) {
        return ""
    }

    if ($Content -is [byte[]]) {
        return [System.Text.Encoding]::ASCII.GetString($Content)
    }

    if ($Content -is [System.Array]) {
        return [System.Text.Encoding]::ASCII.GetString([byte[]]$Content)
    }

    return [string]$Content
}

function Sync-Printer {
    param(
        [hashtable]$Printer
    )

    $printerName = $Printer.Name
    $baseUrl = $Printer.BaseUrl

    $printerRoot = Join-Path $TargetRoot $printerName
    $csvFolder = Join-Path $printerRoot "csv"
    $aclFolder = Join-Path $printerRoot "acl"
    $manifestPath = Join-Path $printerRoot "manifest.json"
    $logPath = Join-Path $printerRoot "sync-log.txt"
    $lastIndexPath = Join-Path $printerRoot "last-index.html"

    Ensure-Folder -Path $TargetRoot
    Ensure-Folder -Path $printerRoot
    Ensure-Folder -Path $csvFolder
    Ensure-Folder -Path $aclFolder

    Write-Log -LogPath $logPath -Message "==================== START $printerName ===================="
    Write-Log -LogPath $logPath -Message ("Nacitam index: {0}" -f $baseUrl)

    try {
        $manifest = Load-Manifest -ManifestPath $manifestPath

        if (-not $manifest.csvFiles) {
            $manifest | Add-Member -NotePropertyName csvFiles -NotePropertyValue @() -Force
        }

        if (-not $manifest.aclFiles) {
            $manifest | Add-Member -NotePropertyName aclFiles -NotePropertyValue @() -Force
        }

        $response = Invoke-WebRequest -Uri $baseUrl -TimeoutSec $TimeoutSec -UseBasicParsing
        $html = Convert-ResponseContentToString -Content $response.Content

        $html | Set-Content -Path $lastIndexPath -Encoding UTF8

        $links = Get-DownloadLinksFromHtml -Html $html -BaseUrl $baseUrl

        Write-Log -LogPath $logPath -Message ("DEBUG: Parser nasel {0} linku/linky." -f $links.Count)

        foreach ($link in $links) {
            Write-Log -LogPath $logPath -Message ("DEBUG LINK: {0}" -f $link.FileName)
        }

        if (-not $links -or $links.Count -eq 0) {
            Write-Log -LogPath $logPath -Message "Na strance nebyly nalezeny zadne CSV ani ACL soubory."
            Write-Log -LogPath $logPath -Message ("DEBUG: Delka HTML = {0}" -f $html.Length)
            return
        }

        Write-Log -LogPath $logPath -Message ("Nalezeno accounting souboru celkem: {0}" -f $links.Count)

        foreach ($item in $links) {
            $fileName = $item.FileName
            $ext = $item.Ext
            $fileUrl = $item.Url

            if ($ext -eq ".CSV" -and $DownloadCsv) {
                $targetPath = Join-Path $csvFolder $fileName
                $isKnown = Contains-Value -Array $manifest.csvFiles -Value $fileName

                if ((-not $isKnown) -or (-not (Test-Path $targetPath))) {
                    Write-Log -LogPath $logPath -Message ("Stahuji CSV: {0}" -f $fileName)
                    Download-File -Url $fileUrl -DestinationPath $targetPath -TimeoutSec $TimeoutSec

                    if (-not $isKnown) {
                        $manifest.csvFiles += $fileName
                    }
                }
                else {
                    Write-Log -LogPath $logPath -Message ("CSV uz existuje, preskakuji: {0}" -f $fileName)
                }
            }
            elseif ($ext -eq ".ACL" -and $DownloadAcl) {
                $targetPath = Join-Path $aclFolder $fileName
                $isKnown = Contains-Value -Array $manifest.aclFiles -Value $fileName

                if ($AlwaysRefreshAcl -or (-not (Test-Path $targetPath))) {
                    Write-Log -LogPath $logPath -Message ("Aktualizuji ACL: {0}" -f $fileName)
                    Download-File -Url $fileUrl -DestinationPath $targetPath -TimeoutSec $TimeoutSec
                }
                else {
                    Write-Log -LogPath $logPath -Message ("ACL uz existuje, preskakuji: {0}" -f $fileName)
                }

                if (-not $isKnown) {
                    $manifest.aclFiles += $fileName
                }
            }
        }

        Save-Manifest -Manifest $manifest -ManifestPath $manifestPath
        Write-Log -LogPath $logPath -Message "Sync dokonceny v poradku."
    }
    catch {
        Write-Log -LogPath $logPath -Message ("CHYBA: {0}" -f $_.Exception.Message)
        throw
    }
    finally {
        Write-Log -LogPath $logPath -Message "===================== END ====================="
    }
}

foreach ($printer in $Printers) {
    Sync-Printer -Printer $printer
}
# HTTP Server for M6-B Keyboard Tool
param(
    [int]$Port = 8080,
    [string]$AutoOpen = "true"
)

$autoOpenBool = $AutoOpen -eq "true" -or $AutoOpen -eq "1"
$currentDir = Get-Location
$backupDir = Join-Path $currentDir "备份"

if (-not (Test-Path $backupDir -PathType Container)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
    Write-Host "[INFO] Created backup directory: $backupDir"
}

function Test-Port {
    param([int]$PortToTest)
    try {
        $tcpClient = New-Object System.Net.Sockets.TCPClient
        $tcpClient.Connect("127.0.0.1", $PortToTest)
        $tcpClient.Close()
        return $false
    } catch {
        return $true
    }
}

$availablePort = $Port
$portTries = @($Port, 8081, 8082, 8083, 8086, 8087, 8088, 8089, 8090, 8091)

foreach ($p in $portTries) {
    if (Test-Port -PortToTest $p) {
        $availablePort = $p
        break
    }
}

if ($availablePort -ne $Port) {
    Write-Host "[WARN] Port $Port is in use, using port $availablePort"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$availablePort/")
$listener.Prefixes.Add("http://127.0.0.1:$availablePort/")

try {
    $listener.Start()
    Write-Host ""
    Write-Host "[OK] Server started successfully on http://localhost:$availablePort"
    Write-Host ""
    
    if ($autoOpenBool) {
        Write-Host "[INFO] Opening browser..."
        Start-Process "http://localhost:$availablePort"
    }
    
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $response = $context.Response
        $urlPath = $context.Request.Url.LocalPath
        
        if ($urlPath -eq "/api/backup" -and $context.Request.HttpMethod -eq "POST") {
            try {
                $sourceFile = Join-Path $currentDir "index.html"
                $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
                $backupFile = Join-Path $backupDir "index_$timestamp.html"
                
                Copy-Item $sourceFile $backupFile
                
                $result = @{
                    success = $true
                    filename = "index_$timestamp.html"
                    path = $backupFile
                }
                $jsonResponse = [System.Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json))
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $jsonResponse.Length
                $response.OutputStream.Write($jsonResponse, 0, $jsonResponse.Length)
                Write-Host "[OK] Backup created: $backupFile"
            } catch {
                $result = @{
                    success = $false
                    error = $_.Exception.Message
                }
                $jsonResponse = [System.Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json))
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $jsonResponse.Length
                $response.OutputStream.Write($jsonResponse, 0, $jsonResponse.Length)
                Write-Host "[ERROR] Backup failed:" $_.Exception.Message
            }
            $response.Close()
            continue
        }
        
        if ($urlPath -eq "/") {
            $urlPath = "/index.html"
        }
        
        $filePath = Join-Path $currentDir $urlPath
        
        if (Test-Path $filePath -PathType Leaf) {
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $content.Length
            
            $extension = [System.IO.Path]::GetExtension($filePath).ToLower()
            switch ($extension) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".css" { $response.ContentType = "text/css; charset=utf-8" }
                ".js" { $response.ContentType = "application/javascript; charset=utf-8" }
                ".json" { $response.ContentType = "application/json; charset=utf-8" }
                ".ico" { $response.ContentType = "image/x-icon" }
                ".png" { $response.ContentType = "image/png" }
                ".jpg" { $response.ContentType = "image/jpeg" }
                ".gif" { $response.ContentType = "image/gif" }
                ".svg" { $response.ContentType = "image/svg+xml" }
                default { $response.ContentType = "application/octet-stream" }
            }
            
            $response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $response.StatusCode = 404
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("404 - File not found")
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        }
        
        $response.Close()
    }
} catch {
    Write-Host "[ERROR] Failed to start server:" $_.Exception.Message
    Write-Host "[ERROR] Trying alternative ports..."
    
    foreach ($p in $portTries) {
        if ($p -eq $availablePort) { continue }
        try {
            $listener = New-Object System.Net.HttpListener
            $listener.Prefixes.Add("http://localhost:$p/")
            $listener.Start()
            Write-Host "[OK] Server started on http://localhost:$p"
            if ($autoOpenBool) {
                Start-Process "http://localhost:$p"
            }
            while ($listener.IsListening) {
                $context = $listener.GetContext()
                $response = $context.Response
                $response.Close()
            }
            break
        } catch {
            Write-Host "[WARN] Port $p also in use"
        }
    }
} finally {
    if ($listener -and $listener.IsListening) {
        try {
            $listener.Stop()
        } catch {
        }
    }
}
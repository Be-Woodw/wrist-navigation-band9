$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$jdk = $env:JAVA_HOME
if (-not $jdk -or -not (Test-Path -LiteralPath "$jdk/bin/java.exe")) {
    throw 'Install JDK 17+ and set JAVA_HOME. This command creates/reuses ONLY the independent Band 9 development identity.'
}
$keystore = Join-Path $root 'signing/band9/development.p12'
if (-not (Test-Path -LiteralPath $keystore)) {
    foreach ($mode in @('debug', 'release')) {
        foreach ($name in @('private.pem', 'certificate.pem')) {
            if (Test-Path -LiteralPath (Join-Path $root "band9/sign/$mode/$name")) {
                throw 'PEM files exist without the matching keystore. Restore the private backup; do not generate a replacement identity.'
            }
        }
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $keystore) | Out-Null
    & "$jdk/bin/keytool.exe" -genkeypair -keystore $keystore -storetype PKCS12 -storepass android -keypass android -alias band9-navigation -keyalg RSA -keysize 2048 -validity 3650 -dname 'CN=Band 9 Navigation Development, O=Local Development, C=CN'
    if ($LASTEXITCODE -ne 0) { throw 'Band 9 key generation failed.' }
}
& "$jdk/bin/java.exe" "$PSScriptRoot/ExportBand9Signing.java" $root
if ($LASTEXITCODE -ne 0) { throw 'Band 9 PEM export failed; no existing key was intentionally replaced.' }
Write-Host 'Band 9 local identity prepared. Build the APK with -Pband9 and the RPK from band9/. Never commit these private files.'

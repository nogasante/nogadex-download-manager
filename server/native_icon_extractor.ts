import { execFile } from 'child_process';
import fs from 'fs';

const iconCache = new Map<string, string>();

export function getNativeAppIcon(filePath?: string, filename?: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve(null);
    }

    const targetName = filePath || filename || '';
    const parts = targetName.toLowerCase().split('.');
    const ext = parts.length > 1 ? parts.pop()! : '';

    const hasPhysicalFile = Boolean(filePath && fs.existsSync(filePath));
    const cacheKey = hasPhysicalFile ? filePath! : `ext:${ext}`;

    if (iconCache.has(cacheKey)) {
      return resolve(iconCache.get(cacheKey)!);
    }

    const cleanPath = (filePath && fs.existsSync(filePath)) ? filePath : '';
    const cleanExt = ext.replace(/[^a-z0-9]/gi, '');

    if (!cleanPath && !cleanExt) {
      return resolve(null);
    }

    const script = `
Add-Type -AssemblyName System.Drawing
$file = '${cleanPath.replace(/'/g, "''")}'
$ext = '.${cleanExt.replace(/'/g, "''")}'
$icon = $null

if ($file -and (Test-Path $file)) {
  try { $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($file) } catch {}
}

if (-not $icon -and $ext -and $ext.Length -gt 1) {
  try {
    $tempFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "ndm_icon_assoc_" + $cleanExt + $ext)
    if (-not (Test-Path $tempFile)) {
      [System.IO.File]::WriteAllBytes($tempFile, [byte[]]@(77, 90, 144, 0))
    }
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($tempFile)
  } catch {}
}

if ($icon) {
  try {
    $ms = New-Object System.IO.MemoryStream
    $b = $icon.ToBitmap()
    $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $b.Dispose()
    $icon.Dispose()
    Write-Output ([Convert]::ToBase64String($ms.ToArray()))
  } catch {}
}
`;

    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 4000 }, (_err, stdout) => {
      const base64 = (stdout || '').trim();
      if (base64 && base64.length > 50) {
        const dataUrl = `data:image/png;base64,${base64}`;
        iconCache.set(cacheKey, dataUrl);
        return resolve(dataUrl);
      }
      resolve(null);
    });
  });
}

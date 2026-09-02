import React, { useState } from 'react';

interface FileIconProps {
  filename: string;
  className?: string;
}

const EXTENSION_MAP: Record<string, string> = {
  zip: 'zip', rar: 'rar', '7z': '7z', tar: 'tar', gz: 'gz', bz2: 'bz2', iso: 'iso', dmg: 'dmg',
  exe: 'exe', msi: 'msi', bat: 'exe', cmd: 'exe', apk: 'apk', bin: 'bin',
  pdf: 'pdf', doc: 'doc', docx: 'docx', xls: 'xls', xlsx: 'xlsx', ppt: 'ppt', pptx: 'pptx',
  txt: 'txt', csv: 'csv', json: 'json', xml: 'xml',
  mp4: 'mp4', mkv: 'mkv', avi: 'avi', mov: 'mov', wmv: 'wmv', flv: 'flv', webm: 'webm',
  mp3: 'mp3', wav: 'wav', flac: 'flac', aac: 'aac', ogg: 'ogg', m4a: 'm4a',
  jpg: 'jpg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp', bmp: 'bmp', svg: 'svg',
};

export const FileIcon: React.FC<FileIconProps> = ({ filename, className = 'w-4 h-4' }) => {
  const parts = filename.toLowerCase().split('.');
  const ext = parts.length > 1 ? parts.pop()! : '';
  const mapped = EXTENSION_MAP[ext] || 'default';

  // Live dynamic icon endpoint on Windows
  const dynamicSrc = `/api/file-icons/${ext || 'default'}`;
  const staticFallback = `/file-icons/${mapped}.png`;

  const [src, setSrc] = useState(dynamicSrc);

  return (
    <img
      src={src}
      alt=""
      className={`${className} object-contain shrink-0 select-none pointer-events-none`}
      onError={() => {
        if (src !== staticFallback) {
          setSrc(staticFallback);
        } else {
          setSrc('/file-icons/default.png');
        }
      }}
    />
  );
};

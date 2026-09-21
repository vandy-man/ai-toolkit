import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getDatasetsRoot } from '@/server/settings';
import { resolveDetachedPythonPath } from '../../../../../cron/pythonPath';

// 单张图片底部裁剪(小红书水印)。原地裁、无备份; 清该图的 .thumbs 缓存与 latent 缓存。
const CROP_ONE = `
import sys
from PIL import Image
f, pct = sys.argv[1], float(sys.argv[2])
im = Image.open(f).convert('RGB')
w, h = im.size
im.crop((0, 0, w, max(1, int(h * (1 - pct / 100.0))))).save(f)
print(f"{im.size[0]}x{int(h*(1-pct/100.0))}")
`;

export async function POST(request: Request) {
  try {
    const { imgPath, bottomPct } = await request.json();
    if (typeof imgPath !== 'string' || !imgPath) {
      return NextResponse.json({ error: 'imgPath is required' }, { status: 400 });
    }
    const pct = Number(bottomPct ?? 7);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 50) {
      return NextResponse.json({ error: 'bottomPct must be in (0,50)' }, { status: 400 });
    }
    const ext = path.extname(imgPath).toLowerCase();
    if (!['.webp', '.jpg', '.jpeg', '.png'].includes(ext)) {
      return NextResponse.json({ error: 'unsupported image type' }, { status: 400 });
    }

    const datasetsRoot = await getDatasetsRoot();
    const resolved = path.resolve(imgPath);
    if (!resolved.startsWith(path.resolve(datasetsRoot) + path.sep)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const size: string = await new Promise((resolve, reject) => {
      const child = spawn(resolveDetachedPythonPath(), ['-c', CROP_ONE, resolved, String(pct)]);
      let out = '';
      let err = '';
      child.stdout.on('data', d => (out += d.toString()));
      child.stderr.on('data', d => (err += d.toString()));
      child.on('error', reject);
      child.on('close', code =>
        code === 0 ? resolve(out.trim()) : reject(new Error(err || `exit ${code}`))
      );
    });

    // 缩略图失效: 删除该图对应的预生成 jpg (按需重建, 且有 mtime 自愈兜底)
    const thumb = path.join(path.dirname(resolved), '.thumbs', path.basename(resolved) + '.jpg');
    if (fs.existsSync(thumb)) fs.rmSync(thumb, { force: true });

    // latent 缓存失效: 清掉该数据集的 .cache (单图粒度不可靠, 整目录最稳)
    const cacheDir = path.join(path.dirname(resolved), '.cache');
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });

    return NextResponse.json({ success: true, imgPath: resolved, bottomPct: pct, size });
  } catch (error: any) {
    console.error('Error cropping image:', error);
    return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getDatasetsRoot } from '@/server/settings';

// 人脸聚类: 调 ComfyUI venv 的 insightface(那边装好了), 拼图写 <dataset>/.clusters/
// 两种调用: {datasetName, eps} 跑聚类; {datasetName, pick, destName} 从 clusters.json 拷贝建新集
const COMFY_PY = '/mnt/d97f340e-fc7f-4dfb-af7a-d4bea3de38c0/ComfyUI/venv/bin/python';

const PY = `
import glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
Image.MAX_TEXT_CHUNK = 256 * 1024 * 1024
from insightface.app import FaceAnalysis

dataset, out_dir, eps = sys.argv[1], sys.argv[2], float(sys.argv[3])
files = sorted([f for f in glob.glob(os.path.join(dataset, '**', '*'), recursive=True)
                if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))
                and '/.clusters/' not in f and '/.thumbs/' not in f])
app = FaceAnalysis(name='buffalo_l', providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
app.prepare(ctx_id=0, det_size=(640, 640))
embs, kept = [], []
for f in files:
    im = Image.open(f).convert('RGB')
    w, h = im.size
    s = min(1.0, 1280 / max(w, h))
    if s < 1.0:
        im = im.resize((int(w * s), int(h * s)))
    faces = app.get(np.array(im))
    if not faces:
        continue
    face = max(faces, key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]))
    embs.append(face.normed_embedding)
    kept.append(f)
if len(kept) < 2:
    print(json.dumps({'error': 'detected faces < 2'})); sys.exit(0)
from sklearn.cluster import DBSCAN
labels = DBSCAN(eps=eps, min_samples=2, metric='cosine').fit_predict(np.array(embs))
groups, noise = {}, []
for f, lb in zip(kept, labels):
    (noise if lb == -1 else groups.setdefault(int(lb), [])).append(f)

def montage(paths, out, cols=4, cell=300):
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell, rows * (cell + 22)), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(paths):
        im = Image.open(p).convert('RGB')
        im.thumbnail((cell, cell))
        x, y = (i % cols) * cell, (i // cols) * (cell + 22)
        sheet.paste(im, (x + (cell - im.width) // 2, y))
        d.text((x + 4, y + cell + 4), os.path.basename(p)[:38], fill=(220, 220, 220))
    sheet.save(out, quality=90)

os.makedirs(out_dir, exist_ok=True)
ordered = sorted(groups.items(), key=lambda kv: -len(kv[1]))
result = []
for i, (_, fs) in enumerate(ordered):
    if len(fs) < 2:
        noise += fs
        continue
    name = f'cluster_{i:02d}'
    montage(fs, os.path.join(out_dir, f'{name}.jpg'))
    result.append({'id': name, 'count': len(fs), 'files': fs})
meta = {'clusters': result, 'noise': noise}
json.dump(meta, open(os.path.join(out_dir, 'clusters.json'), 'w'), indent=1)
print(json.dumps({'total': len(files), 'faces': len(kept), 'clusters': [{'id': c['id'], 'count': c['count']} for c in result], 'noise': len(noise)}))
`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { datasetName, eps, pick, destName } = body;
    if (!datasetName || typeof datasetName !== 'string') {
      return NextResponse.json({ error: 'datasetName is required' }, { status: 400 });
    }
    const datasetsRoot = await getDatasetsRoot();
    const datasetPath = path.resolve(path.join(datasetsRoot, datasetName));
    if (!datasetPath.startsWith(path.resolve(datasetsRoot) + path.sep) || !fs.existsSync(datasetPath)) {
      return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
    }
    const clustersDir = path.join(datasetPath, '.clusters');

    if (pick) {
      const meta = JSON.parse(fs.readFileSync(path.join(clustersDir, 'clusters.json'), 'utf-8'));
      const cluster = meta.clusters.find((c: any) => c.id === pick);
      if (!cluster) return NextResponse.json({ error: `cluster ${pick} not found` }, { status: 404 });
      if (!destName || !/^[\w-]+$/.test(destName)) {
        return NextResponse.json({ error: 'destName 需为字母数字下划线横线' }, { status: 400 });
      }
      const dest = path.join(datasetsRoot, destName);
      if (fs.existsSync(dest)) {
        return NextResponse.json({ error: `数据集 ${destName} 已存在` }, { status: 409 });
      }
      fs.mkdirSync(dest, { recursive: true });
      for (const f of cluster.files) {
        fs.copyFileSync(f, path.join(dest, path.basename(f)));
      }
      return NextResponse.json({ success: true, dest: destName, copied: cluster.files.length });
    }

    const e = Number(eps ?? 0.45);
    if (!Number.isFinite(e) || e <= 0.2 || e >= 0.7) {
      return NextResponse.json({ error: 'eps 需在 0.2-0.7' }, { status: 400 });
    }
    fs.rmSync(clustersDir, { recursive: true, force: true });

    const stdout: string = await new Promise((resolve, reject) => {
      const child = spawn(COMFY_PY, ['-c', PY, datasetPath, clustersDir, String(e)]);
      let out = '';
      let err = '';
      child.stdout.on('data', d => (out += d.toString()));
      child.stderr.on('data', d => (err += d.toString()));
      child.on('error', reject);
      child.on('close', code => (code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`))));
    });
    const lastLine = stdout.trim().split('\n').pop() || '{}';
    const result = JSON.parse(lastLine);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, ...result, clustersDir });
  } catch (error: any) {
    console.error('Error face clustering:', error);
    return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 });
  }
}

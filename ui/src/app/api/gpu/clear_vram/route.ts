import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// nvidia-smi 显存占用(MB), 失败返回 -1
async function vramUsed(): Promise<number> {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 5000 },
    );
    return parseInt(stdout.trim().split('\n')[0], 10);
  } catch {
    return -1;
  }
}

// 一键清显存: 调 ComfyUI /free 卸载全部模型并回收, 返回前后占用
export async function POST() {
  try {
    const before = await vramUsed();

    const comfy = process.env.COMFYUI_URL || 'http://127.0.0.1:16080';
    try {
      const res = await fetch(`${comfy}/free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        return NextResponse.json({ error: `ComfyUI /free HTTP ${res.status}` }, { status: 502 });
      }
    } catch (e: any) {
      return NextResponse.json({ error: `ComfyUI 不可达: ${e?.message ?? e}` }, { status: 502 });
    }

    await new Promise(r => setTimeout(r, 3000));
    const after = await vramUsed();
    return NextResponse.json({ success: true, before, after });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 });
  }
}

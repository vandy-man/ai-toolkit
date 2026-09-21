import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getTrainingFolder, getComfyLorasDir } from '@/server/settings';

// 复制 LoRA checkpoint 到 ComfyUI 的 loras 目录 (可用 COMFYUI_LORAS_DIR 覆盖)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { filePath } = body;

    if (!filePath || typeof filePath !== 'string') {
      return new NextResponse('filePath is required', { status: 400 });
    }

    const decodedFilePath = decodeURIComponent(filePath);

    // 只允许复制训练输出目录下的文件 (与 delete 接口同款校验)
    const trainingRoot = await getTrainingFolder();
    const resolvedFilePath = path.resolve(decodedFilePath);
    const isAllowed =
      resolvedFilePath === trainingRoot ||
      resolvedFilePath.startsWith(trainingRoot + path.sep);
    if (!isAllowed) {
      console.warn(`Access denied: ${resolvedFilePath} not in ${trainingRoot}`);
      return new NextResponse('Access denied', { status: 403 });
    }

    if (!resolvedFilePath.endsWith('.safetensors')) {
      return new NextResponse('Only .safetensors files are supported', { status: 400 });
    }

    let stat;
    try {
      stat = await fs.promises.stat(resolvedFilePath);
    } catch {
      return new NextResponse('File not found', { status: 404 });
    }
    if (!stat.isFile()) {
      return new NextResponse('Not a file', { status: 400 });
    }

    const lorasDir = await getComfyLorasDir();
    await fs.promises.mkdir(lorasDir, { recursive: true });

    const destPath = path.join(lorasDir, path.basename(resolvedFilePath));
    let overwritten = false;
    try {
      await fs.promises.access(destPath);
      overwritten = true;
    } catch {
      // 目标不存在
    }

    await fs.promises.copyFile(resolvedFilePath, destPath);

    return NextResponse.json({ success: true, destPath, overwritten });
  } catch (error) {
    console.error('Error copying to ComfyUI:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

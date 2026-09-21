import { NextResponse } from 'next/server';
import prisma from '@/server/prisma';
import { defaultTrainFolder, defaultDatasetsFolder, defaultModelsFolder } from '@/paths';
import { flushCache, getComfyLorasDir } from '@/server/settings';

export async function GET() {
  try {
    const settings = await prisma.settings.findMany();
    const settingsObject = settings.reduce((acc: any, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});
    // if TRAINING_FOLDER is not set, use default
    if (!settingsObject.TRAINING_FOLDER || settingsObject.TRAINING_FOLDER === '') {
      settingsObject.TRAINING_FOLDER = defaultTrainFolder;
    }
    // if DATASETS_FOLDER is not set, use default
    if (!settingsObject.DATASETS_FOLDER || settingsObject.DATASETS_FOLDER === '') {
      settingsObject.DATASETS_FOLDER = defaultDatasetsFolder;
    }
    // MODELS_PATH from the env file always takes precedence over the setting
    if (process.env.MODELS_PATH && process.env.MODELS_PATH.trim() !== '') {
      settingsObject.MODELS_PATH = process.env.MODELS_PATH;
    } else if (!settingsObject.MODELS_PATH || settingsObject.MODELS_PATH === '') {
      // if MODELS_PATH is not set, use default
      settingsObject.MODELS_PATH = defaultModelsFolder;
    }
    settingsObject.COMFYUI_LORAS_DIR = await getComfyLorasDir();
    return NextResponse.json(settingsObject);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { HF_TOKEN, TRAINING_FOLDER, DATASETS_FOLDER, MODELS_PATH, COMFYUI_LORAS_DIR } = body;

    // 缺失的键跳过, 避免把 undefined 写进 NOT NULL 列
    const entries: Record<string, string> = {
      HF_TOKEN,
      TRAINING_FOLDER,
      DATASETS_FOLDER,
      MODELS_PATH,
      COMFYUI_LORAS_DIR,
    };
    await Promise.all(
      Object.entries(entries)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) =>
          prisma.settings.upsert({
            where: { key },
            update: { value },
            create: { key, value },
          }),
        ),
    );

    flushCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}

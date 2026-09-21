'use client';

import { useState } from 'react';
import { LuEraser, LuLoaderCircle } from 'react-icons/lu';
import { apiClient } from '@/utils/api';
import { openConfirm } from '@/components/ConfirmModal';

export default function ClearVramButton() {
  const [clearing, setClearing] = useState(false);

  const clearVram = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      const res = await apiClient.post('/api/gpu/clear_vram');
      const { before, after } = res.data ?? {};
      const fmt = (mb: number) => (mb >= 0 ? `${(mb / 1024).toFixed(1)} GB` : '未知');
      openConfirm({
        title: 'VRAM Cleared',
        message:
          before !== undefined && after !== undefined
            ? `显存占用 ${fmt(before)} → ${fmt(after)}（ComfyUI 已卸载全部模型；训练进程占用的显存不受影响）`
            : '已向 ComfyUI 发送清理请求',
        type: 'info',
        confirmText: 'OK',
      });
    } catch (err: any) {
      openConfirm({
        title: 'Clear VRAM Failed',
        message: err?.response?.data?.error ?? err?.message ?? 'Unknown error',
        type: 'danger',
        confirmText: 'OK',
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="px-2 pb-2">
      <button
        onClick={clearVram}
        disabled={clearing}
        className="w-full flex items-center px-4 py-2 text-gray-300 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
      >
        {clearing ? (
          <LuLoaderCircle className="w-5 h-5 mr-3 animate-spin" />
        ) : (
          <LuEraser className="w-5 h-5 mr-3" />
        )}
        清理显存
      </button>
    </div>
  );
}

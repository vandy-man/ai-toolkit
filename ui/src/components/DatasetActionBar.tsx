'use client';

import { useState } from 'react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { Cog, Download, Captions, Eraser } from 'lucide-react';
import { LuLoader, LuScanFace } from 'react-icons/lu';
import { apiClient } from '@/utils/api';
import { openFaceClusterModal } from '@/components/FaceClusterModal';
import { encodeFilePathForUrl } from '@/utils/basic';
import { openConfirm } from '@/components/ConfirmModal';

type DatasetZipTarget = 'dataset' | 'dataset_captions';

interface DatasetActionBarProps {
  datasetName: string;
  className?: string;
}

export default function DatasetActionBar({ datasetName, className }: DatasetActionBarProps) {
  const [zipping, setZipping] = useState<DatasetZipTarget | null>(null);
  const [removingWm, setRemovingWm] = useState(false);

  const removeWatermark = () => {
    if (removingWm) return;
    openConfirm({
      title: 'Remove XHS Watermark',
      message: `Crop the bottom of ALL images in "${datasetName}" to remove the Xiaohongshu watermark? 原地裁剪、不备份、走队列任务。`,
      inputTitle: '裁剪底部百分比（留空=7，范围 1-30）',
      type: 'warning',
      confirmText: 'Crop',
      onConfirm: async (value?: string) => {
        let pct = parseFloat((value ?? '').trim());
        if (!Number.isFinite(pct)) pct = 7;
        pct = Math.min(30, Math.max(1, pct));
        setRemovingWm(true);
        try {
          const jobConfig = {
            job: 'extension',
            config: {
              name: `Crop ${pct}% bottom: ${datasetName}`,
              process: [{ type: 'image_cropper', dataset_path: `datasets/${datasetName}`, bottom_pct: pct }],
            },
          };
          const res = await apiClient.post('/api/jobs', {
            name: `水印裁剪 ${datasetName}`,
            gpu_ids: '0',
            job_config: jobConfig,
          });
          await apiClient.get(`/api/jobs/${res.data?.id}/start`);
          await apiClient.get('/api/queue/0/start');
          openConfirm({
            title: '裁剪任务已入队',
            message: `已提交 "${datasetName}" 底部 ${pct}% 裁剪（原地裁剪、无备份），到 Queue 页看进度，完成后缩略图与缓存自动刷新。`,
            type: 'info',
            confirmText: 'OK',
          });
        } catch (err: any) {
          console.error('Error queueing watermark crop:', err);
          openConfirm({
            title: '提交失败',
            message: err?.response?.data?.error ?? err?.message ?? 'Unknown error',
            type: 'danger',
            confirmText: 'OK',
          });
        } finally {
          setRemovingWm(false);
        }
      },
    });
  };

  const downloadZip = async (zipTarget: DatasetZipTarget) => {
    if (zipping) return;
    setZipping(zipTarget);
    try {
      const res = await apiClient.post('/api/zip', { zipTarget, datasetName });
      const zipPath = res.data.zipPath;
      if (!zipPath) throw new Error('No zipPath in response');

      // Cache-buster: /api/files serves with a long max-age, and the zip is rebuilt
      // at the same path every time, so a bare URL could hand back a stale download.
      const downloadPath = `/api/files/${encodeFilePathForUrl(zipPath)}?v=${Date.now()}`;
      const a = document.createElement('a');
      a.href = downloadPath;
      a.download = res.data.fileName || `${datasetName}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error('Error downloading zip:', err);
    } finally {
      setZipping(null);
    }
  };

  const iconSizeClass = 'w-5 h-5 sm:w-6 sm:h-6';
  return (
    <div className={`flex items-center flex-shrink-0 ${className ?? ''}`}>
      <Menu>
        <MenuButton className={'ml-1 sm:ml-2'}>
          {zipping ? <LuLoader className={`${iconSizeClass} animate-spin`} /> : <Cog className={iconSizeClass} />}
        </MenuButton>
        <MenuItems
          anchor={{ to: 'bottom end', gap: 16 }}
          className="bg-gray-900 border border-gray-700 rounded shadow-lg w-64 px-2 py-2 z-50"
        >
          <MenuItem>
            <div
              className="cursor-pointer px-4 py-1 hover:bg-gray-800 rounded flex items-center gap-2"
              onClick={() => openFaceClusterModal(datasetName, () => {})}
            >
              <LuScanFace className="w-4 h-4" />
              人脸聚类
            </div>
          </MenuItem>
          <MenuItem>
            <div
              className="cursor-pointer px-4 py-1 hover:bg-gray-800 rounded flex items-center gap-2"
              onClick={() => downloadZip('dataset')}
            >
              <Download className="w-4 h-4" />
              Download Full Dataset
            </div>
          </MenuItem>
          <MenuItem>
            <div
              className="cursor-pointer px-4 py-1 hover:bg-gray-800 rounded flex items-center gap-2"
              onClick={() => downloadZip('dataset_captions')}
            >
              <Captions className="w-4 h-4" />
              Download Captions
            </div>
          </MenuItem>
          <MenuItem>
            <div
              className="cursor-pointer px-4 py-1 hover:bg-gray-800 rounded flex items-center gap-2"
              onClick={removeWatermark}
            >
              {removingWm ? <LuLoader className="w-4 h-4 animate-spin" /> : <Eraser className="w-4 h-4" />}
              Remove XHS Watermark
            </div>
          </MenuItem>
        </MenuItems>
      </Menu>
    </div>
  );
}

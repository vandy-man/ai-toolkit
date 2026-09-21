'use client';

import { useEffect, useState } from 'react';
import { createGlobalState } from 'react-global-hooks';
import { X } from 'lucide-react';
import { LuLoaderCircle, LuScanFace } from 'react-icons/lu';
import { apiClient } from '@/utils/api';
import { encodeFilePathForUrl } from '@/utils/basic';
import { openConfirm } from '@/components/ConfirmModal';

interface ClusterInfo {
  id: string;
  count: number;
}

interface FaceClusterModalState {
  datasetName: string;
  onComplete?: () => void;
}

export const faceClusterModalState = createGlobalState<FaceClusterModalState | null>(null);

export const openFaceClusterModal = (datasetName: string, onComplete?: () => void) => {
  faceClusterModalState.set({ datasetName, onComplete });
};

interface Props {
  datasetsRoot: string;
}

export default function FaceClusterModal({ datasetsRoot }: Props) {
  const [state, setState] = faceClusterModalState.use();
  const isOpen = state !== null;
  const [running, setRunning] = useState(false);
  const [clusters, setClusters] = useState<ClusterInfo[] | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setClusters(null);
      setSummary('');
    }
  }, [isOpen]);

  if (!isOpen || !state) return null;
  const { datasetName, onComplete } = state;

  const runCluster = async (eps: number) => {
    setRunning(true);
    setClusters(null);
    try {
      const res = await apiClient.post('/api/datasets/face_cluster', { datasetName, eps });
      setClusters(res.data?.clusters ?? []);
      setSummary(
        `共 ${res.data?.total ?? '?'} 图 / 检出人脸 ${res.data?.faces ?? '?'} / 漂移 ${res.data?.noise ?? 0} 张`,
      );
    } catch (err: any) {
      openConfirm({
        title: '聚类失败',
        message: err?.response?.data?.error ?? err?.message ?? 'Unknown error',
        type: 'danger',
        confirmText: 'OK',
      });
    } finally {
      setRunning(false);
    }
  };

  const pickCluster = async (clusterId: string, count: number) => {
    const dest = window.prompt(`用 ${clusterId}(${count}张) 建新数据集，输入名称：`, `${datasetName}_${clusterId.replace('cluster_', 'fc')}`);
    if (!dest) return;
    setCreating(clusterId);
    try {
      const res = await apiClient.post('/api/datasets/face_cluster', {
        datasetName,
        pick: clusterId,
        destName: dest,
      });
      openConfirm({
        title: '数据集已创建',
        message: `已拷 ${res.data?.copied ?? '?'} 张到 "${res.data?.dest}"，可去打标后二训。`,
        type: 'info',
        confirmText: 'OK',
        onConfirm: () => {
          setState(null);
          onComplete?.();
        },
      });
    } catch (err: any) {
      openConfirm({
        title: '创建失败',
        message: err?.response?.data?.error ?? err?.message ?? 'Unknown error',
        type: 'danger',
        confirmText: 'OK',
      });
    } finally {
      setCreating(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h3 className="font-bold flex items-center gap-2">
            <LuScanFace className="w-5 h-5" /> 人脸聚类 — {datasetName}
          </h3>
          <button onClick={() => setState(null)} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-3 border-b border-gray-700 flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-300">聚类阈值 eps：</span>
          {[
            [0.4, '严(0.40)'],
            [0.45, '常规(0.45)'],
            [0.5, '宽(0.50)'],
          ].map(([v, label]) => (
            <button
              key={String(v)}
              onClick={() => runCluster(v as number)}
              disabled={running}
              className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded px-3 py-1 text-sm"
            >
              {label as string}
            </button>
          ))}
          {running && <LuLoaderCircle className="w-4 h-4 animate-spin" />}
          {summary && <span className="text-xs text-gray-400 ml-auto">{summary}</span>}
        </div>
        <div className="overflow-y-auto p-4 space-y-4">
          {clusters?.length === 0 && <div className="text-gray-400 text-sm">没有形成任何簇（全部漂移），建议换更宽的阈值或检查数据。</div>}
          {clusters?.map(c => (
            <div key={c.id} className="border border-gray-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-sm">
                  {c.id} · {c.count} 张
                </span>
                <button
                  onClick={() => pickCluster(c.id, c.count)}
                  disabled={creating === c.id}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded px-3 py-1 text-sm"
                >
                  {creating === c.id ? '创建中...' : '用此簇建数据集 →'}
                </button>
              </div>
              <img
                src={`/api/img/${encodeFilePathForUrl(
                  `${datasetsRoot}/${datasetName}/.clusters/${c.id}.jpg`,
                )}`}
                alt={c.id}
                className="w-full rounded border border-gray-700"
              />
            </div>
          ))}
          {!clusters && !running && (
            <div className="text-gray-400 text-sm py-8 text-center">
              点上方阈值开始聚类（约 0.3 秒/张，几百张图几十秒）
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

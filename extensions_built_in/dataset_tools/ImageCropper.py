import os
import shutil
import sqlite3
from collections import OrderedDict

from PIL import Image

from jobs.process import BaseExtensionProcess


class ImageCropper(BaseExtensionProcess):
    """原地裁掉数据集图片底部(小红书贴底水印)。不留备份; 完成后清 .thumbs/.cache。"""

    def run(self):
        super().run()

        dataset = self.get_conf("dataset_path", required=True)
        if not os.path.isabs(dataset):
            dataset = os.path.join(os.getcwd(), dataset)
        bottom_pct = float(self.get_conf("bottom_pct", 7.0))
        if not 0 < bottom_pct < 50:
            raise ValueError(f"bottom_pct must be in (0, 50), got {bottom_pct}")
        if not os.path.isdir(dataset):
            raise FileNotFoundError(f"dataset not found: {dataset}")

        exts = (".webp", ".jpg", ".jpeg", ".png")
        files = []
        for root, dirs, fs in os.walk(dataset):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            files += [os.path.join(root, f) for f in fs if f.lower().endswith(exts)]
        files.sort()
        total = len(files)

        cropped = 0
        for f in files:
            im = Image.open(f).convert("RGB")
            w, h = im.size
            im2 = im.crop((0, 0, w, max(1, int(h * (1 - bottom_pct / 100.0)))))
            ext = os.path.splitext(f)[1].lower()
            if ext == ".webp":
                im2.save(f, "WEBP", quality=95)
            elif ext in (".jpg", ".jpeg"):
                im2.save(f, "JPEG", quality=95)
            else:
                im2.save(f, "PNG")
            cropped += 1
            if cropped % 10 == 0 or cropped == total:
                print(f"Cropping {cropped}/{total}", flush=True)

        # 缩略图与 latent 缓存失效
        purged = 0
        for root, dirs, fs in os.walk(dataset, topdown=False):
            for d in dirs:
                if d in (".thumbs", ".cache"):
                    shutil.rmtree(os.path.join(root, d), ignore_errors=True)
                    purged += 1

        print(f"Crop complete: {cropped} files -{bottom_pct}% bottom, {purged} cache dirs purged")

        # 终态由任务进程自己写入 Job 表 (manager 只兜底意外死亡)
        job_id = os.environ.get("AITK_JOB_ID", "").strip()
        if job_id:
            try:
                conn = sqlite3.connect(self.config.get("sqlite_db_path", "./aitk_db.db"))
                conn.execute(
                    "UPDATE Job SET status = ?, info = ?, pid = NULL WHERE id = ?",
                    ("completed", f"Cropped {cropped} files, -{bottom_pct}% bottom", job_id),
                )
                conn.commit()
                conn.close()
            except Exception as e:
                print(f"[ImageCropper] 终态写库失败: {e}")

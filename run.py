import os
import sys
from dotenv import load_dotenv
# Load the .env file if it exists
load_dotenv()
os.environ["HF_XET_HIGH_PERFORMANCE"] = os.getenv("HF_XET_HIGH_PERFORMANCE", "1")
os.environ["HF_HUB_DISABLE_XET"] = os.getenv("HF_HUB_DISABLE_XET", "0")
os.environ["NO_ALBUMENTATIONS_UPDATE"] = "1"
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "-8"
seed = None
if "SEED" in os.environ:
    try:
        seed = int(os.environ["SEED"])
    except ValueError:
        print(f"Invalid SEED value: {os.environ['SEED']}. SEED must be an integer.")

sys.path.insert(0, os.getcwd())

# The UI launches jobs with no console; keep anything we shell out to (torch
# compiles, HF git downloads) from flashing a console window. Must come before
# any import that might spawn a subprocess.
from toolkit.win_console import suppress_child_consoles
suppress_child_consoles()


# --- Hub offline guard (2026-09-06) -----------------------------------------
# worker 上下文里 huggingface_hub 的在线元数据校验(httpx)会挂死: 现象是任务停在
# 量化/加载阶段, GPU 0%, 全线程 futex 等锁。若本任务引用的 hub 模型均已完整缓存,
# 直接切离线模式(纯本地加载), 从根上绕开网络校验; 未缓存则保持在线正常下载。
def _hub_offline_if_cached(job_config_path: str) -> None:
    try:
        import json as _json

        def _collect(o, out):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k in ("model_name_or_path", "base_model_name_or_path",
                             "assistant_lora_path", "vae_path", "text_encoder_path") and isinstance(v, str):
                        out.append(v)
                    _collect(v, out)
            elif isinstance(o, list):
                for i in o:
                    _collect(i, out)

        names = []
        _collect(_json.load(open(job_config_path)), names)
        if not names:
            return
        from huggingface_hub import try_to_load_from_cache
        for name in names:
            if os.path.isdir(name) or "/" not in name:  # 本地路径或非 hub id
                continue
            cfg_path = try_to_load_from_cache(name, "config.json")
            if not cfg_path or not os.path.isfile(cfg_path):
                return  # 有模型没缓存(或拿不准), 保持在线
            snap = os.path.dirname(cfg_path)
            if not any(f.endswith(".safetensors") for f in os.listdir(snap)):
                return  # 缓存不完整(只有配置没权重)
        os.environ["HF_HUB_OFFLINE"] = "1"
        import huggingface_hub.constants as _hbc
        _hbc.HF_HUB_OFFLINE = True
        try:
            import transformers.utils.hub as _tuh
            _tuh.HF_HUB_OFFLINE = True
        except Exception:
            pass
        print("[hub-guard] referenced models fully cached -> offline mode", flush=True)
    except Exception as e:
        print(f"[hub-guard] check skipped: {e}", flush=True)


if len(sys.argv) > 1 and os.path.isfile(sys.argv[1]):
    _hub_offline_if_cached(sys.argv[1])
# --- end hub offline guard ---------------------------------------------------

# must come before ANY torch or fastai imports
# import toolkit.cuda_malloc

# turn off diffusers telemetry until I can figure out how to make it opt-in
os.environ['DISABLE_TELEMETRY'] = 'YES'

# set torch to trace mode
import torch
    
# check if we have DEBUG_TOOLKIT in env
if os.environ.get("DEBUG_TOOLKIT", "0") == "1":
    torch.autograd.set_detect_anomaly(True)

# on unified memory devices (DGX Spark), offloading modules to cpu is useless and very slow
from toolkit.util.unified_memory import apply_unified_memory_patches
apply_unified_memory_patches()

if seed is not None:
    import random
    import numpy as np
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)

import argparse
from toolkit.job import get_job
from toolkit.accelerator import get_accelerator
from toolkit.print import print_acc, setup_log_to_file

accelerator = get_accelerator()


def print_end_message(jobs_completed, jobs_failed):
    if not accelerator.is_main_process:
        return
    failure_string = f"{jobs_failed} failure{'' if jobs_failed == 1 else 's'}" if jobs_failed > 0 else ""
    completed_string = f"{jobs_completed} completed job{'' if jobs_completed == 1 else 's'}"

    print_acc("")
    print_acc("========================================")
    print_acc("Result:")
    if len(completed_string) > 0:
        print_acc(f" - {completed_string}")
    if len(failure_string) > 0:
        print_acc(f" - {failure_string}")
    print_acc("========================================")


def main():
    parser = argparse.ArgumentParser()

    # require at lease one config file
    parser.add_argument(
        'config_file_list',
        nargs='+',
        type=str,
        help='Name of config file (eg: person_v1 for config/person_v1.json/yaml), or full path if it is not in config folder, you can pass multiple config files and run them all sequentially'
    )

    # flag to continue if failed job
    parser.add_argument(
        '-r', '--recover',
        action='store_true',
        help='Continue running additional jobs even if a job fails'
    )

    # flag to continue if failed job
    parser.add_argument(
        '-n', '--name',
        type=str,
        default=None,
        help='Name to replace [name] tag in config file, useful for shared config file'
    )
    
    parser.add_argument(
        '-l', '--log',
        type=str,
        default=None,
        help='Log file to write output to'
    )
    args = parser.parse_args()
    
    if args.log is not None:
        setup_log_to_file(args.log)

    config_file_list = args.config_file_list
    if len(config_file_list) == 0:
        raise Exception("You must provide at least one config file")

    jobs_completed = 0
    jobs_failed = 0

    if accelerator.is_main_process:
        print_acc(f"Running {len(config_file_list)} job{'' if len(config_file_list) == 1 else 's'}")

    for config_file in config_file_list:
        try:
            job = get_job(config_file, args.name)
            job.run()
            job.cleanup()
            jobs_completed += 1
        except Exception as e:
            print_acc(f"Error running job: {e}")
            jobs_failed += 1
            try:
                job.process[0].on_error(e)
            except Exception as e2:
                print_acc(f"Error running on_error: {e2}")
            if not args.recover:
                print_end_message(jobs_completed, jobs_failed)
                raise e
        except KeyboardInterrupt as e:
            try:
                job.process[0].on_error(e)
            except Exception as e2:
                print_acc(f"Error running on_error: {e2}")
            if not args.recover:
                print_acc("")
                print_acc("========================================")
                print_acc("Job stopped")
                print_acc("========================================")
                sys.exit(0)


if __name__ == '__main__':
    main()

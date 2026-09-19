"""
Download Script for NASA-IBM Prithvi 2.0 Model Weights
Downloads foundation model checkpoints and configs from Hugging Face Hub.
"""

import sys
import argparse
from pathlib import Path
from huggingface_hub import hf_hub_download, snapshot_download

from config import MODEL_DIR, HF_REPO_ID, MODEL_CHECKPOINT_FILE

def download_prithvi_weights(repo_id: str = HF_REPO_ID, target_dir: Path = MODEL_DIR):
    """
    Downloads Prithvi-EO-2.0 model weights from HuggingFace.
    """
    print(f"🛰️  Target Repository: {repo_id}")
    print(f"📁 Destination Folder: {target_dir.resolve()}")
    target_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        print("\n⏳ Fetching model snapshot from Hugging Face Hub...")
        snapshot_download(
            repo_id=repo_id,
            local_dir=target_dir,
            local_dir_use_symlinks=False,
            resume_download=True,
            allow_patterns=["*.pt", "*.json", "*.md", "*.yaml"]
        )
        print(f"\n✅ Prithvi 2.0 weights downloaded successfully into: {target_dir}")
    except Exception as e:
        print(f"\n⚠️  Note: Could not download full snapshot from {repo_id}: {e}")
        print("Creating placeholder configuration for local inference fallback...")
        
        placeholder_config = target_dir / "config.json"
        if not placeholder_config.exists():
            with open(placeholder_config, "w") as f:
                f.write('{\n  "model_type": "prithvi_eo_2_0",\n  "img_size": 224,\n  "embed_dim": 768\n}\n')
        print(f"✅ Local configuration initialized at {placeholder_config}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download Prithvi 2.0 Foundation Model Weights")
    parser.add_argument("--repo", type=str, default=HF_REPO_ID, help="HuggingFace Repository ID")
    args = parser.parse_args()
    
    download_prithvi_weights(repo_id=args.repo)

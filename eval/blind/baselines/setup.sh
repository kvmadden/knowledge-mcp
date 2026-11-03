#!/bin/sh
# Sets up the two off-the-shelf baselines of the blind-set runner, once, with
# network. Scoring runs later with no network (see score.py).
#
#   sh eval/blind/baselines/setup.sh
#
# Python packages go in a virtual environment under ~/dev/toolchains. Model
# weights go under BLIND_MODELS_ROOT (default /Volumes/HubData/models), the
# Hub's place for weights. Every version is pinned:
#   - Python packages: requirements.txt next to this script (pip freeze)
#   - the classifier: protectai/deberta-v3-base-prompt-injection-v2 at a fixed
#     revision, checked by the SHA-256 of its weights
#   - the spaCy model: en_core_web_lg 3.7.1 from the spaCy release, checked by
#     a hash over its installed files
# It was built with the macOS system Python 3.9.6. spaCy releases after 3.7
# need Python 3.10, which is why spaCy is 3.7.5.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
VENV=${BLIND_VENV:-"$HOME/dev/toolchains/blind-baselines"}
MODELS=${BLIND_MODELS_ROOT:-/Volumes/HubData/models}
PYTHON=${BLIND_SYSTEM_PYTHON:-python3}
REVISION=90c9989b1a342275dd0d1a95aad283c04e075671
WEIGHTS_SHA256=6521cb8d0ac08148c81464899c424e6148fcc62befa371089fa4061d8b6e0424
SPACY_URL=https://github.com/explosion/spacy-models/releases/download/en_core_web_lg-3.7.1/en_core_web_lg-3.7.1-py3-none-any.whl
SPACY_TREE_SHA256=82452326ca1c9ae7ee1cb0ca5706380daa92a8d3e73093b5df0bf38298e83f18
SPACY_DIR="$MODELS/spacy/en_core_web_lg-3.7.1"

[ -x "$VENV/bin/python" ] || "$PYTHON" -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet --only-binary=:all: -r "$HERE/requirements.txt"

mkdir -p "$MODELS/huggingface" "$MODELS/spacy"
HF_HOME="$MODELS/huggingface" "$VENV/bin/python" - <<EOF
from huggingface_hub import snapshot_download
import os
path = snapshot_download("protectai/deberta-v3-base-prompt-injection-v2", revision="$REVISION",
    allow_patterns=["config.json", "model.safetensors", "tokenizer.json", "tokenizer_config.json",
                    "special_tokens_map.json", "added_tokens.json", "spm.model", "LICENSE", "README.md"])
weights = os.path.basename(os.path.realpath(os.path.join(path, "model.safetensors")))
assert weights == "$WEIGHTS_SHA256", f"classifier weights are {weights}, expected $WEIGHTS_SHA256"
print("classifier ready at", path)
EOF

[ -d "$SPACY_DIR/en_core_web_lg" ] || "$VENV/bin/python" -m pip install --quiet --no-deps --target "$SPACY_DIR" "$SPACY_URL"
TREE=$(cd "$SPACY_DIR/en_core_web_lg/en_core_web_lg-3.7.1" && find . -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1)
[ "$TREE" = "$SPACY_TREE_SHA256" ] || { echo "spaCy model files hash to $TREE, expected $SPACY_TREE_SHA256" >&2; exit 1; }
echo "spaCy model ready at $SPACY_DIR"
echo "Baselines ready. Score with: node eval/blind/run.mjs --python $VENV/bin/python"

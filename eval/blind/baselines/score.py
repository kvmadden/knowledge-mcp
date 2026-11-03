"""Offline scorer for the two off-the-shelf baselines of the blind-set runner.

  injection  protectai/deberta-v3-base-prompt-injection-v2, a prompt-injection
             classifier. A text is flagged when the INJECTION probability of
             any 512-token window is at least the threshold.
  presidio   Microsoft Presidio Analyzer with its default English recognizers
             and its default spaCy model, en_core_web_lg. A text is flagged
             when any detected entity scores at least the threshold.

Usage:
  score.py --detector injection|presidio --in requests.json --out scores.json

requests.json holds {"texts": [{"key": "<sha256>", "text": "..."}]}. The output
holds the versions used and, per key, whether it was flagged, the top score,
the entity types found (Presidio) and the inference time. Matched text is
never written out.

No network. The process refuses every outbound connection, Hugging Face and
Transformers run in offline mode, and the models are read from local
directories (see setup.sh). A blocked attempt is counted in the output.
"""
import argparse
import json
import os
import socket
import sys
import time

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_DATASETS_OFFLINE"] = "1"
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

NETWORK_ATTEMPTS = []
_real_connect = socket.socket.connect
_real_connect_ex = socket.socket.connect_ex


def _local(sock):
    return getattr(socket, "AF_UNIX", None) is not None and sock.family == socket.AF_UNIX


def _no_connect(sock, address):
    if _local(sock):
        return _real_connect(sock, address)
    NETWORK_ATTEMPTS.append(str(address)[:80])
    raise ConnectionRefusedError("network is disabled while scoring")


def _no_connect_ex(sock, address):
    if _local(sock):
        return _real_connect_ex(sock, address)
    NETWORK_ATTEMPTS.append(str(address)[:80])
    return 111


socket.socket.connect = _no_connect
socket.socket.connect_ex = _no_connect_ex

THRESHOLD = 0.5
INJECTION_MODEL = "protectai/deberta-v3-base-prompt-injection-v2"
INJECTION_REVISION = "90c9989b1a342275dd0d1a95aad283c04e075671"
MODELS_ROOT = os.environ.get("BLIND_MODELS_ROOT", "/Volumes/HubData/models")
SPACY_MODEL_DIR = os.path.join(MODELS_ROOT, "spacy", "en_core_web_lg-3.7.1", "en_core_web_lg", "en_core_web_lg-3.7.1")
os.environ.setdefault("HF_HOME", os.path.join(MODELS_ROOT, "huggingface"))


def injection_scorer():
    import torch
    import transformers
    import tokenizers
    import huggingface_hub
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    torch.set_grad_enabled(False)
    tokenizer = AutoTokenizer.from_pretrained(INJECTION_MODEL, revision=INJECTION_REVISION)
    model = AutoModelForSequenceClassification.from_pretrained(INJECTION_MODEL, revision=INJECTION_REVISION)
    model.eval()
    labels = {v.upper(): k for k, v in model.config.id2label.items()}
    injection = labels["INJECTION"]
    snapshot = huggingface_hub.snapshot_download(INJECTION_MODEL, revision=INJECTION_REVISION, local_files_only=True)
    weights = os.path.basename(os.path.realpath(os.path.join(snapshot, "model.safetensors")))
    versions = {
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "transformers": transformers.__version__,
        "tokenizers": tokenizers.__version__,
        "huggingface_hub": huggingface_hub.__version__,
        "model": INJECTION_MODEL,
        "revision": INJECTION_REVISION,
        "weightsSha256": weights,
        "labels": model.config.id2label,
        "window": "510 tokens plus special tokens, stride 255",
    }
    size = 510
    stride = 255

    def windows(ids):
        if not ids:
            return [[]]
        out = []
        start = 0
        while True:
            out.append(ids[start:start + size])
            if start + size >= len(ids):
                return out
            start += stride

    def score(text):
        ids = tokenizer(text, add_special_tokens=False, truncation=False)["input_ids"]
        trimmed = windows(ids)
        best = 0.0
        for start in range(0, len(trimmed), 8):
            batch = [tokenizer.build_inputs_with_special_tokens(w) for w in trimmed[start:start + 8]]
            padded = tokenizer.pad({"input_ids": batch}, return_tensors="pt")
            logits = model(**padded).logits
            probs = torch.softmax(logits, dim=-1)[:, injection]
            best = max(best, float(probs.max()))
        return {"flagged": best >= THRESHOLD, "score": round(best, 6)}

    return score, versions


def presidio_scorer():
    # The email recognizer checks domains with tldextract, which would fetch
    # the public suffix list. Use the list bundled with the package instead,
    # so no connection is tried and the result does not depend on the day.
    import tldextract
    from tldextract import tldextract as tld_module
    tld_module.TLD_EXTRACTOR = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None)
    import spacy
    from presidio_analyzer import AnalyzerEngine
    from presidio_analyzer.nlp_engine import NlpEngineProvider

    provider = NlpEngineProvider(nlp_configuration={"nlp_engine_name": "spacy", "models": [{"lang_code": "en", "model_name": SPACY_MODEL_DIR}]})
    analyzer = AnalyzerEngine(nlp_engine=provider.create_engine(), supported_languages=["en"])
    with open(os.path.join(SPACY_MODEL_DIR, "meta.json")) as f:
        meta = json.load(f)
    recognizers = sorted(r.name for r in analyzer.registry.get_recognizers(language="en", all_fields=True))
    versions = {
        "python": sys.version.split()[0],
        "presidio_analyzer": _dist_version("presidio-analyzer"),
        "spacy": spacy.__version__,
        "spacyModel": f"{meta['lang']}_{meta['name']}-{meta['version']}",
        "recognizers": recognizers,
        "tldextract": _dist_version("tldextract") + ", bundled suffix list",
        "entities": "all supported, default settings",
    }

    def score(text):
        results = analyzer.analyze(text=text, language="en")
        best = max((r.score for r in results), default=0.0)
        found = sorted({r.entity_type for r in results if r.score >= THRESHOLD})
        return {"flagged": best >= THRESHOLD, "score": round(float(best), 6), "entities": found}

    return score, versions


def _dist_version(name):
    from importlib.metadata import version
    return version(name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--detector", required=True, choices=["injection", "presidio"])
    parser.add_argument("--in", dest="inp", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    with open(args.inp, encoding="utf-8") as f:
        texts = json.load(f)["texts"]
    started = time.perf_counter()
    score, versions = injection_scorer() if args.detector == "injection" else presidio_scorer()
    load_ms = (time.perf_counter() - started) * 1000
    results = {}
    for item in texts:
        t0 = time.perf_counter()
        out = score(item["text"])
        out["ms"] = round((time.perf_counter() - t0) * 1000, 3)
        results[item["key"]] = out
    payload = {
        "detector": args.detector,
        "threshold": THRESHOLD,
        "versions": versions,
        "loadMs": round(load_ms, 1),
        "networkAttemptsBlocked": len(NETWORK_ATTEMPTS),
        "results": results,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1, sort_keys=True)
        f.write("\n")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Merge OpenHowNet sense relations into semantic-relations.json.

HowNet (MIT, via thunlp/OpenHowNet) provides sense-level lexical knowledge:
  - each sense has a definition whose first sememe is the head semantic category,
  - each sense lists synonym senses with similarity scores,
  - senses sharing an identical definition form synonym clusters.

This script derives conservative relations for HSK headwords:
  - hypernyms: the head sememe's Chinese label, when it is itself an HSK headword,
  - hyponyms: HSK headwords whose head sememe is this headword,
  - synonyms: sense-level synonyms (score >= 0.9 or identical definitions), restricted
    to HSK headwords so the app can always resolve them.

The 75MB resource pack is downloaded once and cached under scripts/.cache/openhownet/.
Run via: python3 scripts/sync-hownet.py   (npm run data:hownet)
"""

import datetime
import json
import pickle
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "public" / "content"
CACHE = ROOT / "scripts" / ".cache" / "openhownet"
ZIP_URL = "https://thunlp.oss-cn-qingdao.aliyuncs.com/OpenHowNet/resources.zip"
NEEDED_FILES = ["HowNet_dict_complete", "synonym"]
SYNONYM_SCORE = 0.9
MAX_SYNONYMS = 16
MAX_HYPERNYMS = 8
MAX_HYPONYMS = 12


def load_hsk_words():
    words = set()
    for level_file in CONTENT.glob("hsk/level-*.json"):
        for entry in json.loads(level_file.read_text(encoding="utf-8")):
            words.add(entry["word"])
    return words


def ensure_data():
    if all((CACHE / name).exists() for name in NEEDED_FILES):
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    zip_path = CACHE / "resources.zip"
    if not zip_path.exists():
        print("Downloading OpenHowNet resources (75MB, one time)…")
        urllib.request.urlretrieve(ZIP_URL, zip_path)
        print("Download complete.")
    with zipfile.ZipFile(zip_path) as archive:
        for name in NEEDED_FILES:
            target = CACHE / name
            if not target.exists():
                with archive.open(name) as source, open(target, "wb") as destination:
                    destination.write(source.read())


def head_sememe(def_text):
    """First {sememe|中文label} in a HowNet definition string, e.g. {水果|fruit:...} -> 水果."""
    match = re.search(r"\{([^|{}]+)\|([^:{}]+)", def_text or "")
    if not match:
        return None
    label = match.group(2).strip()
    return label or None


def main():
    ensure_data()
    print("Loading HowNet sense data…")
    with open(CACHE / "HowNet_dict_complete", "rb") as handle:
        senses = pickle.load(handle)
    with open(CACHE / "synonym", "rb") as handle:
        synonym_groups = pickle.load(handle)

    hsk = load_hsk_words()
    print(f"HSK headwords: {len(hsk)}")

    # sense number -> ch_word (only needed for senses with a Chinese word)
    no_to_word = {}
    word_senses = {}
    for no, sense in senses.items():
        word = sense.get("ch_word")
        if not word:
            continue
        no_to_word[no] = word
        word_senses.setdefault(word, []).append((no, sense))

    # senses in the same synonym group (identical definition) are synonymous
    group_members = {}
    for sememe_key, member_nos in synonym_groups.items():
        for no in member_nos:
            group_members.setdefault(no, set()).update(member_nos)

    # ---- per-headword relations -----------------------------------------------------
    # head-sememe label -> HSK words carrying that head sememe (hyponym index)
    hyponym_index = {}
    for word in word_senses:
        if word not in hsk:
            continue
        for _no, sense in word_senses[word]:
            label = head_sememe(sense.get("Def"))
            if label and label in hsk:
                hyponym_index.setdefault(label, []).append(word)

    relations = {}
    for word in hsk:
        senses_for_word = word_senses.get(word)
        if not senses_for_word:
            continue
        synonyms = set()
        # Primary hypernym: the head sememe of the prototypical sense (shortest definition),
        # e.g. 苹果 -> {fruit|水果}. If that sense's head sememe is the word itself — a basic
        # category like 人 -> {human|人} — no hypernym is emitted rather than guessing.
        hypernym = None
        prototypical = min(senses_for_word, key=lambda item: len(item[1].get("Def") or ""))
        label = head_sememe(prototypical[1].get("Def"))
        if label and label in hsk and label != word:
            hypernym = label
        for _no, sense in senses_for_word:
            syn = sense.get("syn") or {}
            for syn_no, score in syn.items():
                if score >= SYNONYM_SCORE:
                    other = no_to_word.get(syn_no)
                    if other and other != word:
                        synonyms.add(other)
            for other_no in group_members.get(_no, ()):
                other = no_to_word.get(other_no)
                if other and other != word:
                    synonyms.add(other)
        if not (synonyms or hypernym):
            continue
        hyponyms = [other for other in hyponym_index.get(word, []) if other != word]
        record = {}
        if synonyms:
            record["synonyms"] = sorted(synonyms & hsk)[:MAX_SYNONYMS]
        if hypernym:
            record["hypernyms"] = [hypernym]
        if hyponyms:
            record["hyponyms"] = sorted(set(hyponyms))[:MAX_HYPONYMS]
        relations[word] = record

    # ---- merge into semantic-relations.json -----------------------------------------
    path = CONTENT / "semantic-relations.json"
    existing = json.loads(path.read_text(encoding="utf-8"))
    words = existing.get("words", {})
    merged = 0
    for word, record in relations.items():
        current = words.get(word)
        if current is None:
            words[word] = record
            merged += 1
            continue
        if record.get("synonyms"):
            current["synonyms"] = sorted(set(current.get("synonyms", [])) | set(record["synonyms"]))[:MAX_SYNONYMS]
        # HowNet owns the hypernym/hyponym fields: replace, never accumulate stale links.
        if record.get("hypernyms"):
            current["hypernyms"] = record["hypernyms"]
        elif "hypernyms" in current:
            del current["hypernyms"]
        if record.get("hyponyms"):
            current["hyponyms"] = record["hyponyms"]
        elif "hyponyms" in current:
            del current["hyponyms"]
        merged += 1
    existing["words"] = dict(sorted(words.items()))
    existing["generatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    existing["source"] = "Chinese Open Wordnet 0.9 + OpenHowNet (HowNet)"
    existing["license"] = "COW permissive license + MIT (OpenHowNet)"
    path.write_text(json.dumps(existing), encoding="utf-8")
    with_relations = sum(1 for w in relations.values() if w.get("synonyms"))
    print(f"OpenHowNet merged: {merged} HSK headwords gained sense relations; "
          f"{with_relations} have synonyms; total records: {len(words)}.")


if __name__ == "__main__":
    sys.exit(main())

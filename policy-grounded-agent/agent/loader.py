"""Load the policy set, KB excerpt and transcript into citable sources."""
import re
from dataclasses import dataclass
from pathlib import Path

POLICY_GLOB = "*Policy*.md"
KB_GLOB = "*Knowledge Base*.md"
TRANSCRIPT_GLOB = "*Transcript*.txt"
TRANSCRIPT_ID = "TRANSCRIPT"

RULE_HEADING = re.compile(r"^## (Rule \d+) — (.+)$", re.M)
KB_HEADING = re.compile(r"^### (KB-\d{4}) — (.+)$", re.M)


def normalize(text):
    """Strip markdown emphasis/code markers and collapse whitespace."""
    text = text.replace("**", "").replace("`", "")
    return re.sub(r"\s+", " ", text).strip()


@dataclass(frozen=True)
class Section:
    source_id: str
    title: str
    text: str


def _split(text, heading_re):
    matches = list(heading_re.finditer(text))
    sections = {}
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[m.end():end].strip().strip("-").strip()
        sections[m.group(1)] = Section(m.group(1), m.group(2).strip(), body)
    return sections


class Bundle:
    def __init__(self, rules, articles, transcript_text, paths):
        self.rules = rules
        self.articles = articles
        self.transcript_text = transcript_text
        self.paths = paths

    def source_text(self, source_id):
        if source_id == TRANSCRIPT_ID:
            return self.transcript_text
        if source_id in self.rules:
            return self.rules[source_id].text
        return self.articles[source_id].text


def _one(data_dir, pattern):
    found = sorted(Path(data_dir).glob(pattern))
    if len(found) != 1:
        raise FileNotFoundError(f"expected one file matching {pattern!r} in {data_dir}, found {len(found)}")
    return found[0]


def load_bundle(data_dir):
    policy_path = _one(data_dir, POLICY_GLOB)
    kb_path = _one(data_dir, KB_GLOB)
    transcript_path = _one(data_dir, TRANSCRIPT_GLOB)
    rules = _split(policy_path.read_text(encoding="utf-8"), RULE_HEADING)
    articles = _split(kb_path.read_text(encoding="utf-8"), KB_HEADING)
    if not rules or not articles:
        raise ValueError("could not parse rules or KB articles")
    return Bundle(
        rules,
        articles,
        transcript_path.read_text(encoding="utf-8"),
        {"policy": policy_path, "kb": kb_path, "transcript": transcript_path},
    )

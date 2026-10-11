"""Okapi BM25 over KB articles. Supplies evidence only; never selects policy."""
import math
import re
from collections import Counter

STOPWORDS = frozenset(
    "a an and are as at be but by can do does for from has have i if in is isn it its me my "
    "of on only or our so that the their them then there this to was we were what when which "
    "while who will with you your".split()
)


def tokenize(text):
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOPWORDS]


class BM25Index:
    def __init__(self, docs, k1=1.5, b=0.75):
        """docs: iterable of (doc_id, text)."""
        self.k1, self.b = k1, b
        self.ids = []
        self.tfs = []
        self.lengths = []
        df = Counter()
        for doc_id, text in docs:
            tokens = tokenize(text)
            self.ids.append(doc_id)
            self.tfs.append(Counter(tokens))
            self.lengths.append(len(tokens))
            df.update(set(tokens))
        n = len(self.ids)
        self.avgdl = sum(self.lengths) / n if n else 0.0
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def search(self, query, k=None):
        """Return [(doc_id, score)] with score > 0, sorted by score desc then id."""
        terms = tokenize(query)
        scored = []
        for doc_id, tf, length in zip(self.ids, self.tfs, self.lengths):
            score = 0.0
            for t in terms:
                f = tf.get(t)
                if f:
                    denom = f + self.k1 * (1 - self.b + self.b * length / self.avgdl)
                    score += self.idf[t] * f * (self.k1 + 1) / denom
            if score > 0:
                scored.append((doc_id, round(score, 4)))
        scored.sort(key=lambda x: (-x[1], x[0]))
        return scored[:k] if k else scored

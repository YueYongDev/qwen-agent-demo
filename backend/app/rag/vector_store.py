"""Lightweight TF-IDF based vector store for the RAG tool."""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Tuple

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


class VectorStore:
    """Indexes small text corpora using TF-IDF for quick similarity lookups."""

    def __init__(self, data_path: Path):
        if not data_path.exists():
            raise FileNotFoundError(f"Knowledge base file not found: {data_path}")

        with data_path.open("r", encoding="utf-8") as fh:
            raw_docs = json.load(fh)

        if not isinstance(raw_docs, list):
            raise ValueError("Knowledge base must be a JSON array of documents.")

        self.docs = raw_docs
        corpus = [doc["content"] for doc in self.docs]

        self.vectorizer = TfidfVectorizer(stop_words="english")
        self.matrix = self.vectorizer.fit_transform(corpus)

    def search(self, query: str, top_k: int = 3) -> List[Tuple[dict, float]]:
        """Return the ``top_k`` most similar documents to ``query``."""

        if not query.strip():
            return []

        query_vec = self.vectorizer.transform([query])
        similarities = cosine_similarity(query_vec, self.matrix).flatten()

        ranked_indices = similarities.argsort()[::-1][:top_k]
        return [(self.docs[idx], float(similarities[idx])) for idx in ranked_indices]

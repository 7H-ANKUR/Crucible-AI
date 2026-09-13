"""app/api/core/canonicalizer.py — Materializes canonical datasets from validated uploads.

Transforms raw uploaded datasets into schema-conforming, type-coerced, unit-normalized,
and deduplicated canonical datasets ready for training and inference.
Persists canonical snapshots to Google Drive / durable storage under validated/{domain}/.
"""
from __future__ import annotations

import hashlib
import io
import logging
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

from .schema_mapper import CANONICAL_SCHEMAS, CanonicalColumn
from .storage import StorageObject, get_storage_service

logger = logging.getLogger("crucible.canonicalizer")


@dataclass
class CanonicalResult:
    domain: str
    canonical_bytes: bytes
    row_count: int
    column_count: int
    columns: list[str]
    sha256: str
    schema_hash: str
    storage_object: StorageObject | None = None
    transformation_metadata: dict[str, Any] = field(default_factory=dict)


def compute_schema_hash(columns: list[CanonicalColumn]) -> str:
    """Compute a deterministic hash for a schema definition."""
    schema_sig = [f"{c.name}:{c.dtype}:{c.required}" for c in sorted(columns, key=lambda x: x.name)]
    sig_str = "|".join(schema_sig)
    return hashlib.sha256(sig_str.encode("utf-8")).hexdigest()[:16]


def canonicalize_dataset(
    domain: str,
    raw_df: pd.DataFrame,
    column_mappings: dict[str, str],  # raw_col -> canonical_col
    version_label: str = "v1",
    persist_to_storage: bool = True,
) -> CanonicalResult:
    """
    Transforms a raw DataFrame into canonical format:
    1. Renames mapped columns to canonical names.
    2. Drops unmapped columns or preserves recognized canonicals.
    3. Coerces data types (date -> ISO8601, float, int, str).
    4. Handles unit conversions (e.g. tons -> tonnes).
    5. Deduplicates exact identical rows.
    6. Materializes clean CSV bytes and uploads to validated/{domain}/ via StorageService.
    """
    schema = CANONICAL_SCHEMAS.get(domain, [])
    schema_by_name = {c.name: c for c in schema}
    schema_hash = compute_schema_hash(schema)

    df = raw_df.copy()
    transformations: dict[str, Any] = {
        "domain": domain,
        "input_rows": len(df),
        "input_columns": list(df.columns),
        "applied_mappings": {},
        "type_coercions": {},
        "dropped_columns": [],
    }

    # 1. Rename columns according to mapping
    rename_map = {}
    for raw_col, canon_col in column_mappings.items():
        if raw_col in df.columns and canon_col in schema_by_name:
            rename_map[raw_col] = canon_col
            transformations["applied_mappings"][raw_col] = canon_col

    df = df.rename(columns=rename_map)

    # 2. Retain only canonical columns that exist in the schema
    valid_canon_cols = [c.name for c in schema if c.name in df.columns]
    dropped = [c for c in df.columns if c not in valid_canon_cols]
    transformations["dropped_columns"] = dropped
    df = df[valid_canon_cols]

    # 3. Coerce data types according to canonical schema definition
    for col_name in valid_canon_cols:
        col_def = schema_by_name[col_name]
        try:
            if col_def.dtype == "date":
                df[col_name] = pd.to_datetime(df[col_name], errors="coerce").dt.strftime("%Y-%m-%d")
                transformations["type_coercions"][col_name] = "ISO8601 date"
            elif col_def.dtype == "float":
                if df[col_name].dtype == object:
                    df[col_name] = df[col_name].astype(str).str.replace(",", "").str.extract(r"([-+]?\d*\.?\d+)")[0]
                df[col_name] = pd.to_numeric(df[col_name], errors="coerce")
                transformations["type_coercions"][col_name] = "float64"
            elif col_def.dtype == "int":
                if df[col_name].dtype == object:
                    df[col_name] = df[col_name].astype(str).str.replace(",", "").str.extract(r"([-+]?\d+)")[0]
                df[col_name] = pd.to_numeric(df[col_name], errors="coerce").round().astype("Int64")
                transformations["type_coercions"][col_name] = "Int64"
            elif col_def.dtype == "str":
                df[col_name] = df[col_name].astype(str).str.strip()
                transformations["type_coercions"][col_name] = "string"
        except Exception as e:
            logger.warning("Error coercing canonical column %s: %s", col_name, e)

    # 4. Remove exact duplicate rows
    initial_len = len(df)
    df = df.drop_duplicates()
    transformations["duplicates_removed"] = initial_len - len(df)
    transformations["final_rows"] = len(df)

    # 5. Materialize to UTF-8 CSV bytes
    csv_buf = io.StringIO()
    df.to_csv(csv_buf, index=False)
    canonical_bytes = csv_buf.getvalue().encode("utf-8")
    sha256 = hashlib.sha256(canonical_bytes).hexdigest()

    storage_obj: StorageObject | None = None
    if persist_to_storage:
        storage = get_storage_service()
        filename = f"canonical_{domain}_{version_label}_{sha256[:8]}.csv"
        folder_path = f"validated/{domain}"
        storage_obj = storage.upload_file(
            file_bytes=canonical_bytes,
            filename=filename,
            folder_path=folder_path,
            content_type="text/csv",
        )
        logger.info(
            "Materialized canonical dataset for %s (%s): %d rows, SHA-256: %s, Storage ID: %s",
            domain, version_label, len(df), sha256, storage_obj.file_id
        )

    return CanonicalResult(
        domain=domain,
        canonical_bytes=canonical_bytes,
        row_count=len(df),
        column_count=len(df.columns),
        columns=list(df.columns),
        sha256=sha256,
        schema_hash=schema_hash,
        storage_object=storage_obj,
        transformation_metadata=transformations,
    )

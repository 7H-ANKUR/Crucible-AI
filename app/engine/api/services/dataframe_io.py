"""
api/services/dataframe_io.py
----------------------------
Single tabular-file loader shared by every caller that turns a stored dataset
record back into a DataFrame.

This exists because the loader was previously duplicated: the dataset service
passed ``sep="\\t"`` for TSV while the pipeline router reused the plain CSV
reader, so a TSV dataset that profiled correctly was parsed as one column when
a pipeline ran against it. One implementation removes the class of bug rather
than the instance.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from api.exceptions import UnsupportedFileTypeError

#: Extensions this loader understands. Kept here so the dataset service's
#: upload allowlist and the loader cannot drift apart.
SUPPORTED_EXTENSIONS = frozenset({".csv", ".tsv", ".parquet"})


def load_dataframe(path: Path | str, ext: str) -> pd.DataFrame:
    """Read a tabular file into a DataFrame.

    Args:
        path: Location of the stored file.
        ext: Lowercased extension including the leading dot, taken from the
            record's safe filename rather than from ``path``, which may be an
            opaque storage name with no extension.

    Raises:
        UnsupportedFileTypeError: The extension is not in SUPPORTED_EXTENSIONS.
    """
    path = Path(path)
    if ext == ".csv":
        return pd.read_csv(path)
    if ext == ".tsv":
        return pd.read_csv(path, sep="\t")
    if ext == ".parquet":
        return pd.read_parquet(path)
    raise UnsupportedFileTypeError(path.name)


def load_dataframe_from_record(record: dict[str, Any]) -> pd.DataFrame:
    """Read the DataFrame a stored dataset record points at."""
    return load_dataframe(
        Path(record["file_path"]),
        Path(record["safe_filename"]).suffix.lower(),
    )

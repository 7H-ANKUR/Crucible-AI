"""
tests/test_dataframe_io.py
--------------------------
Regression tests for the shared tabular loader.

The bug these exist for: the dataset service read TSV with ``sep="\\t"`` while the
pipeline router reused the plain CSV reader. A TSV therefore profiled correctly —
showing its real columns in the UI — and then ran through the pipeline as a single
column whose name was the whole tab-joined header. Nothing raised. The run simply
failed later, or worse, trained on a degenerate frame.

Both callers now share ``api.services.dataframe_io``. These tests pin that.
"""

from __future__ import annotations

import pandas as pd
import pytest

from api.exceptions import UnsupportedFileTypeError
from api.services.dataframe_io import (
    SUPPORTED_EXTENSIONS,
    load_dataframe,
    load_dataframe_from_record,
)

FRAME = pd.DataFrame(
    {
        "site_id": ["MH-01", "MH-02", "MH-03"],
        "tonnes": [812.5, 774.0, 903.25],
        "shortfall": [0, 1, 0],
    }
)


@pytest.fixture
def csv_file(tmp_path):
    p = tmp_path / "production.csv"
    FRAME.to_csv(p, index=False)
    return p


@pytest.fixture
def tsv_file(tmp_path):
    p = tmp_path / "production.tsv"
    FRAME.to_csv(p, sep="\t", index=False)
    return p


@pytest.fixture
def parquet_file(tmp_path):
    p = tmp_path / "production.parquet"
    FRAME.to_parquet(p, index=False)
    return p


class TestLoadDataframe:
    def test_csv_round_trips(self, csv_file):
        df = load_dataframe(csv_file, ".csv")
        pd.testing.assert_frame_equal(df, FRAME)

    def test_tsv_splits_on_tabs(self, tsv_file):
        """The regression. Read as CSV this yields one column, not three."""
        df = load_dataframe(tsv_file, ".tsv")
        assert list(df.columns) == ["site_id", "tonnes", "shortfall"]
        assert df.shape == (3, 3)
        pd.testing.assert_frame_equal(df, FRAME)

    def test_tsv_header_is_not_one_joined_column(self, tsv_file):
        """Name the failure mode directly so a future regression is unambiguous."""
        df = load_dataframe(tsv_file, ".tsv")
        assert not any("\t" in str(c) for c in df.columns)

    def test_parquet_round_trips(self, parquet_file):
        df = load_dataframe(parquet_file, ".parquet")
        pd.testing.assert_frame_equal(df, FRAME)

    def test_unsupported_extension_raises(self, tmp_path):
        p = tmp_path / "notes.txt"
        p.write_text("nope", encoding="utf-8")
        with pytest.raises(UnsupportedFileTypeError):
            load_dataframe(p, ".txt")

    def test_supported_extensions_are_all_handled(self, tmp_path):
        """Every advertised extension must have a branch."""
        for ext in SUPPORTED_EXTENSIONS:
            p = tmp_path / f"data{ext}"
            if ext == ".parquet":
                FRAME.to_parquet(p, index=False)
            else:
                FRAME.to_csv(p, sep="\t" if ext == ".tsv" else ",", index=False)
            assert load_dataframe(p, ext).shape == FRAME.shape


class TestLoadFromRecord:
    def test_uses_safe_filename_extension_not_path(self, tmp_path):
        """Stored files carry opaque names; the extension comes from the record.

        The store writes uploads under a generated id with no extension, so a
        loader that inspected the path would fall through every branch.
        """
        stored = tmp_path / "8f2a1c9e4b6d"
        FRAME.to_csv(stored, sep="\t", index=False)

        df = load_dataframe_from_record(
            {"file_path": str(stored), "safe_filename": "production.tsv"}
        )
        assert list(df.columns) == ["site_id", "tonnes", "shortfall"]

    def test_record_csv(self, csv_file):
        df = load_dataframe_from_record(
            {"file_path": str(csv_file), "safe_filename": "production.csv"}
        )
        pd.testing.assert_frame_equal(df, FRAME)


class TestCallersShareOneLoader:
    """Both call sites must resolve to this module, or the bug can return."""

    def test_pipeline_router_imports_shared_loader(self):
        from api.routers import pipelines

        assert pipelines.load_dataframe_from_record is load_dataframe_from_record

    def test_dataset_service_delegates_to_shared_loader(self, tsv_file):
        from api.services.dataset_service import DatasetService

        svc = DatasetService(
            dataset_store=None, upload_tmp_root=tsv_file.parent, max_upload_bytes=1
        )
        df = svc._load_df(tsv_file, ".tsv")
        assert list(df.columns) == ["site_id", "tonnes", "shortfall"]

"""app/api/tests/test_storage.py — Unit tests for StorageService and artifact caching."""
from app.api.core.storage import StorageService, compute_sha256


def test_compute_sha256():
    """Verify SHA-256 computation matches standard library hashlib."""
    import hashlib
    data = b"Crucible AI enterprise storage test content"
    expected = hashlib.sha256(data).hexdigest()
    assert compute_sha256(data) == expected


def test_upload_and_download_file(tmp_path):
    """Verify upload writes to storage cache and download retrieves exact bytes."""
    service = StorageService(local_storage_dir=tmp_path)
    content = b"sample manganese ore production record,150.5,grade,32.4"
    filename = "test_upload_record.csv"
    folder = "datasets/production"

    obj = service.upload_file(content, filename, folder, "text/csv")
    assert obj.filename == filename
    assert obj.size_bytes == len(content)
    assert obj.sha256 == compute_sha256(content)
    assert obj.file_id is not None

    downloaded = service.download_file(obj.file_id)
    assert downloaded == content


def test_ensure_local_cache(tmp_path):
    """Verify ensure_local_cache verifies checksum and downloads if missing."""
    service = StorageService(local_storage_dir=tmp_path)
    content = b"model_artifact_weights_binary_data"
    expected_hash = compute_sha256(content)
    obj = service.upload_file(content, "model.joblib", "models/production")

    target_cache_path = tmp_path / "cache_test" / "model.joblib"
    assert not target_cache_path.exists()

    # Ensure local cache
    ok = service.ensure_local_cache(obj.file_id, target_cache_path, expected_sha256=expected_hash)
    assert ok is True
    assert target_cache_path.exists()
    assert target_cache_path.read_bytes() == content

    # Second call should be a fast cache hit
    ok2 = service.ensure_local_cache(obj.file_id, target_cache_path, expected_sha256=expected_hash)
    assert ok2 is True


def test_file_exists_check(tmp_path):
    """Verify file_exists correctly identifies existing and absent files."""
    service = StorageService(local_storage_dir=tmp_path)
    content = b"temporary report"
    obj = service.upload_file(content, "report.json", "reports")

    assert service.file_exists(obj.file_id) is True
    assert service.file_exists("local-nonexistentfile12345") is False

"""apps/api/routers/data_hub.py — Data Hub upload, mapping, validation, versioning.

Endpoints:
  POST /api/v1/data/upload              — upload CSV/XLSX file for a domain (persists to storage)
  GET  /api/v1/data/domains             — list supported domains + canonical schemas
  GET  /api/v1/data/versions            — list all dataset versions with storage metadata
  GET  /api/v1/data/versions/{id}       — get version detail + validation report + lineage
  POST /api/v1/data/versions/{id}/map   — accept/correct column mappings
  POST /api/v1/data/versions/{id}/validate  — run 25-check validation & materialize canonical snapshot
  POST /api/v1/data/versions/{id}/approve  — approve for training (role & domain gated)
"""
import io
import json
import logging
import os
import pathlib
import re

import pandas as pd
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from ..core.canonicalizer import canonicalize_dataset
from ..core.data_validator import validate_dataset
from ..core.db import execute, query, transaction
from ..core.rbac import check_domain_access, require_authenticated
from ..core.schema_mapper import get_canonical_schema, list_domains, map_columns
from ..core.security import get_current_user
from ..core.storage import get_storage_service

router = APIRouter(tags=["data_hub"])


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class ColumnMappingUpdate(BaseModel):
    source_column: str
    canonical_column: str | None


class MappingApplyRequest(BaseModel):
    mappings: list[ColumnMappingUpdate]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/domains")
def list_supported_domains():
    """List supported domains and their canonical schemas."""
    result = {}
    for domain in list_domains():
        cols = get_canonical_schema(domain)
        result[domain] = {
            "required_columns": [c.name for c in cols if c.required],
            "all_columns": [
                {
                    "name": c.name,
                    "type": c.dtype,
                    "required": c.required,
                    "description": c.description,
                    "unit": c.unit,
                    "min_val": c.min_val,
                    "max_val": c.max_val,
                }
                for c in cols
            ],
        }
    return {"domains": result, "data_origin": "SYSTEM"}


@router.post("/upload")
async def upload_dataset(
    domain: str = Form(...),
    name: str = Form(...),
    description: str = Form(""),
    file: UploadFile = File(...),
    user=Depends(require_authenticated()),
):
    """
    Upload a CSV or XLSX file for a domain.
    Stores file durably via StorageService (Google Drive + cache).
    Supports multi-version increments (v1 -> v2) if dataset name already exists.
    Auto-maps columns and returns version info with checksums.
    """
    if domain not in list_domains():
        raise HTTPException(400, f"Domain '{domain}' not supported. Choose from: {list_domains()}")

    if not check_domain_access(user, domain):
        raise HTTPException(
            status_code=403,
            detail=f"Role '{user.get('role')}' is not authorized to upload data for domain '{domain}'.",
        )

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(400, "Uploaded file is empty.")
    MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large. Maximum {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")

    raw_filename = file.filename or "upload.csv"
    # Filename sanitization to prevent path traversal
    filename = pathlib.Path(raw_filename).name
    if not filename or filename in (".", ".."):
        filename = "upload.csv"

    # --- Extension allowlist ---
    ext = filename.lower().split(".")[-1]
    if ext not in ("csv", "xlsx", "xls", "parquet"):
        raise HTTPException(422, f"Unsupported file extension: .{ext}. Allowed: .csv, .xlsx, .xls, .parquet.")

    # --- Peek at columns ---
    try:
        if ext == "csv":
            df_head = pd.read_csv(io.BytesIO(content), nrows=5)
        elif ext in ("xlsx", "xls"):
            df_head = pd.read_excel(io.BytesIO(content), nrows=5)
        elif ext == "parquet":
            df_head = pd.read_parquet(io.BytesIO(content)).head(5)
        source_cols = list(df_head.columns)
    except Exception as e:
        raise HTTPException(422, f"Could not parse file columns: {e}")

    # --- Version calculation (multi-version support) ---
    existing_ds = query(
        "SELECT id FROM hub.datasets WHERE domain = %s AND name = %s",
        (domain, name.strip())
    )

    parent_version_id = None
    if existing_ds:
        dataset_id = existing_ds[0]["id"]
        latest_ver_row = query(
            "SELECT id, version_tag FROM hub.dataset_versions WHERE dataset_id = %s ORDER BY id DESC LIMIT 1",
            (dataset_id,)
        )
        if latest_ver_row:
            parent_version_id = latest_ver_row[0]["id"]
            prev_tag = latest_ver_row[0]["version_tag"]
            match = re.search(r"v(\d+)", prev_tag)
            num = int(match.group(1)) + 1 if match else 2
            version_tag = f"v{num}"
        else:
            version_tag = "v1"
    else:
        version_tag = "v1"

    # --- Persist file to durable storage (Google Drive / storage service) ---
    storage = get_storage_service()
    storage_obj = storage.upload_file(
        file_bytes=content,
        filename=f"{version_tag}_{filename.replace(' ', '_')}",
        folder_path=f"datasets/{domain}",
        content_type=file.content_type or "text/csv",
    )

    # --- Auto-map columns ---
    mappings = map_columns(domain, source_cols)

    # --- Insert version record with storage metadata & checksum atomically ---
    with transaction() as tx:
        if not existing_ds:
            ds_rows = tx.query(
                "INSERT INTO hub.datasets(domain, name, description, created_by) VALUES(%s,%s,%s,%s) RETURNING id",
                (domain, name.strip(), description.strip(), user["username"])
            )
            dataset_id = ds_rows[0]["id"]

        ver_rows = tx.query(
            """INSERT INTO hub.dataset_versions
               (dataset_id, version_tag, file_path, drive_file_id, drive_folder_id, checksum_sha256,
                file_size_bytes, content_type, original_filename, parent_version_id,
                storage_status, status, uploaded_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'UPLOADED', %s)
               RETURNING id""",
            (
                dataset_id,
                version_tag,
                f"datasets/{domain}/{storage_obj.filename}",
                storage_obj.file_id,
                storage_obj.metadata.drive_folder_id,
                storage_obj.sha256,
                storage_obj.size_bytes,
                storage_obj.content_type,
                filename,
                parent_version_id,
                storage_obj.metadata.storage_status,
                user["username"],
            )
        )
        version_id = ver_rows[0]["id"]

        # --- Insert column mappings ---
        for m in mappings:
            tx.execute(
                """INSERT INTO hub.dataset_column_mappings
                   (version_id, source_column, canonical_column, confidence, requires_review, mapped_by)
                   VALUES(%s,%s,%s,%s,%s,%s)""",
                (version_id, m.source_column, m.canonical_column,
                 m.confidence, m.requires_review, "system_automapper")
            )

    # Invalidate domain cache after new dataset version is uploaded
    try:
        from ..core.cache import invalidate_dataset
        invalidate_dataset(domain)
    except Exception:
        pass

    return {
        "dataset_id":        dataset_id,
        "version_id":        version_id,
        "domain":            domain,
        "name":              name,
        "version_tag":       version_tag,
        "parent_version_id": parent_version_id,
        "drive_file_id":     storage_obj.file_id,
        "checksum_sha256":   storage_obj.sha256,
        "file_size_bytes":   storage_obj.size_bytes,
        "status":            "UPLOADED",
        "source_columns":    source_cols,
        "column_mappings": [
            {
                "source_column":    m.source_column,
                "canonical_column": m.canonical_column,
                "confidence":       m.confidence,
                "requires_review":  m.requires_review,
                "reason":           m.reason,
            }
            for m in mappings
        ],
        "unresolved_count": sum(1 for m in mappings if m.requires_review),
        "data_origin":      "REAL_USER_UPLOADED",
    }


@router.get("/versions")
def list_versions(domain: str | None = None, user=Depends(get_current_user)):
    """List all dataset versions with lineage and storage information."""
    if domain:
        rows = query(
            """SELECT v.id, v.version_tag, v.status, v.row_count, v.uploaded_by, v.created_at,
                      v.drive_file_id, v.checksum_sha256, v.file_size_bytes, v.storage_status,
                      v.canonical_drive_file_id, v.canonical_row_count, v.parent_version_id,
                      d.domain, d.name as dataset_name
               FROM hub.dataset_versions v
               JOIN hub.datasets d ON d.id = v.dataset_id
               WHERE d.domain = %s
               ORDER BY v.created_at DESC""",
            (domain,)
        )
    else:
        rows = query(
            """SELECT v.id, v.version_tag, v.status, v.row_count, v.uploaded_by, v.created_at,
                      v.drive_file_id, v.checksum_sha256, v.file_size_bytes, v.storage_status,
                      v.canonical_drive_file_id, v.canonical_row_count, v.parent_version_id,
                      d.domain, d.name as dataset_name
               FROM hub.dataset_versions v
               JOIN hub.datasets d ON d.id = v.dataset_id
               ORDER BY v.created_at DESC"""
        )
    return {"versions": rows, "count": len(rows), "data_origin": "REAL_USER_UPLOADED"}


@router.get("/versions/{version_id}")
def get_version(version_id: int, user=Depends(get_current_user)):
    """Get full version detail including column mappings, storage IDs, and validation report."""
    ver = query(
        """SELECT v.*, d.domain, d.name as dataset_name
           FROM hub.dataset_versions v
           JOIN hub.datasets d ON d.id = v.dataset_id
           WHERE v.id = %s""",
        (version_id,)
    )
    if not ver:
        raise HTTPException(404, f"Version {version_id} not found.")

    mappings = query(
        "SELECT * FROM hub.dataset_column_mappings WHERE version_id = %s ORDER BY id",
        (version_id,)
    )
    report_rows = query(
        "SELECT * FROM hub.dataset_validation_reports WHERE version_id = %s",
        (version_id,)
    )
    report = None
    if report_rows:
        r = report_rows[0]
        report = json.loads(r["report_json"])

    return {
        "version":           ver[0],
        "mappings":          mappings,
        "validation_report": report,
        "data_origin":       "REAL_USER_UPLOADED",
    }


@router.post("/versions/{version_id}/map")
def apply_mappings(
    version_id: int,
    body: MappingApplyRequest,
    user=Depends(require_authenticated()),
):
    """Accept or update column mappings for a version."""
    ver = query(
        """SELECT v.id, v.status, d.domain
           FROM hub.dataset_versions v
           JOIN hub.datasets d ON d.id = v.dataset_id
           WHERE v.id = %s""",
        (version_id,)
    )
    if not ver:
        raise HTTPException(404, f"Version {version_id} not found.")

    domain = ver[0]["domain"]
    if not check_domain_access(user, domain):
        raise HTTPException(
            status_code=403,
            detail=f"Role '{user.get('role')}' cannot modify mappings for domain '{domain}'.",
        )

    with transaction() as tx:
        for m in body.mappings:
            tx.execute(
                """UPDATE hub.dataset_column_mappings
                   SET canonical_column=%s, confidence=1.0, requires_review=FALSE, mapped_by=%s, updated_at=NOW()
                   WHERE version_id=%s AND source_column=%s""",
                (m.canonical_column, user["username"], version_id, m.source_column)
            )

        # Mapping mutation invalidates previous validation: requires re-validation
        tx.execute(
            """UPDATE hub.dataset_versions
               SET status='MAPPED'
               WHERE id=%s AND status IN ('UPLOADED', 'VALIDATED', 'APPROVED_FOR_TRAINING')""",
            (version_id,)
        )

        try:
            audit_payload = json.dumps({
                "action": "dataset_mapped",
                "domain": domain,
                "version_id": version_id,
                "mapped_by": user["username"],
                "updated_count": len(body.mappings),
                "mappings": [{"source": m.source_column, "canonical": m.canonical_column} for m in body.mappings]
            })
            tx.execute(
                """INSERT INTO gov.audit_log (event_type, actor_id, actor_role, entity_type, entity_id, payload)
                   VALUES ('dataset_mapped', %s, %s, 'dataset_version', %s, %s)""",
                (user["username"], user.get("role", "operator"), str(version_id), audit_payload)
            )
        except Exception as e:
            logger.error("Failed to write audit log for dataset_mapped %s: %s", version_id, e)

    return {"version_id": version_id, "status": "MAPPED", "mappings_updated": len(body.mappings)}


@router.post("/versions/{version_id}/validate")
def run_validation(version_id: int, user=Depends(require_authenticated())):
    """
    Run the 25-check validation engine on the uploaded file.
    If validation passes, materialize a canonical dataset snapshot and upload it to storage.
    """
    ver = query(
        """SELECT v.*, d.domain, d.name as dataset_name
           FROM hub.dataset_versions v
           JOIN hub.datasets d ON d.id = v.dataset_id
           WHERE v.id = %s""",
        (version_id,)
    )
    if not ver:
        raise HTTPException(404, f"Version {version_id} not found.")
    row = ver[0]
    domain = row["domain"]
    drive_file_id = row.get("drive_file_id")
    file_path = row.get("file_path") or ""

    storage = get_storage_service()

    # Load file content
    content = None
    if drive_file_id:
        try:
            content = storage.download_file(drive_file_id)
        except Exception:
            # Fallback to local path if present
            pass

    if content is None and file_path and os.path.exists(file_path):
        with open(file_path, "rb") as f:
            content = f.read()

    if content is None:
        raise HTTPException(422, f"Could not locate file content for version {version_id}.")

    filename = row.get("original_filename") or os.path.basename(file_path) or "data.csv"
    report = validate_dataset(domain, content, filename)

    # Persist validation report
    execute(
        """INSERT INTO hub.dataset_validation_reports(version_id, report_json, quality_score, passed)
           VALUES(%s, %s, %s, %s)
           ON CONFLICT (version_id) DO UPDATE
           SET report_json=%s, quality_score=%s, passed=%s, created_at=NOW()""",
        (version_id, report.to_json(), report.quality_score, report.passed,
         report.to_json(), report.quality_score, report.passed)
    )

    # Materialize canonical dataset if validation passed
    canonical_drive_id = None
    canonical_sha256 = None
    canonical_rows = 0
    schema_hash = None

    if report.passed:
        try:
            # Read mapped columns
            map_rows = query(
                "SELECT source_column, canonical_column FROM hub.dataset_column_mappings WHERE version_id = %s",
                (version_id,)
            )
            mapping_dict = {
                r["source_column"]: r["canonical_column"]
                for r in map_rows if r.get("canonical_column")
            }

            ext = filename.lower().split(".")[-1]
            if ext == "csv":
                raw_df = pd.read_csv(io.BytesIO(content), low_memory=False)
            else:
                raw_df = pd.read_excel(io.BytesIO(content))

            canon_res = canonicalize_dataset(
                domain=domain,
                raw_df=raw_df,
                column_mappings=mapping_dict,
                version_label=row.get("version_tag", "v1"),
                persist_to_storage=True,
            )
            canonical_drive_id = canon_res.storage_object.file_id if canon_res.storage_object else None
            canonical_sha256 = canon_res.sha256
            canonical_rows = canon_res.row_count
            schema_hash = canon_res.schema_hash

            execute(
                """UPDATE hub.dataset_versions
                   SET status='VALIDATED',
                       row_count=%s,
                       canonical_drive_file_id=%s,
                       canonical_checksum_sha256=%s,
                       canonical_row_count=%s,
                       schema_hash=%s,
                       transformation_metadata=%s
                   WHERE id=%s""",
                (report.row_count, canonical_drive_id, canonical_sha256,
                 canonical_rows, schema_hash, json.dumps(canon_res.transformation_metadata), version_id)
            )
        except Exception:
            # Mark validated with raw rows even if canonicalization had warning
            execute(
                "UPDATE hub.dataset_versions SET status='VALIDATED', row_count=%s WHERE id=%s",
                (report.row_count, version_id)
            )
    else:
        execute(
            "UPDATE hub.dataset_versions SET status='VALIDATION_FAILED', row_count=%s WHERE id=%s",
            (report.row_count, version_id)
        )

    return {
        "version_id":               version_id,
        "status":                   "VALIDATED" if report.passed else "VALIDATION_FAILED",
        "quality_score":            report.quality_score,
        "passed":                   report.passed,
        "summary":                  report.summary,
        "row_count":                report.row_count,
        "canonical_drive_file_id":  canonical_drive_id,
        "canonical_checksum_sha256": canonical_sha256,
        "canonical_row_count":      canonical_rows,
        "schema_hash":              schema_hash,
        "checks": [
            {
                "check_id":       c.check_id,
                "name":           c.name,
                "category":       c.category,
                "passed":         c.passed,
                "severity":       c.severity,
                "message":        c.message,
                "affected_count": c.affected_count,
                "affected_pct":   c.affected_pct,
            }
            for c in report.checks
        ],
    }


@router.post("/versions/{version_id}/approve")
def approve_version(
    version_id: int,
    note: str = Body(default="", embed=True),
    user=Depends(require_authenticated()),
):
    """
    Approve a validated dataset version for training.
    Requires that the version passed validation and user has domain authority.
    """
    ver = query(
        """SELECT v.id, v.status, d.domain, v.canonical_drive_file_id, v.checksum_sha256
           FROM hub.dataset_versions v
           JOIN hub.datasets d ON d.id = v.dataset_id
           WHERE v.id = %s""",
        (version_id,)
    )
    if not ver:
        raise HTTPException(404, f"Version {version_id} not found.")

    domain = ver[0]["domain"]
    if not check_domain_access(user, domain):
        raise HTTPException(
            status_code=403,
            detail=f"Role '{user.get('role')}' cannot approve datasets for domain '{domain}'.",
        )

    if ver[0]["status"] != "VALIDATED":
        raise HTTPException(
            status_code=422,
            detail=f"Version must be in VALIDATED state before approval. Current status: {ver[0]['status']}",
        )

    with transaction() as tx:
        tx.execute(
            "UPDATE hub.dataset_versions SET status='APPROVED_FOR_TRAINING' WHERE id=%s",
            (version_id,)
        )

        # Audit log entry
        try:
            audit_payload = json.dumps({
                "action": "dataset_approved",
                "domain": domain,
                "version_id": version_id,
                "approved_by": user["username"],
                "note": note or ""
            })
            tx.execute(
                """INSERT INTO gov.audit_log(event_type, actor_id, actor_role, entity_type, entity_id, payload)
                   VALUES(%s,%s,%s,%s,%s,%s)""",
                (
                    "dataset_approved",
                    user["username"],
                    user.get("role", "admin"),
                    "dataset_version",
                    str(version_id),
                    audit_payload,
                )
            )
        except Exception as e:
            logger.error("Failed to write audit log for dataset_approved %s: %s", version_id, e)


    # Invalidate domain cache after dataset approval
    try:
        from ..core.cache import invalidate_dataset
        invalidate_dataset(domain)
    except Exception:
        pass

    return {
        "version_id":  version_id,
        "status":      "APPROVED_FOR_TRAINING",
        "approved_by": user["username"],
        "domain":      domain,
        "message":     "Version approved. You can now trigger a cloud training run with this dataset.",
    }

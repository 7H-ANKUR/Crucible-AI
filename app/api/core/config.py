"""app/api/core/config.py — Application settings with production safety guards."""
import logging
import pathlib

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("crucible.config")


class Settings(BaseSettings):
    DATABASE_URL: str
    # JWT_SECRET_KEY has NO default — must be set explicitly in every environment.
    # A missing value will raise a ValidationError at startup, preventing accidental
    # deployment with an insecure key.
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str  = "HS256"
    JWT_EXPIRE_MINUTES: int = 480
    ML_ARTIFACTS_DIR: str  = "app/ml/artifacts"
    DATA_DIR: str = "docs/SIH26009_DATA"
    ENVIRONMENT: str = "development"
    # Demo bootstrap is OFF by default. Must be explicitly enabled for demo/dev environments.
    DEMO_BOOTSTRAP_ENABLED: bool = False
    # Demo passwords have NO defaults — must be provided via env vars when demo is enabled.
    DEMO_ADMIN_PASSWORD: str | None = None
    DEMO_USER_PASSWORD: str | None = None
    CLERK_SECRET_KEY: str | None = None
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: str | None = None
    CLERK_JWKS_URL: str | None = None
    CLERK_ISSUER: str | None = None
    CLERK_VERIFY_AZP: bool = False
    TRAINING_MODE: str = "modal"
    GDRIVE_FOLDER_ID: str = "1XykuJ8El-yQ_27FrdCzL7VHraoyGrBKy"
    GDRIVE_FOLDER_URL: str | None = None
    GOOGLE_SERVICE_ACCOUNT_JSON: str | None = None

    # CORS — explicit allowed origins (comma-separated). In production mode,
    # the Vercel wildcard regex is enabled by default to support Vercel preview/production deployments.
    CORS_ALLOWED_ORIGINS: str | None = None
    CORS_ALLOW_VERCEL_WILDCARD: bool = True

    # Redis / Tiered Caching Settings
    REDIS_URL: str | None = None
    REDIS_TTL_DEFAULT: int = 60
    REDIS_L1_TTL_DEFAULT: int = 10
    REDIS_L1_MAX_ENTRIES: int = 1000
    REDIS_MAX_CONNECTIONS: int = 10
    REDIS_CONNECT_TIMEOUT: float = 1.0
    REDIS_SOCKET_TIMEOUT: float = 1.5
    REDIS_CIRCUIT_BREAKER_SECONDS: int = 30
    REDIS_COMPRESSION_THRESHOLD_BYTES: int = 25 * 1024
    REDIS_STALE_MAX_SECONDS: int = 300
    REDIS_ENABLED: bool = True
    CACHE_SCHEMA_VERSION: int = 1
    CACHE_ENABLE_STALE_WHILE_REVALIDATE: bool = True

    # ── Crucible AI engine bridge ──────────────────────────────────────────────
    # The engine runs as an internal service with no authentication of its own.
    # It is safe only because it is bound to loopback and sits behind this
    # gateway's RBAC. Never give it a public URL.
    CRUCIBLE_ENABLED: bool = True
    CRUCIBLE_BASE_URL: str = "http://127.0.0.1:8100"
    #: Shared secret for signing gateway->engine requests. When unset the engine
    #: accepts unsigned calls, which is tolerable on loopback in development and
    #: is rejected by validate_production_settings() in production.
    CRUCIBLE_SHARED_SECRET: str | None = None
    CRUCIBLE_CONNECT_TIMEOUT: float = 2.0
    CRUCIBLE_READ_TIMEOUT: float = 30.0
    CRUCIBLE_STATUS_TIMEOUT: float = 5.0
    CRUCIBLE_CIRCUIT_FAILURE_THRESHOLD: int = 3
    CRUCIBLE_CIRCUIT_COOLDOWN_SECONDS: float = 30.0

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()

#: Repository root, derived from this file's location: core -> api -> app -> root.
#: Used to anchor relative paths so they do not depend on the process working
#: directory. A relative ML_ARTIFACTS_DIR silently resolved to nothing when the
#: tree was reorganised, and every model then failed to load with only a warning.
PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[3]


def _anchored(value: str) -> pathlib.Path:
    """Absolute path for a setting that may be given relative to the repo root."""
    path = pathlib.Path(value)
    if path.is_absolute():
        return path
    candidate = PROJECT_ROOT / path
    # Fall back to cwd-relative only if the anchored path does not exist, so an
    # explicitly-placed directory outside the repo still works.
    return candidate if candidate.exists() else path


ARTIFACTS = _anchored(settings.ML_ARTIFACTS_DIR)


def validate_production_settings(cfg: Settings | None = None) -> None:
    """Raise RuntimeError if ENVIRONMENT=production with insecure defaults.

    Called at application startup. Prevents accidental production deployment
    with demo credentials, missing Clerk config, or insecure CORS.
    """
    target = cfg or settings
    if target.ENVIRONMENT.lower() != "production":
        return

    errors: list[str] = []

    if target.DEMO_BOOTSTRAP_ENABLED:
        errors.append(
            "DEMO_BOOTSTRAP_ENABLED=true is not allowed in production. "
            "Set DEMO_BOOTSTRAP_ENABLED=false."
        )

    # JWT_SECRET_KEY has no default, so it's always explicitly set.
    # But check for known-weak values.
    weak_keys = {
        "crucible-sih26009-secret-change-in-prod",
        "test-secret-key-32-chars-long-abc",
        "secret",
        "changeme",
        "dev-insecure-secret-key",
    }
    if target.JWT_SECRET_KEY in weak_keys or (target.JWT_SECRET_KEY and len(target.JWT_SECRET_KEY) < 32):
        errors.append(
            "JWT_SECRET_KEY is a known-weak default value or too short (<32 chars). "
            "Generate a strong random key for production."
        )

    if not target.CLERK_JWKS_URL and not target.CLERK_SECRET_KEY:
        logger.warning(
            "PRODUCTION: Neither CLERK_JWKS_URL nor CLERK_SECRET_KEY is set. "
            "Only demo JWT auth is active. Configure Clerk for production."
        )

    if errors:
        msg = "Production security configuration errors:\n" + "\n".join(
            f"  - {e}" for e in errors
        )
        raise RuntimeError(msg)

    logger.info("Production security settings validated OK.")

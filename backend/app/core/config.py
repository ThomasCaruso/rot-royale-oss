"""Application settings, loaded from environment / backend/.env via pydantic-settings."""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Capacitor native-app WebView origins. Fixed scheme://host values — not configurable, not secret,
# identical across every deploy — so they are ALWAYS allowed. A native build then works without a
# per-deploy CORS_ORIGINS edit and can't silently break from a forgotten env var. Specific origins
# only, never a wildcard. iOS (Capacitor 6) serves from capacitor://localhost; Android's default is
# http://localhost (add when the Android wrapper ships).
_config_log = logging.getLogger(__name__)

NATIVE_APP_ORIGINS: tuple[str, ...] = ("capacitor://localhost",)

# libpq sslmode values that DEMAND encryption. `prefer`/`allow`/`disable` express no requirement, so
# dropping those silently loses nothing.
_TLS_DEMANDING_SSLMODES = frozenset({"require", "verify-ca", "verify-full"})


def _is_internal_db_host(host: str) -> bool:
    """True for hosts reached over a private network, where plaintext is the documented posture.

    Render's internal Postgres hostnames have no dots (e.g. `dpg-abc123-a`); anything routable on
    the public internet does. Loopback and private ranges count as internal too.
    """
    h = (host or "").strip().lower()
    if not h or h in ("localhost", "127.0.0.1", "::1", "db", "postgres"):
        return True
    if "." not in h:  # single-label host => private network name (Render internal, docker service)
        return True
    return h.endswith(".internal") or h.endswith(".local")


# The committed development JWT key. It is in public source, so it is not a secret in any
# environment — production must never run on it, and a dev run should say so out loud.
DEV_SECRET_KEY = "dev-insecure-secret-change-me-in-production-0000"

# The local default for challenge_base_url. Named so the fallback below can tell "nobody set this"
# from "somebody deliberately set it to localhost".
CHALLENGE_BASE_URL_DEFAULT = "http://localhost:8001"

# The committed synthetic corpus. Development and tests read this unless ROT_CONTENT_DIR overrides
# it; production may never resolve to it.
SAMPLE_CONTENT_DIR = Path(__file__).resolve().parents[2] / "content" / "sample"
# HS256 derives its strength from key length; below this a captured token is brute-forcible offline.
MIN_SECRET_KEY_LENGTH = 32
# Environments treated as production for the purposes of the guard.
PRODUCTION_ENVS = frozenset({"production", "prod", "staging"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # A field with a validation_alias is otherwise ONLY populatable by that alias, which would
        # break direct construction like Settings(content_dir=...) in tests and helpers. Env lookup
        # still goes through the alias (ROT_CONTENT_DIR).
        populate_by_name=True,
    )

    # asyncpg driver URL, e.g. postgresql+asyncpg://user:pass@host:5432/db
    database_url: str = Field(
        default="postgresql+asyncpg://rot_royale:rot_royale@localhost:5432/rot_royale"
    )

    # Dedicated database for the test suite — kept separate from `database_url` so the running
    # settlement daemon (which writes to the live DB) can't contend with or pollute test runs.
    test_database_url: str = Field(
        default="postgresql+asyncpg://rot_royale:rot_royale@localhost:5432/rot_royale_test"
    )

    # Comma-separated list of allowed CORS origins.
    cors_origins: str = Field(default="http://localhost:5173")

    # ── Content root — the ONE public/private boundary for challenge data ──
    # Everything the game serves as a puzzle (trivia bank, Fermi items, change-detection manifest)
    # is read from below this directory. It is a single root rather than one variable per corpus so
    # the boundary cannot drift: adding a content class does not add configuration.
    #
    # Unset outside production resolves to the committed SYNTHETIC sample corpus, so a fresh clone
    # runs with no configuration at all. Unset IN production is a hard failure — see the validator
    # below. There is deliberately no fallback from production to the sample bank: silently serving
    # placeholder questions in a ranked contest would be worse than refusing to boot.
    # validation_alias is NOT optional here: pydantic-settings would otherwise map this field to
    # CONTENT_DIR, while render.yaml, the docs and every runbook say ROT_CONTENT_DIR. The variable
    # would be silently ignored, content_dir would stay empty, and the production guard below would
    # refuse to boot every service. Caught by pointing a local production-mode run at the real
    # content package — it loaded the samples instead.
    content_dir: str = Field(default="", validation_alias="ROT_CONTENT_DIR")

    # The application revision, for release identity in the startup log. Render sets
    # RENDER_GIT_COMMIT on every service; empty elsewhere, which reports as "unknown" rather than
    # guessing (a local checkout's HEAD is not what a deploy is running).
    app_revision: str = Field(default="", validation_alias="RENDER_GIT_COMMIT")

    # Comma-separated admin USER ID allowlist (content-ops / verdict endpoints), layered on normal
    # JWT auth via api/deps.get_admin_user. Empty (the default) means there are no admins at all,
    # which fails closed.
    #
    # Deliberately ids, not emails. This product has no email-verification flow and registration is
    # open, so an email is an unverified claim: an allowlisted address nobody had registered yet was
    # a free admin account for whoever claimed it first. A user id is server-generated at signup and
    # cannot be chosen, so there is nothing to claim.
    admin_user_ids: str = Field(default="")

    # ── Third-party sign-in audiences (Sign in with Apple / Google).
    #
    # These are CLIENT IDS, not secrets. Verifying an ID token needs the provider's public keys and
    # the audience we expect — no provider credential is involved, which is why this feature adds no
    # secret to leak. They are still configured per-environment because they differ per platform:
    # Google issues a separate client id for iOS, Android and Web, and Apple's audience is the
    # bundle id natively but the Service ID on the web. All of them are valid audiences for the same
    # account, so each is a comma-separated list.
    #
    # EMPTY MEANS DISABLED, and that is load-bearing: app/core/socialid.py refuses to verify against
    # an empty audience list rather than accepting a token minted for anybody. A half-configured
    # deployment rejects sign-ins instead of accepting every one.
    google_client_ids: str = Field(default="")
    apple_client_ids: str = Field(default="")

    # The FIRST provider secret in this codebase, and the only one. Sign in with Google's
    # authorization-code flow exchanges the code for tokens server-side, and that exchange is
    # authenticated with this. Verification still needs no secret (app/core/socialid.py uses public
    # keys); this buys the code exchange, nothing else.
    #
    # EMPTY MEANS GOOGLE IS OFF, like the audience lists above: without it `/auth/google/start`
    # cannot complete, so the button is not offered at all rather than being offered and dying at
    # the last step. It must never be logged, echoed in an error, or served from any endpoint.
    google_client_secret: str = Field(default="")
    # Where Google sends the browser back. Google matches this against the registered Authorized
    # redirect URI EXACTLY — scheme, host, port and path — and a mismatch fails with a generic error
    # that says nothing useful. Left empty it is derived from `challenge_base_url`, which is already
    # defined as the externally reachable API origin; set it explicitly when the API moves to a
    # custom domain, and change it in the Google console in the same breath.
    google_redirect_uri: str = Field(default="")

    # ── Viral share loop hosts (host-agnostic: works local/staging/prod without code changes).
    # web_base_url = the SPA origin a shared challenge redirects a human into (`/?c=<id>`).
    # challenge_base_url = where the public share pages live (`/c/<id>` + `/c/<id>/og.png`) — the
    # value embedded in OG tags, so it MUST be the externally reachable API origin in prod. NOTE:
    # web_base_url's origin must also be in CORS_ORIGINS in prod (this doesn't relax CORS).
    web_base_url: str = Field(default="http://localhost:5173")

    # Where a NATIVE Google sign-in is returned to. The app registers this custom URL scheme in its
    # Info.plist; the callback redirects to "<scheme>://auth#handoff=..." and the app picks it up
    # through Capacitor's appUrlOpen listener.
    #
    # It is CONFIGURATION, never a request parameter, and that is the whole security of the native
    # flow. The handoff code in that fragment is a one-time credential for a real session, so a
    # client-supplied return target would be an open redirect that hands sessions to whoever asks.
    # The request may only choose between named platforms; the URLs live here.
    #
    # Defaults to the iOS bundle id, which is what capacitor.config.ts registers and what Apple
    # guarantees is unique to this app.
    native_auth_scheme: str = Field(default="live.rotroyale.app")
    challenge_base_url: str = Field(default=CHALLENGE_BASE_URL_DEFAULT)

    # Render sets this to the service's own external URL on every web service. It is the fallback
    # for challenge_base_url, which is LOAD-BEARING for change-detection imagery: `_asset_url`
    # builds the absolute URLs a client fetches from it, so a wrong value gives a round whose images
    # resolve nowhere — a blank frame, an unfindable change, and a guaranteed miss, with nothing in
    # any log to notice (§7c). Deriving it removes the one value that could only be guessed before
    # the service existed, and every new environment gets correct asset URLs with no configuration.
    render_external_url: str = Field(default="", validation_alias="RENDER_EXTERNAL_URL")

    app_env: str = Field(default="local")

    # How many TRUSTED reverse proxies sit in front of the app (Render's edge = 1). The real client
    # IP is the value the outermost trusted proxy appended to X-Forwarded-For, i.e. the Nth entry
    # from the RIGHT — everything to its left is client-supplied and spoofable. `client_ip()` reads
    # exactly that hop. Set to 0 only when the app is exposed with no proxy (then the socket peer is
    # used and XFF is ignored entirely). Never raise this above the real proxy depth: each extra hop
    # you trust is one more spoofable position. (Fixes the guest-cap XFF bypass.)
    trusted_proxy_count: int = Field(default=1)

    # JWT signing. Override in every non-local environment. Dev default is ≥32 bytes (HS256 min).
    # PRODUCTION REFUSES TO BOOT ON THIS VALUE — see the validator at the bottom of the class.
    secret_key: str = Field(default=DEV_SECRET_KEY)
    jwt_algorithm: str = Field(default="HS256")
    access_token_ttl_minutes: int = Field(default=30)
    refresh_token_ttl_days: int = Field(default=30)

    # Background scheduler daemon (window creation + state transitions).
    scheduler_enabled: bool = Field(default=True)
    scheduler_tick_seconds: int = Field(default=60)  # how often the transitioner runs

    # Web Push / VAPID (M9). Push is enabled only when both keys are set (see push_enabled).
    # Generate with the command in .env.example; never commit real keys. Public key is the browser
    # applicationServerKey (base64url uncompressed point); private key is base64url raw (32 bytes).
    vapid_public_key: str = Field(default="")
    vapid_private_key: str = Field(default="")
    vapid_subject: str = Field(default="mailto:admin@rotroyale.example")

    # iOS native push (APNs, token-based auth). Enabled only when all four are set (apns_enabled).
    # apns_key_p8 is the FULL contents of the AuthKey_XXXX.p8 (PEM, "-----BEGIN PRIVATE KEY-----…").
    # apns_key_id/apns_team_id come from the Apple Developer portal; apns_topic is the Bundle ID.
    # apns_use_sandbox routes to Apple's sandbox host (development builds) vs production.
    apns_key_p8: str = Field(default="")
    apns_key_id: str = Field(default="")
    apns_team_id: str = Field(default="")
    apns_topic: str = Field(default="")  # the iOS app Bundle ID, e.g. com.rotroyale.app
    apns_use_sandbox: bool = Field(default=False)

    # Android native push (FCM HTTP v1). Enabled only when all three are set (fcm_enabled).
    # All three come from ONE Firebase service-account JSON (Project settings → Service accounts →
    # Generate new private key): `project_id`, `client_email`, `private_key`.
    # fcm_private_key is the FULL PEM ("-----BEGIN PRIVATE KEY-----…"). When pasting it into an env
    # var the newlines usually arrive as the two characters \n — the validator below restores them,
    # because a PEM with literal backslash-n fails to parse and the failure looks like a bad key.
    fcm_project_id: str = Field(default="")
    fcm_client_email: str = Field(default="")
    fcm_private_key: str = Field(default="")

    # Hour (0–23) in the PLAYER'S OWN zone that each evening nudge fires (profiles.timezone; ET
    # when unknown). Both are floors, not exact times — the heartbeat sends at or after the hour and
    # the once-per-day gate stops a repeat, so a missed cron tick still delivers rather than
    # skipping the day. Quiet hours (21:00 local) close the window, giving each a ~1–2h band.
    #
    # 14:00 for the reminder — early afternoon, the player's own. It sits a long way clear of the
    # 20:00 streak nudge, so the two can never read as one burst, and it leaves the whole evening
    # to act on. `jobs.run play-times` reports when players ACTUALLY finish runs in their own local
    # hours, so this stays tunable from evidence.
    push_reminder_hour_local: int = Field(default=14)
    # 20:00 for the streak-risk nudge — the hour asked for, and the last comfortable moment to act.
    push_streak_risk_hour_local: int = Field(default=20)
    # Streaks worth defending. Below this a "don't lose your streak" push is melodrama.
    push_streak_risk_min_streak: int = Field(default=3)

    # Percentage of players (0-100) whose device registers a QUIET provisional push token. The
    # evidence for provisional is thin — one growth team measured no difference in opt-in or
    # retention — so it ships OFF and rolls out by percentage, which is what a phased test needs.
    # Membership is a stable hash of the user id, so a player never flips cohort between calls.
    push_provisional_rollout_pct: int = Field(default=0, ge=0, le=100)

    # ── AI question classification (LLM, batch/CLI only — NEVER called during gameplay) ──
    # Put your real key in backend/.env as ROT_AI_API_KEY=… (never commit it). Classification is
    # gated on ai_classification_ready: with the flag off or any credential missing, the app runs
    # normally and the classify job fails fast with a clear message.
    rot_ai_enabled: bool = Field(default=False)
    rot_ai_provider: str = Field(default="openai_compatible")
    rot_ai_api_key: str = Field(default="")
    rot_ai_base_url: str = Field(default="")  # e.g. https://api.openai.com/v1
    rot_ai_model: str = Field(default="")
    rot_ai_classification_temperature: float = Field(default=0.0)
    rot_ai_classification_timeout_ms: int = Field(default=30000)
    rot_ai_batch_size: int = Field(default=25)
    rot_ai_max_retries: int = Field(default=2)

    # ── Silent personalization (taste profiles + question ranking) ──
    # personalize_ranked_daily stays False so the ranked Daily Royale field is scored on the same
    # mixed bank for everyone (leaderboard fairness — DESIGN §7 spirit). Personalization applies to
    # no-stakes modes (practice/quick/category) only by default.
    personalization_enabled: bool = Field(default=True)
    personalize_ranked_daily: bool = Field(default=False)
    personalization_debug: bool = Field(default=False)
    growth_tracking_enabled: bool = Field(default=True)
    adaptive_learning_enabled: bool = Field(default=True)  # Phase 1: per-user skill model (silent)

    @field_validator("apns_key_p8", "fcm_private_key")
    @classmethod
    def _restore_pem_newlines(cls, v: str) -> str:
        r"""Turn literal `\n` back into real newlines in a PEM pasted into an env var.

        Render's dashboard (and most CI secret UIs) store a single-line value, so the newlines in a
        service-account key arrive as the two characters backslash-n. A PEM in that shape fails to
        parse, and the resulting error points at the key being wrong rather than at its formatting —
        an afternoon lost for a whitespace problem. Idempotent: a PEM with real newlines is
        untouched.
        """
        return v.replace("\\n", "\n") if "\\n" in v else v

    @field_validator("database_url", "test_database_url")
    @classmethod
    def _normalize_pg_url(cls, v: str) -> str:
        """Make a raw Render Postgres URL usable by the asyncpg driver with no manual editing.

        Render's managed Postgres exposes a libpq-style connection string (``postgres://`` or
        ``postgresql://``, occasionally with ``?sslmode=…``). The app and Alembic both use the
        asyncpg driver, which needs the ``postgresql+asyncpg://`` scheme and does NOT understand
        libpq's ``sslmode`` query param (it would raise on the unknown keyword). So: upgrade the
        scheme and drop libpq-only params. Internal (same-region) Render connections don't require
        TLS, which is the connection these services use; if you ever need TLS, pass it via
        SQLAlchemy ``connect_args={"ssl": …}`` rather than on the URL.
        """
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://") :]
        if v.startswith("postgresql://"):
            v = "postgresql+asyncpg://" + v[len("postgresql://") :]
        parts = urlsplit(v)
        if parts.query:
            params = parse_qsl(parts.query, keep_blank_values=True)
            kept = [(k, val) for k, val in params if k not in ("sslmode", "channel_binding")]

            # Dropping the param is right for Render's internal same-region connection (no TLS
            # needed, and asyncpg raises on the keyword). It is NOT right, and must not be silent,
            # when an EXTERNAL host explicitly demanded TLS: the requirement would be discarded and
            # the connection would run in plaintext over the public internet, still working, just
            # unsafely. Same failure shape as the JWT-secret default — so it says so.
            demanded = {val for k, val in params if k == "sslmode"} & _TLS_DEMANDING_SSLMODES
            host = parts.hostname or ""
            if demanded and not _is_internal_db_host(host):
                # Host only — NEVER the userinfo, which carries the password.
                _config_log.warning(
                    "DATABASE_URL for external host %r requested sslmode=%s, but that parameter is "
                    "dropped for the asyncpg driver and TLS is NOT otherwise configured — this "
                    "connection would run WITHOUT TLS. Pass TLS via SQLAlchemy "
                    'connect_args={"ssl": ...} instead of on the URL.',
                    host,
                    ",".join(sorted(demanded)),
                )
            v = urlunsplit(parts._replace(query=urlencode(kept)))
        return v

    @field_validator("secret_key")
    @classmethod
    def _reject_insecure_secret_in_production(cls, v: str, info: ValidationInfo) -> str:
        """Fail fast rather than boot a production service that anyone can forge tokens for.

        Checked here, not at startup, so EVERY entry point is covered — the API, the cron jobs and
        any one-off `jobs.run` command all construct Settings. A startup-only check would leave the
        jobs running on a forgeable key.

        `app_env` is read from the raw input rather than the model because pydantic validates fields
        in declaration order and app_env is declared after secret_key; info.data would be empty.
        """
        import os

        env = (
            str((info.data or {}).get("app_env") or os.environ.get("APP_ENV") or "local")
            .strip()
            .lower()
        )
        if env not in PRODUCTION_ENVS:
            return v
        if v == DEV_SECRET_KEY or not v.strip():
            raise ValueError(
                f"SECRET_KEY is unset or still the committed development default while APP_ENV="
                f"{env!r}. That value is public in the source tree, so anyone could mint a valid "
                f"token for any account. Set a random secret of >= {MIN_SECRET_KEY_LENGTH} chars."
            )
        if len(v) < MIN_SECRET_KEY_LENGTH:
            raise ValueError(
                f"SECRET_KEY is {len(v)} chars while APP_ENV={env!r}; HS256 needs at least "
                f"{MIN_SECRET_KEY_LENGTH} or a captured token can be cracked offline."
            )
        return v

    @property
    def content_root(self) -> Path:
        """Directory holding the challenge corpora. Never falls back to production content.

        Resolved to an ABSOLUTE path here, once. On Render the value is root-relative (`.content`,
        relative to the service's rootDir) because the deployed path is Render's to choose, not
        ours to hard-code — but a relative content root that is re-resolved later means any
        `os.chdir`, any worker started from a different directory, and any test that changes cwd can
        silently point the server at a directory that does not exist. Resolving at the configuration
        boundary makes the value independent of whatever the process does afterwards.
        """
        if self.content_dir.strip():
            return Path(self.content_dir.strip()).expanduser().resolve()
        return SAMPLE_CONTENT_DIR

    @model_validator(mode="after")
    def _derive_challenge_base_url_from_the_platform(self) -> Settings:
        """Fall back to the platform's own URL when nothing set an explicit one.

        Only when challenge_base_url is still the local default, so an explicit value — including a
        deliberate localhost during development — always wins.
        """
        if (
            self.challenge_base_url == CHALLENGE_BASE_URL_DEFAULT
            and self.render_external_url.strip()
        ):
            self.challenge_base_url = self.render_external_url.strip().rstrip("/")
        return self

    @model_validator(mode="after")
    def _require_explicit_content_root_in_production(self) -> Settings:
        """Production must name its private content root; it may never inherit the sample corpus.

        Enforced on the model (not the field) because it depends on app_env, and at construction
        rather than at startup so every entry point is covered — API, cron, and each `jobs.run`
        command. The message names the variable and the environment, never a filesystem path or a
        secret: enough to diagnose, nothing more.
        """
        if self.app_env.strip().lower() not in PRODUCTION_ENVS:
            return self
        if not self.content_dir.strip():
            raise ValueError(
                f"ROT_CONTENT_DIR is not set while APP_ENV={self.app_env!r}. Production must point "
                f"at its private content root explicitly; refusing to fall back to the synthetic "
                f"sample corpus, which would serve placeholder questions in a ranked contest."
            )
        root = Path(self.content_dir.strip()).expanduser()
        if not root.is_dir():
            raise ValueError(
                f"ROT_CONTENT_DIR does not exist or is not a directory while "
                f"APP_ENV={self.app_env!r}. The private content root must be mounted before boot."
            )
        return self

    @property
    def secret_key_is_insecure(self) -> bool:
        """True when running on a key that must never reach production. Drives the startup warning
        so a dev-secret deployment does not look identical to a real one in the logs."""
        return self.secret_key == DEV_SECRET_KEY or len(self.secret_key) < MIN_SECRET_KEY_LENGTH

    @property
    def google_client_id_list(self) -> list[str]:
        return [c.strip() for c in self.google_client_ids.split(",") if c.strip()]

    @property
    def apple_client_id_list(self) -> list[str]:
        return [c.strip() for c in self.apple_client_ids.split(",") if c.strip()]

    @property
    def google_oauth_redirect_uri(self) -> str:
        """Where Google returns the browser. Explicit setting wins; otherwise derived from the API
        origin. Whatever this resolves to must be registered verbatim in the Google console."""
        if self.google_redirect_uri.strip():
            return self.google_redirect_uri.strip()
        return f"{self.challenge_base_url.rstrip('/')}/auth/google/callback"

    @property
    def google_oauth_configured(self) -> bool:
        """Google needs BOTH halves now: an audience to verify the ID token against, and the secret
        that buys the code exchange. Either one alone is a button that fails at the last step."""
        return bool(self.google_client_id_list) and bool(self.google_client_secret.strip())

    @property
    def social_sign_in_providers(self) -> list[str]:
        """Which provider buttons the client should show. Derived, never configured separately —
        a button for a provider the server cannot verify is a guaranteed dead end."""
        out = []
        if self.apple_client_id_list:
            out.append("apple")
        # Not `google_client_id_list`: since the code flow landed, an audience without a client
        # secret can verify a token it can never obtain. Offering the button then would put the
        # failure at the very end of the flow, after the player has already chosen an account.
        if self.google_oauth_configured:
            out.append("google")
        return out

    @property
    def cors_origins_list(self) -> list[str]:
        # Env-driven web origins (from CORS_ORIGINS) first, then the always-allowed native-app
        # origins, deduped with order preserved. Works the same in production, where the dev
        # localhost regex is disabled and only this explicit list is honored.
        explicit = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        return list(dict.fromkeys([*explicit, *NATIVE_APP_ORIGINS]))

    @property
    def push_enabled(self) -> bool:
        return bool(self.vapid_public_key and self.vapid_private_key)

    @property
    def apns_enabled(self) -> bool:
        return bool(self.apns_key_p8 and self.apns_key_id and self.apns_team_id and self.apns_topic)

    @property
    def fcm_enabled(self) -> bool:
        return bool(self.fcm_project_id and self.fcm_client_email and self.fcm_private_key)

    @property
    def ai_classification_ready(self) -> bool:
        """Classifier may run only when explicitly enabled AND fully configured."""
        return bool(
            self.rot_ai_enabled
            and self.rot_ai_api_key
            and self.rot_ai_base_url
            and self.rot_ai_model
        )


settings = Settings()

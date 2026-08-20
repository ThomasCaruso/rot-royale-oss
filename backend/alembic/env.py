import asyncio
from logging.config import fileConfig

# Import models so their tables register on Base.metadata for autogenerate.
# (No models in M0; add imports here as they land per milestone.)
import app.models  # noqa: F401
from alembic import context
from app.core.config import settings
from app.core.db import Base
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Use the URL the caller preset (e.g. the test harness pointing at rot_royale_test); otherwise fall
# back to the app's DATABASE_URL so the CLI (`alembic upgrade head`) targets the live DB.
if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option("sqlalchemy.url", settings.database_url)

# Interpret the config file for Python logging.
# disable_existing_loggers=False is NOT cosmetic: fileConfig defaults to True, which DISABLES every
# logger that already exists — including the application's own (`app.core.*`). Any process that runs
# migrations in-process therefore loses the app's warnings silently, which is how a deliberately
# "loud" guard (an insecure SECRET_KEY, a discarded TLS requirement) ends up saying nothing at all.
# Alembic's own loggers are still configured from the file; the app's are simply left alone.
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Model metadata for 'autogenerate' support.
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

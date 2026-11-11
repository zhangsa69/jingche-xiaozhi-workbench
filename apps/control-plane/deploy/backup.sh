#!/usr/bin/env bash
# Consistent SQLite backup for the control plane.
#
#   install -m 0750 backup.sh /usr/local/bin/control-plane-backup
#   0 3 * * * /usr/local/bin/control-plane-backup >> /var/log/control-plane-backup.log 2>&1
#
# Uses the SQLite online backup API via the CLI so a running service produces a
# consistent snapshot. Verify restores quarterly.
set -euo pipefail

DB_PATH="${CONTROL_PLANE_DB_PATH:-/var/lib/control-plane/control-plane.db}"
BACKUP_DIR="${CONTROL_PLANE_BACKUP_DIR:-/var/backups/control-plane}"
RETENTION_DAYS="${CONTROL_PLANE_BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/control-plane-${STAMP}.db"

if [[ ! -f "${DB_PATH}" ]]; then
  echo "database not found: ${DB_PATH}" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

# `.backup` is safe against concurrent writers and produces a single file.
sqlite3 "${DB_PATH}" ".backup '${TARGET}'"
chmod 0600 "${TARGET}"

# Sanity check: the snapshot must open and report a schema version.
SCHEMA_VERSION="$(sqlite3 "${TARGET}" 'PRAGMA user_version;')"
if [[ -z "${SCHEMA_VERSION}" || "${SCHEMA_VERSION}" -lt 1 ]]; then
  echo "backup verification failed: ${TARGET}" >&2
  exit 1
fi

find "${BACKUP_DIR}" -name 'control-plane-*.db' -type f -mtime "+${RETENTION_DAYS}" -delete

echo "backup ok schema=v${SCHEMA_VERSION} size=$(stat -c%s "${TARGET}") file=${TARGET}"

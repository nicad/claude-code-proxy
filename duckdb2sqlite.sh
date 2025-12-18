#!/bin/bash

set -e

if [ $# -ne 2 ]; then
    echo "Usage: $0 <duckdb_file> <sqlite_file>"
    exit 1
fi

DUCKDB_FILE="$1"
SQLITE_FILE="$2"

rm -f "$SQLITE_FILE"

duckdb "$DUCKDB_FILE" <<EOF
ATTACH '$SQLITE_FILE' AS sqlite (TYPE SQLITE);
CREATE TABLE sqlite.requests AS SELECT * FROM requests;
EOF

echo "Done: $SQLITE_FILE"

package driver

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"
)

// HardRowCap bounds any single result set, including when the user has turned
// pagination off. Without it, "no LIMIT" on a large table would try to
// materialise the whole thing in memory and take the app down.
const HardRowCap = 100_000

// maxSafeInteger is JavaScript's Number.MAX_SAFE_INTEGER. Integers beyond it
// cannot survive a JSON round-trip into the webview intact, so they are sent
// as strings instead — silently corrupting a bigint primary key would be a
// serious bug in a tool people use to look up records by id.
const maxSafeInteger = int64(1)<<53 - 1

// binaryPreviewBytes caps how much of a blob is hex-encoded for display.
const binaryPreviewBytes = 32

// RunQuery executes a query and normalises the result into a JSON-safe
// ResultSet. rowCap of 0 uses HardRowCap.
func RunQuery(ctx context.Context, db *sql.DB, query string, rowCap int) (*ResultSet, error) {
	if rowCap <= 0 || rowCap > HardRowCap {
		rowCap = HardRowCap
	}
	start := time.Now()

	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	colTypes, err := rows.ColumnTypes()
	if err != nil {
		return nil, err
	}
	cols := make([]ResultColumn, len(colTypes))
	for i, ct := range colTypes {
		cols[i] = ResultColumn{Name: ct.Name(), DBType: ct.DatabaseTypeName()}
	}

	out := &ResultSet{
		Columns: cols,
		Rows:    [][]any{},
		Query:   query,
	}

	vals := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}

	for rows.Next() {
		if len(out.Rows) >= rowCap {
			out.Truncated = true
			break
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make([]any, len(cols))
		for i, v := range vals {
			row[i] = normalise(v, cols[i].DBType)
		}
		out.Rows = append(out.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out.ElapsedMS = time.Since(start).Milliseconds()
	return out, nil
}

// Exec runs a statement that returns no rows and reports the affected count.
func Exec(ctx context.Context, db *sql.DB, query string) (*ResultSet, error) {
	start := time.Now()
	res, err := db.ExecContext(ctx, query)
	if err != nil {
		return nil, err
	}
	out := &ResultSet{
		Columns:   []ResultColumn{},
		Rows:      [][]any{},
		Query:     query,
		ElapsedMS: time.Since(start).Milliseconds(),
	}
	// Not every driver supports RowsAffected; absence is not an error.
	if n, err := res.RowsAffected(); err == nil {
		out.RowsAffected = &n
	}
	return out, nil
}

// normalise converts a driver value into something that survives JSON and
// renders sensibly in a grid. The set of possible outputs is deliberately
// small: nil, string, float64, int64-within-safe-range, bool.
func normalise(v any, dbType string) any {
	switch t := v.(type) {
	case nil:
		return nil
	case bool:
		return t
	case string:
		return t
	case time.Time:
		// RFC3339 with nanoseconds sorts lexically and round-trips. Dates
		// without a time component still render usefully.
		return t.Format(time.RFC3339Nano)
	case int64:
		if t > maxSafeInteger || t < -maxSafeInteger {
			return fmt.Sprintf("%d", t)
		}
		return t
	case int32:
		return int64(t)
	case int:
		return int64(t)
	case float64:
		// NaN and ±Inf are not representable in JSON; marshalling them errors
		// out and would fail the whole page.
		if math.IsNaN(t) || math.IsInf(t, 0) {
			return fmt.Sprintf("%v", t)
		}
		return t
	case float32:
		return normalise(float64(t), dbType)
	case []byte:
		return normaliseBytes(t, dbType)
	default:
		return fmt.Sprintf("%v", t)
	}
}

// normaliseBytes decides whether a []byte is text or binary. Most drivers
// hand back []byte for text, numeric and decimal columns alike; decimals in
// particular must stay strings so precision is not lost to float64.
func normaliseBytes(b []byte, dbType string) any {
	if isBinaryType(dbType) || !utf8.Valid(b) || containsNUL(b) {
		n := len(b)
		preview := b
		if n > binaryPreviewBytes {
			preview = b[:binaryPreviewBytes]
		}
		s := "0x" + hex.EncodeToString(preview)
		if n > binaryPreviewBytes {
			s += "…"
		}
		return fmt.Sprintf("%s (%d bytes)", s, n)
	}
	return string(b)
}

func containsNUL(b []byte) bool {
	for _, c := range b {
		if c == 0 {
			return true
		}
	}
	return false
}

// isBinaryType catches types that are valid UTF-8 by luck but are not text.
func isBinaryType(dbType string) bool {
	switch strings.ToUpper(dbType) {
	case "BLOB", "BYTEA", "BINARY", "VARBINARY", "IMAGE", "TINYBLOB",
		"MEDIUMBLOB", "LONGBLOB", "GEOMETRY", "ROWVERSION", "TIMESTAMP_BYTES":
		return true
	}
	return false
}

// scanStrings is a small helper for the introspection queries, which all
// return a handful of text columns.
func scanStrings(rows *sql.Rows, n int) ([][]string, error) {
	defer rows.Close()
	var out [][]string
	for rows.Next() {
		cells := make([]sql.NullString, n)
		ptrs := make([]any, n)
		for i := range cells {
			ptrs[i] = &cells[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make([]string, n)
		for i, c := range cells {
			row[i] = c.String
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

package driver

import (
	"strconv"
	"strings"
)

// isLongTextType decides whether a column is worth capping in SQL, given the
// cap that is in force.
//
// The question is not "is this text" but "can this column hold more than cap
// characters". A varchar(64) cannot, so wrapping it in a substring only makes
// the query harder to read; a text, json or nvarchar(max) column can hold a
// megabyte, and those are the ones the cap exists for.
//
// dataType is whatever the dialect's own catalogue reported — mysql gives
// "longtext" and "varchar(255)", postgres "character varying(50)" and "jsonb",
// SQL Server the bare "nvarchar" with the length held in a separate column we
// do not read, and SQLite whatever was in the DDL. A type we do not recognise
// is left alone: over-capping would change a value's type on the way out
// (substr() on a number returns text), which is worse than a wide cell.
func isLongTextType(dataType string, capChars int) bool {
	if capChars <= 0 {
		return false
	}
	base, arg, hasArg := splitTypeArg(dataType)
	switch base {
	case "TEXT", "MEDIUMTEXT", "LONGTEXT", "NTEXT", "CLOB", "NCLOB",
		"JSON", "JSONB", "XML", "CITEXT":
		return true
	case "TINYTEXT":
		// Bounded at 255 by definition, so only worth capping below that.
		return 255 > capChars
	case "VARCHAR", "NVARCHAR", "VARCHAR2", "NVARCHAR2", "CHAR", "NCHAR",
		"CHARACTER", "CHARACTER VARYING", "CHAR VARYING", "STRING", "VARYING CHARACTER":
		switch {
		case !hasArg:
			// Unbounded: postgres "character varying", a SQLite column
			// declared VARCHAR, and SQL Server's length-less catalogue entry.
			return true
		case strings.EqualFold(arg, "MAX"):
			return true // SQL Server varchar(max) / nvarchar(max)
		}
		n, err := strconv.Atoi(strings.TrimSpace(arg))
		if err != nil {
			return true // an argument we cannot read is not a bound we can trust
		}
		return n > capChars
	}
	return false
}

// splitTypeArg splits "character varying(50)" into "CHARACTER VARYING" and
// "50". Collation, charset and unsigned suffixes are dropped along with
// anything else after the parenthesised argument.
func splitTypeArg(dataType string) (base, arg string, hasArg bool) {
	t := strings.ToUpper(strings.TrimSpace(dataType))
	open := strings.IndexByte(t, '(')
	if open < 0 {
		return normaliseSpaces(t), "", false
	}
	end := strings.IndexByte(t[open:], ')')
	if end < 0 {
		return normaliseSpaces(t[:open]), "", false
	}
	return normaliseSpaces(t[:open]), t[open+1 : open+end], true
}

// normaliseSpaces collapses the internal whitespace of a multi-word type name
// so "character   varying" and "character varying" compare equal.
func normaliseSpaces(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

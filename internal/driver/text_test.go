package driver

import "testing"

// The classifier decides which columns get a substring wrapped around them, so
// both directions matter: missing a text column leaves megabytes on the wire,
// and capping something that is not text changes the value's type on the way
// out.
func TestIsLongTextType(t *testing.T) {
	const capChars = 512

	long := []string{
		// mysql
		"text", "mediumtext", "longtext", "json", "varchar(4000)",
		// postgres
		"character varying", "character varying(2000)", "jsonb", "xml", "citext",
		// sql server — the catalogue reports the bare name, length elsewhere
		"nvarchar", "varchar(max)", "nvarchar(MAX)", "ntext",
		// sqlite DDL spellings
		"TEXT", "VARCHAR", "CLOB", "varying character(9000)",
	}
	for _, dt := range long {
		if !isLongTextType(dt, capChars) {
			t.Errorf("%q should be capped", dt)
		}
	}

	short := []string{
		"varchar(255)", "char(2)", "character varying(64)", "nvarchar(50)",
		"int", "bigint", "numeric(10,2)", "double", "boolean", "timestamp",
		"date", "blob", "bytea", "varbinary(max)", "uuid", "enum('a','b')",
		"tinytext", // bounded at 255, below the cap
		"",         // an unknown or expression column: leave it alone
	}
	for _, dt := range short {
		if isLongTextType(dt, capChars) {
			t.Errorf("%q should not be capped", dt)
		}
	}
}

// A cap larger than the column's own bound is no cap at all, and a cap of zero
// means the feature is off.
func TestIsLongTextTypeRespectsDeclaredBounds(t *testing.T) {
	if isLongTextType("varchar(100)", 512) {
		t.Error("varchar(100) cannot exceed a 512 cap")
	}
	if !isLongTextType("varchar(100)", 50) {
		t.Error("varchar(100) can exceed a 50 cap")
	}
	if !isLongTextType("tinytext", 100) {
		t.Error("tinytext holds 255 characters, which exceeds a 100 cap")
	}
	for _, dt := range []string{"text", "json", "longtext"} {
		if isLongTextType(dt, 0) {
			t.Errorf("cap of 0 must disable capping, %q was capped", dt)
		}
	}
}

func TestSplitTypeArg(t *testing.T) {
	cases := []struct {
		in     string
		base   string
		arg    string
		hasArg bool
	}{
		{"longtext", "LONGTEXT", "", false},
		{"varchar(255)", "VARCHAR", "255", true},
		{"character   varying(50)", "CHARACTER VARYING", "50", true},
		{"nvarchar(max)", "NVARCHAR", "MAX", true},
		{"numeric(10,2)", "NUMERIC", "10,2", true},
		{"  text  ", "TEXT", "", false},
	}
	for _, c := range cases {
		base, arg, hasArg := splitTypeArg(c.in)
		if base != c.base || arg != c.arg || hasArg != c.hasArg {
			t.Errorf("splitTypeArg(%q) = (%q, %q, %v), want (%q, %q, %v)",
				c.in, base, arg, hasArg, c.base, c.arg, c.hasArg)
		}
	}
}

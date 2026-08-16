package driver

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
)

// A bigint id that exceeds JavaScript's safe integer range must survive as a
// string. Letting it through as a JSON number would silently round it, and the
// user would be looking at a record id that does not exist.
func TestLargeIntegersBecomeStrings(t *testing.T) {
	const snowflake = int64(1780241234567890123)
	got := normalise(snowflake, "BIGINT")
	s, ok := got.(string)
	if !ok {
		t.Fatalf("got %T (%v), want string", got, got)
	}
	if s != "1780241234567890123" {
		t.Errorf("got %q, want exact digits", s)
	}

	// And confirm the reason: the numeric form really does not round-trip.
	var back float64
	if err := json.Unmarshal([]byte("1780241234567890123"), &back); err != nil {
		t.Fatal(err)
	}
	if int64(back) == snowflake {
		t.Skip("float64 round-tripped exactly; the guard is harmless here")
	}
}

func TestSmallIntegersStayNumeric(t *testing.T) {
	for _, v := range []int64{0, 1, -1, maxSafeInteger, -maxSafeInteger} {
		if _, ok := normalise(v, "INT").(int64); !ok {
			t.Errorf("%d was not kept numeric", v)
		}
	}
}

// NaN and ±Inf cannot be encoded as JSON. Left as float64 they fail the
// marshal and take the whole page down with them.
func TestNonFiniteFloatsAreStringified(t *testing.T) {
	for _, v := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		got := normalise(v, "DOUBLE")
		if _, ok := got.(string); !ok {
			t.Errorf("normalise(%v) = %T, want string", v, got)
		}
		if _, err := json.Marshal(got); err != nil {
			t.Errorf("normalise(%v) is not JSON-encodable: %v", v, err)
		}
	}
}

func TestNullStaysNull(t *testing.T) {
	if got := normalise(nil, "TEXT"); got != nil {
		t.Errorf("got %v, want nil", got)
	}
}

// Decimals arrive as []byte from most drivers. Turning them into float64 would
// lose precision on exactly the values people care most about.
func TestDecimalBytesStayText(t *testing.T) {
	got := normalise([]byte("12345.678901234567890"), "DECIMAL")
	if got != "12345.678901234567890" {
		t.Errorf("got %v, want the digits unchanged", got)
	}
}

func TestTimesAreISOFormatted(t *testing.T) {
	ts := time.Date(2026, 8, 16, 14, 30, 0, 0, time.UTC)
	got, ok := normalise(ts, "DATETIME").(string)
	if !ok || !strings.HasPrefix(got, "2026-08-16T14:30:00") {
		t.Errorf("got %v, want an ISO timestamp", got)
	}
}

func TestBinaryIsPreviewedNotShipped(t *testing.T) {
	blob := make([]byte, 4096)
	got, ok := normalise(blob, "BLOB").(string)
	if !ok {
		t.Fatalf("got %T, want string", got)
	}
	if !strings.Contains(got, "4096 bytes") {
		t.Errorf("byte count missing: %q", got)
	}
	if len(got) > 128 {
		t.Errorf("preview is not bounded, got %d chars", len(got))
	}
}

// Text columns that happen to be valid UTF-8 must not be hex-dumped, but a
// BLOB holding readable ASCII still should be — the type is the signal.
func TestBinaryTypeBeatsUTF8Validity(t *testing.T) {
	if got := normalise([]byte("hello"), "TEXT"); got != "hello" {
		t.Errorf("text was mangled: %v", got)
	}
	got, _ := normalise([]byte("hello"), "BLOB").(string)
	if !strings.HasPrefix(got, "0x") {
		t.Errorf("blob was not hex-encoded: %v", got)
	}
}

func TestInvalidUTF8IsTreatedAsBinary(t *testing.T) {
	got, ok := normalise([]byte{0xff, 0xfe, 0x00}, "TEXT").(string)
	if !ok || !strings.HasPrefix(got, "0x") {
		t.Errorf("got %v, want a hex preview", got)
	}
}

// Everything the grid receives must encode; a single bad cell would otherwise
// fail the entire response.
func TestNormalisedValuesAreAlwaysJSONEncodable(t *testing.T) {
	inputs := []any{
		nil, true, "text", int64(5), int32(5), int(5), float64(1.5), float32(1.5),
		math.NaN(), []byte("bytes"), []byte{0xff}, time.Now(),
		int64(1) << 62, struct{ X int }{1},
	}
	for _, in := range inputs {
		if _, err := json.Marshal(normalise(in, "")); err != nil {
			t.Errorf("normalise(%T) is not encodable: %v", in, err)
		}
	}
}

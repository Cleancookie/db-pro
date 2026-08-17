package driver

import (
	"encoding/json"
	"testing"
)

// TestObjectDetailAlwaysPresentFields pins the JSON contract the frontend
// relies on.
//
// frontend/src/types.ts declares these fields as always present and indexes
// into them without guarding. A slice tagged omitempty marshals to nothing when
// it is empty, so the field vanishes and the page throws on .length — which is
// exactly what happened when Checks carried omitempty.
func TestObjectDetailAlwaysPresentFields(t *testing.T) {
	// A zero value is the worst case: every slice nil, every pointer unset.
	b, err := json.Marshal(&ObjectDetail{})
	if err != nil {
		t.Fatal(err)
	}

	var got map[string]json.RawMessage
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}

	for _, field := range []string{
		"columns", "primaryKey", "indexes", "foreignKeys", "triggers", "checks",
	} {
		if _, ok := got[field]; !ok {
			t.Errorf("%q missing from JSON — it is declared non-optional in types.ts, "+
				"so the details page will throw. Drop omitempty from its struct tag.", field)
		}
	}
}

// TestObjectDetailOptionalFieldsOmitted is the other half of the contract: the
// fields types.ts marks optional should stay absent when unset, so the page can
// tell "no value" from "zero".
func TestObjectDetailOptionalFieldsOmitted(t *testing.T) {
	b, err := json.Marshal(&ObjectDetail{})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}

	for _, field := range []string{
		"rowEstimate", "sizeBytes", "comment", "definition", "dialectDetail", "unavailable",
	} {
		if _, ok := got[field]; ok {
			t.Errorf("%q present when unset; types.ts treats it as optional and a "+
				"zero value would read as real data", field)
		}
	}
}

func TestMarkUnavailable(t *testing.T) {
	d := &ObjectDetail{}
	d.markUnavailable("rowEstimate", "no statistics")
	d.markUnavailable("sizeBytes", "no size")

	if got := d.Unavailable["rowEstimate"]; got != "no statistics" {
		t.Errorf("rowEstimate reason = %q", got)
	}
	if len(d.Unavailable) != 2 {
		t.Errorf("want 2 reasons, got %d", len(d.Unavailable))
	}
}

func TestIndexAccumGroupsAndPutsPrimaryFirst(t *testing.T) {
	a := newIndexAccum()
	// Arriving in name order, primary last — the accumulator should still
	// surface it first.
	a.add("idx_email", "email", true, false, "btree")
	a.add("idx_name", "last", false, false, "btree")
	a.add("idx_name", "first", false, false, "btree")
	a.add("PRIMARY", "id", true, true, "btree")

	got := a.result()
	if len(got) != 3 {
		t.Fatalf("want 3 indexes, got %d", len(got))
	}
	if !got[0].Primary || got[0].Name != "PRIMARY" {
		t.Errorf("primary should sort first, got %q", got[0].Name)
	}
	// Multi-column order must follow the order columns were added.
	for _, ix := range got {
		if ix.Name == "idx_name" {
			if len(ix.Columns) != 2 || ix.Columns[0] != "last" || ix.Columns[1] != "first" {
				t.Errorf("idx_name columns = %v, want [last first]", ix.Columns)
			}
		}
	}
}

func TestFKAccumPairsColumnsPositionally(t *testing.T) {
	a := newFKAccum()
	a.add("fk_order", "tenant_id", "public", "tenants", "id", "cascade", "restrict")
	a.add("fk_order", "customer_id", "public", "tenants", "customer_id", "cascade", "restrict")

	got := a.result()
	if len(got) != 1 {
		t.Fatalf("want 1 foreign key, got %d", len(got))
	}
	fk := got[0]
	if len(fk.Columns) != 2 || len(fk.ReferencedColumns) != 2 {
		t.Fatalf("composite key not accumulated: %+v", fk)
	}
	if fk.Columns[1] != "customer_id" || fk.ReferencedColumns[1] != "customer_id" {
		t.Errorf("pairs misaligned: %v -> %v", fk.Columns, fk.ReferencedColumns)
	}
	// Referential actions are upper-cased on the way in.
	if fk.OnUpdate != "CASCADE" || fk.OnDelete != "RESTRICT" {
		t.Errorf("actions = %q/%q", fk.OnUpdate, fk.OnDelete)
	}
}

func TestPrimaryKeyOfFallsBackToColumnFlags(t *testing.T) {
	// SQLite reports a rowid-alias primary key on the column and not in
	// pragma_index_list, so the index list alone is not enough.
	cols := []Column{{Name: "id", PrimaryKey: true}, {Name: "name"}}
	if got := primaryKeyOf(nil, cols); len(got) != 1 || got[0] != "id" {
		t.Errorf("want [id] from column flags, got %v", got)
	}

	// When an index reports it, that wins — it carries the key order.
	ix := []Index{{Name: "pk", Primary: true, Columns: []string{"a", "b"}}}
	if got := primaryKeyOf(ix, cols); len(got) != 2 || got[0] != "a" {
		t.Errorf("want [a b] from the index, got %v", got)
	}
}

func TestPGReferentialAction(t *testing.T) {
	for in, want := range map[string]string{
		"a": "NO ACTION", "r": "RESTRICT", "c": "CASCADE",
		"n": "SET NULL", "d": "SET DEFAULT", "": "",
	} {
		if got := pgReferentialAction(in); got != want {
			t.Errorf("pgReferentialAction(%q) = %q, want %q", in, got, want)
		}
	}
}

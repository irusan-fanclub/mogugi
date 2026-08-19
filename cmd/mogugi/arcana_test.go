package main

import "testing"

// Mirrors front/src/lib/arcanaTable.ts — one representative per block plus
// the Bishop gap and out-of-range ids.
func TestArcanaBySkill(t *testing.T) {
	cases := []struct {
		skill uint16
		want  int
	}{
		{59023, 1}, {59028, 1},
		{59000, 2}, {59002, 2}, {59004, 2}, {59008, 2},
		{59003, 0}, // Bishop gap
		{59040, 3}, {59060, 4}, {59080, 5}, {59100, 6},
		{59120, 7}, {59140, 8}, {59160, 9}, {59169, 9},
		{59180, 10}, {59188, 10},
		{59189, 0}, {30480, 0}, {0, 0},
	}
	for _, c := range cases {
		if got := arcanaBySkill(c.skill); got != c.want {
			t.Errorf("arcanaBySkill(%d) = %d, want %d", c.skill, got, c.want)
		}
	}
}

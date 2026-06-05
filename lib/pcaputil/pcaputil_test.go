package pcaputil

import (
	"reflect"
	"testing"
)

func TestOrderCandidates_PreferredFirst(t *testing.T) {
	devs := []string{"dev-a", "dev-b", "dev-c"}
	got := orderCandidates("dev-b", devs)
	want := []string{"dev-b", "dev-a", "dev-c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("orderCandidates = %v, want %v", got, want)
	}
}

func TestOrderCandidates_NoPreferred(t *testing.T) {
	devs := []string{"dev-a", "dev-b"}
	got := orderCandidates("", devs)
	want := []string{"dev-a", "dev-b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("orderCandidates = %v, want %v", got, want)
	}
}

func TestOrderCandidates_PreferredNotInList(t *testing.T) {
	// A stale cached NIC that no longer exists should not be probed.
	devs := []string{"dev-a", "dev-b"}
	got := orderCandidates("gone", devs)
	want := []string{"dev-a", "dev-b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("orderCandidates = %v, want %v", got, want)
	}
}

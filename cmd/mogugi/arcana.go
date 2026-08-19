package main

// Arcana (秘法) detection from skill ids — Go mirror of
// front/src/lib/arcanaTable.ts (hand-written census-backed table; keep the
// two in sync).
var arcanaBlocks = [][3]uint16{
	{1, 59023, 59028}, {2, 59000, 59002}, {2, 59004, 59008},
	{3, 59040, 59046}, {4, 59060, 59065}, {5, 59080, 59086},
	{6, 59100, 59106}, {7, 59120, 59126}, {8, 59140, 59145},
	{9, 59160, 59169}, {10, 59180, 59188},
}

// arcanaBySkill returns the arcana id for a detection skill, 0 if none.
func arcanaBySkill(skill uint16) int {
	for _, b := range arcanaBlocks {
		if skill >= b[1] && skill <= b[2] {
			return int(b[0])
		}
	}
	return 0
}

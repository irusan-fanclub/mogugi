// arcanaTable.ts — hand-written skill-id -> arcana (秘法) detection table.
// 0x520C carries no arcana id, so the only signal is which 59xxx skill a
// character used. See task-6-brief.md for the census that backs this table.

/** Arcana (秘法) ids as the game numbers them. 9 and 10 are newer than
 *  MultiClassCommon.xml, which is why this table is hand-written. */
export type ArcanaId = number;

export const ARCANA_NAMES: Record<ArcanaId, string> = {
    1: '元素騎士', 2: '聖詠者', 3: '縛魂者', 4: '秘術遊俠', 5: '聖盾守衛',
    6: '爆裂槍兵', 7: '幻變槍手', 8: '禁忌鍊金士', 9: '旋律人偶師', 10: '狂怒鬥士',
};

// Detection blocks. Contiguous except Bishop, which skips 59003. The
// puppeteer's 59167-59169 are summon skills — not in its skill list, but
// nothing else uses them, so they identify it.
const BLOCKS: Array<[ArcanaId, number, number]> = [
    [1, 59023, 59028], [2, 59000, 59002], [2, 59004, 59008],
    [3, 59040, 59046], [4, 59060, 59065], [5, 59080, 59086],
    [6, 59100, 59106], [7, 59120, 59126], [8, 59140, 59145],
    [9, 59160, 59169], [10, 59180, 59188],
];

/** Every detection skill id, expanded from the blocks above. */
export const ARCANA_BY_SKILL: Record<number, ArcanaId> = (() => {
    const m: Record<number, ArcanaId> = {};
    for (const [arcana, from, to] of BLOCKS) {
        for (let id = from; id <= to; id++) m[id] = arcana;
    }
    return m;
})();

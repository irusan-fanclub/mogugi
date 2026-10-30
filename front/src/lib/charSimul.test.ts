import { describe, it, expect } from 'vitest';
import { buildStyle, encodeB64Url, noginogiUrl, prilusUrl, type SimulActor } from './charSimul';

const it_ = (PocketType: number, ItemId: number, cs: string[] = []) => ({
    PocketType, ItemId,
    Color1: cs[0] ?? '#000000', Color2: cs[1] ?? '#000000', Color3: cs[2] ?? '#000000',
    Color5: cs[3] ?? '#000000', Color6: cs[4] ?? '#000000', Color7: cs[5] ?? '#000000',
});

function fixture(): SimulActor {
    const items = [
        it_(3, 4975), it_(4, 8201, ['#10000095']),
        it_(5, 1, ['#ffffff']), it_(43, 15001, ['#fffcf3e4', '#193e35', '#DDDDDD', '#2c2325', '#dddddd', '#000000']),
        it_(8, 18001, ['#112233', '#112233', '#112233', '#112233', '#112233', '#112233']),
        it_(10, 40001, ['#aabbcc', '#aabbcc', '#aabbcc', '#aabbcc', '#aabbcc', '#aabbcc']),
        it_(11, 777), it_(16, 888),
    ];
    return {
        raceId: 10002,
        body: { Height: 2, Weight: 0.2, Upper: 1, Lower: 1.2, SkinColor: 45, EyeType: 207, EyeColor: 191, LeftEyeColor: 190, MouthType: 80 },
        equipItemMap: Object.fromEntries(items.map(i => [i.PocketType, i])),
    };
}

const decode = (s: string) => {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
};

describe('buildStyle', () => {
    it('uses pocket 13 (副手) for the left hand, never 12 (背後副手)', () => {
        const a = fixture();
        a.equipItemMap[13] = it_(13, 41001);
        a.equipItemMap[12] = it_(12, 42001);
        expect(buildStyle(a).LeftHand).toMatchObject({ Id: 41001 });
    });
    it('maps race, face, hair, body and eyes', () => {
        const s = buildStyle(fixture());
        expect(s).toMatchObject({
            Race: 10002, Face: 4975, Hair: 8201, HairColor: 149, SkinColor: 45, EyeType: 207,
            LeftEyeColor: 190, RightEyeColor: 191, MouthType: 80,
        });
    });
    it('clamps the body ratios to 0.5-1.5', () => {
        const s = buildStyle(fixture());
        expect([s.Height, s.Weight, s.Upper, s.Lower]).toEqual([1.5, 0.5, 1, 1.2]);
    });
    it('masks the HairColor flag nibble', () => {
        const a = fixture();
        a.equipItemMap[4] = it_(4, 8201, ['#1fffffff']);
        expect(buildStyle(a).HairColor).toBe(0x0fffffff);
    });
    it('lets the costume pocket override the equipment slot, with alpha stripped', () => {
        const s = buildStyle(fixture());
        expect(s.Armor).toEqual({ Id: 15001, Colors: ['#fcf3e4', '#193e35', '#dddddd', '#2c2325', '#dddddd', '#000000'] });
        expect(s.Head).toMatchObject({ Id: 18001 });
        expect(s.RightHand).toMatchObject({ Id: 40001 });
    });
    it('leaves out pockets without a simulator slot and absent slots', () => {
        const s = buildStyle(fixture());
        expect(s.Glove).toEqual({ Id: 0, Colors: [] });
        expect(JSON.stringify(s)).not.toContain('777');
        expect(JSON.stringify(s)).not.toContain('888');
    });
    it('omits fields an old record does not have', () => {
        const s = buildStyle({ raceId: 9001, body: { Height: 1, Weight: 1, Upper: 1, Lower: 1 }, equipItemMap: {} });
        const empty = { Id: 0, Colors: [] };
        expect(s).toEqual({
            Race: 9001, Height: 1, Weight: 1, Upper: 1, Lower: 1,
            Armor: empty, Head: empty, Glove: empty, Shoes: empty, Robe: empty,
            FaceDeco: empty, Tail: empty, RightHand: empty, LeftHand: empty,
        });
    });
    it('uses the eye colour for both eyes when the sides are missing', () => {
        const a = fixture();
        a.body.LeftEyeColor = undefined;
        expect(buildStyle(a)).toMatchObject({ LeftEyeColor: 191, RightEyeColor: 191 });
    });
});

describe('encodeB64Url', () => {
    it('round-trips CJK text without padding', () => {
        for (const name of ['小明', '瑪奇', 'a', 'ab', 'abc']) {
            const code = encodeB64Url({ name });
            expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
            expect(decode(code)).toEqual({ name });
        }
    });
});

// Expected values were produced independently with Node's Buffer base64url.
describe('simulator URLs', () => {
    it('builds the exact Prilus and noginogi links', () => {
        const style = buildStyle(fixture());
        expect(prilusUrl(style)).toBe(`https://prilus.gitlab.io/charsimul#style=${encodeB64Url(style)}`);
        const url = noginogiUrl('小明', style);
        expect(url).toBe(`https://gear.noginogi.sbs/character.html?look=${encodeB64Url({ name: '小明', style })}`);
        const look = decode(new URL(url).searchParams.get('look')!);
        expect(look.name).toBe('小明');
        expect(look.style).toMatchObject({ Race: 10002, Face: 4975, Hair: 8201, HairColor: 149, Armor: { Id: 15001 }, Glove: { Id: 0, Colors: [] } });
    });
});

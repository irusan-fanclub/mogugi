// gen-character-info.test.mjs — pure-function tests for the character-info generator.
import { describe, it, expect } from 'vitest';
import { parseTitles, parseGrandmasters, parseClassLevels } from './gen-character-info.mjs';

describe('parseTitles', () => {
    const loc = new Map([['4', '預設'], ['39', '男'], ['9', '新名']]);
    it('takes the first non-empty name and keeps the last repeated id', () => {
        const xml = `<Title ID="1" DefaultName="_LT[xml.title.4]" MaleName="_LT[xml.title.39]" />
<Title ID="2" DefaultName="" UniName="" MaleName="_LT[xml.title.39]" FemaleName="" />
<Title ID="2" DefaultName="_LT[xml.title.9]" MaleName="" />
<Title ID="3" DefaultName="_LT[xml.title.404]" />`;
        const t = parseTitles(xml, loc);
        expect(t.get(1)).toBe('預設');
        expect(t.get(2)).toBe('新名');
        expect(t.has(3)).toBe(false);
    });
});

describe('parseGrandmasters', () => {
    it('picks the lowest level-16 title per talent and strips the prefix', () => {
        const loc = new Map([['0', '一代宗師戰士'], ['1', '元素騎士'], ['2', '一代宗師冒險家']]);
        const xml = `<talenttitle titleid="20016" localname="_LT[xml.talenttitle.1]" talentid1="1" talentlevel1="16" />
<talenttitle titleid="10116" localname="_LT[xml.talenttitle.0]" talentid1="1" talentlevel1="16" />
<talenttitle titleid="10115" localname="_LT[xml.talenttitle.0]" talentid1="1" talentlevel1="15" />
<talenttitle titleid="10016" localname="_LT[xml.talenttitle.2]" talentid1="0" talentlevel1="16" />`;
        const g = parseGrandmasters(xml, loc);
        expect(g.get(1)).toEqual({ title: 10116, name: '戰士' });
        expect(g.get(0)).toEqual({ title: 10016, name: '冒險家' });
    });
});

describe('parseClassLevels', () => {
    it('returns the exp thresholds in level order, dropping the capped row', () => {
        const xml = `<ClassLevelTable level="2" exp="1206" expValue="15" />
<ClassLevelTable level="1" exp="600" expValue="15" />
<ClassLevelTable level="3" exp="0" expValue="0" />`;
        expect(parseClassLevels(xml)).toEqual([600, 1206]);
    });
});

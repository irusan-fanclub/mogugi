import { describe, it, expect } from 'vitest';
import {
    BREAK_BOX, boxValueText, ccParamRows, CC_VALUE_KEYS, PLUMBING_KEYS,
} from './ccParamSpecs';

const rows = (ccId: number, values: Record<string, string>) =>
    ccParamRows(ccId, values).map(r => [r.label, r.value, r.key]);

describe('ccParamRows', () => {
    it('1164 shows 防禦 and 保護 as negatives, other keys raw', () => {
        expect(rows(1164, { MCDDDV: '103', MCDDPV: '28', MCDDDPV: '22' })).toEqual([
            ['防禦', '−103', 'MCDDDV'], ['保護', '−28', 'MCDDPV'], [null, '22', 'MCDDDPV'],
        ]);
    });

    it('1165 / 1166', () => {
        expect(rows(1165, { MCDMDDV: '105', MCDMDPV: '40' })).toEqual([
            ['魔法防禦', '−105', 'MCDMDDV'], ['魔法保護', '−40', 'MCDMDPV'],
        ]);
        expect(rows(1166, { MCDDMBPV: '61' })).toEqual([['所受傷害', '+61%', 'MCDDMBPV']]);
    });

    it('1176 folds MCSTMAX into the 層數 row', () => {
        expect(rows(1176, { MCSTCT: '5', MCSTMAX: '5', SBDD: '94', SBPD: '21' })).toEqual([
            ['層數', '5／5', 'MCSTCT／MCSTMAX'], ['防禦・魔法防禦', '−94', 'SBDD'], ['保護・魔法保護', '−21', 'SBPD'],
        ]);
    });

    it('1138 / 464 / 1122 / 1026 / 1161 / 10001 / 10002 / 577', () => {
        expect(rows(1138, { MCCSSC: '4', MCCSSCR: '15', MCCSSE: '1' })).toEqual([
            ['層數', '4', 'MCCSSC'], ['所受傷害', '+15%', 'MCCSSCR'], ['滿層', '是', 'MCCSSE'],
        ]);
        expect(rows(1138, { MCCSSE: 'true' })).toEqual([['滿層', '是', 'MCCSSE']]);
        expect(rows(1138, { MCCSSE: 'false' })).toEqual([['滿層', '否', 'MCCSSE']]);
        expect(rows(464, { MCSTSC: '5' })).toEqual([['層數', '5', 'MCSTSC']]);
        expect(rows(1122, { SEDSDR: '1.475' })).toEqual([['增傷倍率', '×1.48', 'SEDSDR']]);
        expect(rows(1026, { ACCVV1: '60', ACCVV2: '5' })).toEqual([
            ['物/魔防禦', '−60', 'ACCVV1'], ['物/魔保護', '−5', 'ACCVV2'],
        ]);
        expect(rows(1161, { MCWWMBD: '1.15', MCWWDMS: '0.3' })).toEqual([
            ['增傷', '×1.15', 'MCWWMBD'], ['緩速', '0.3', 'MCWWDMS'],
        ]);
        expect(rows(10001, { MCLV: '10' })).toEqual([['魔法陣等級', '10', 'MCLV']]);
        expect(rows(10002, { MCLV: '9' })).toEqual([['魔法陣等級', '9', 'MCLV']]);
        expect(rows(577, { BF_DM: '25' })).toEqual([['技能傷害', '+25%', 'BF_DM']]);
    });

    it('323 shows the bonus over 100', () => {
        expect(rows(323, { SDP: '120' })).toEqual([['增傷', '+20%', 'SDP']]);
        expect(rows(323, { SDP: '95' })).toEqual([['增傷', '−5%', 'SDP']]);
    });

    it('511 shows 持續 in seconds and keeps SSAD/SSCRI/SSRT raw', () => {
        expect(rows(511, { SSAD: '22', SSCRI: '22', SSRT: '22', SDUR: '400' })).toEqual([
            [null, '22', 'SSAD'], [null, '22', 'SSCRI'], [null, '22', 'SSRT'], ['持續', '400 秒', 'SDUR'],
        ]);
    });

    it('516 keeps the 覺醒 formatter as one row', () => {
        expect(rows(516, { SOP_DMG_MINMAX: '15', SOP_CRITICAL: '15' })).toEqual([
            ['效果', '傷害 +15%、暴擊率 +15%', 'SOP_DMG_MINMAX／SOP_CRITICAL'],
        ]);
    });

    it('shows unknown keys raw, sorted, and hides the plumbing keys', () => {
        const values: Record<string, string> = { ZZ: 'b', AA: '7' };
        for (const k of PLUMBING_KEYS) values[k] = '1';
        expect(rows(9999, values)).toEqual([[null, '7', 'AA'], [null, 'b', 'ZZ']]);
        expect(PLUMBING_KEYS).toEqual(new Set(['SBT', 'MCAGT', 'MCDCTROID', 'MCDCTSI', 'MCDCPASI', 'MCDCASI']));
    });
});

describe('BREAK_BOX', () => {
    it('is the fixed 2×2 order', () => {
        expect(BREAK_BOX.map(b => [b.ccId, b.key])).toEqual([
            [1164, 'MCDDPV'], [1166, 'MCDDMBPV'], [1165, 'MCDMDPV'], [1176, 'SBPD'],
        ]);
    });
    it('formats the highest value, 0 when absent', () => {
        const [phys, dmg] = BREAK_BOX;
        expect(boxValueText(phys, { MCDDPV: '28' })).toBe('−28');
        expect(boxValueText(dmg, { MCDDMBPV: '61' })).toBe('+61%');
        expect(boxValueText(dmg, undefined)).toBe('0');
        expect(boxValueText(dmg, { MCDDMBPV: '0' })).toBe('0');
    });
});

describe('CC_VALUE_KEYS', () => {
    // Not the source skill: it changes on most refreshes and would flood the history.
    it('lists every known key, not the source skill', () => {
        expect(CC_VALUE_KEYS[1176]).toEqual(['MCSTCT', 'MCSTMAX', 'SBDD', 'SBPD']);
        expect(CC_VALUE_KEYS[511]).toEqual(['SSAD', 'SSCRI', 'SSRT', 'SDUR']);
        expect(CC_VALUE_KEYS[1164]).toEqual(['MCDDDV', 'MCDDPV']);
    });
});

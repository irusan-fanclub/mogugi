// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import RecordRow from './RecordRow.vue';
import RecordDetail from './RecordDetail.vue';
import { humanReadableNumber } from '@/lib/util';
import type { BattleRow } from '@/lib/battleFilter';

const row = (extra: Partial<BattleRow> = {}): BattleRow => ({
    key: 'k', file: 'f', code: 'c', tier: '', player: 'p', startedAtLocal: '', sizeBytes: 1, sortTime: 1, ...extra,
});

describe('RecordRow activeDps cell', () => {
    it('renders the humanised number', () => {
        const w = mount(RecordRow, { props: { row: row({ ownerActiveDps: 1234567 }), col: 'activeDps' } });
        expect(w.text()).toBe(humanReadableNumber(1234567));
    });
    it('renders - when missing', () => {
        const w = mount(RecordRow, { props: { row: row(), col: 'activeDps' } });
        expect(w.text()).toBe('-');
    });
});

describe('RecordDetail per-player active DPS', () => {
    it('shows ActiveDps beside Dps and - when missing', () => {
        const players = [
            { EntityId: '1', Name: 'a', Arcana: 1, Damage: 100, Dps: 20, ActiveDps: 1234567 },
            { EntityId: '2', Name: 'b', Arcana: 1, Damage: 50, Dps: 10 },
        ];
        const w = mount(RecordDetail, { props: { row: row({ players }) } });
        const rows = w.findAll('tbody tr');
        const cells = (i: number) => rows[i].findAll('td').map(td => td.text());
        expect(cells(0)[4]).toBe(humanReadableNumber(1234567));
        expect(cells(1)[4]).toBe('-');
        expect(w.find('thead').text()).toContain('活躍 DPS');
    });
});

describe('RecordRow client cell', () => {
    it('renders the version, or - when empty', () => {
        expect(mount(RecordRow, { props: { row: row({ client: 'tw100' }), col: 'client' } }).text()).toBe('tw100');
        expect(mount(RecordRow, { props: { row: row(), col: 'client' } }).text()).toBe('-');
    });
});

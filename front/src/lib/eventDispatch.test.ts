import { describe, it, expect, vi } from 'vitest';
import { dispatchEvents, type EventSink } from './eventDispatch';
import * as protocols from '@/protocols';

function sink() {
    return {
        messageBox: vi.fn(), ownerName: vi.fn(), captureStatus: vi.fn(), ownerEquipment: vi.fn(),
        ownerStats: vi.fn(), sessionReset: vi.fn(), configChanged: vi.fn(), sourceChanged: vi.fn(), clearData: vi.fn(), battle: vi.fn(),
        historyEvicted: vi.fn(), battleBoundary: vi.fn(),
    } satisfies EventSink;
}

describe('dispatchEvents', () => {
    it('handles runtime events and ignores unknown negative ids', () => {
        const s = sink();
        const dmg = { EventId: 3, At: 1, Id: '1', TargetId: '2', SkillId: 1, Damage: 5, IsCritical: false, IsDelayed: false };
        const batch = [
            { EventId: protocols.eventIdConfigChanged, At: 1, Id: '0', Config: { dpsDisplay: 'web' } },
            { EventId: -99, At: 1, Id: '0' },
            { EventId: protocols.eventIdMessageBox, At: 1, Id: '0', Message: 'hi' },
            { EventId: protocols.eventIdSessionReset, At: 1, Id: '0', Reason: 'channel_switch' },
            dmg,
        ] as protocols.eventBase[];
        expect(() => dispatchEvents(batch, s)).not.toThrow();
        expect(s.configChanged).toHaveBeenCalledWith({ dpsDisplay: 'web' });
        expect(s.messageBox).toHaveBeenCalledWith('hi');
        expect(s.sessionReset).toHaveBeenCalledWith('channel_switch');
        expect(s.battle).toHaveBeenCalledTimes(1);
        expect(s.battle).toHaveBeenCalledWith(dmg);
    });

    it('owner character updates the name and still reaches the actor manager', () => {
        const s = sink();
        dispatchEvents([{ EventId: protocols.eventIdOwnerCharacter, At: 1, Id: '7', Name: 'x' } as protocols.eventBase], s);
        expect(s.ownerName).toHaveBeenCalledWith('x');
        expect(s.battle).toHaveBeenCalledTimes(1);
    });

    it('routes SourceChanged to the banner state and keeps it out of battle data', () => {
        const s = sink();
        const st = { Mode: 'replay', File: 'a.pcapng', Done: 5, Total: 10, Finished: false, Err: '', Notice: '' };
        dispatchEvents([{ EventId: protocols.eventIdSourceChanged, At: 1, Id: '0', ...st } as protocols.eventBase], s);
        expect(s.sourceChanged).toHaveBeenCalledWith(st);
        expect(s.battle).not.toHaveBeenCalled();
    });

    it('forwards ClientVersion from the source event', () => {
        const s = sink();
        const st = { Mode: 'live', File: '', Done: 0, Total: 0, Finished: false, Err: '', Notice: '', ClientVersion: 'tw169' };
        dispatchEvents([{ EventId: protocols.eventIdSourceChanged, At: 1, Id: '0', ...st } as protocols.eventBase], s);
        expect(s.sourceChanged).toHaveBeenCalledWith(st);
    });

    it('clears on entering and leaving replay, not on channel switches', () => {
        for (const [reason, clears] of [['replay', 1], ['live', 1], ['channel_switch', 0]] as const) {
            const s = sink();
            dispatchEvents([{ EventId: protocols.eventIdSessionReset, At: 1, Id: '0', Reason: reason } as protocols.eventBase], s);
            expect(s.clearData).toHaveBeenCalledTimes(clears);
        }
    });
});

describe('dispatchEvents history markers', () => {
    it('routes id -5 to historyEvicted and -6 to battleBoundary, neither reaching battle data', () => {
        const s = sink();
        dispatchEvents([
            { EventId: protocols.eventIdHistoryEvicted, At: 123, Id: '0', Present: ['1'] } as protocols.eventHistoryEvicted,
            { EventId: protocols.eventIdBattleBoundary, At: 456, Id: '0', Present: ['2'] } as protocols.eventBattleBoundary,
        ] as protocols.eventBase[], s);
        expect(s.historyEvicted).toHaveBeenCalledWith(123, ['1']);
        expect(s.battleBoundary).toHaveBeenCalledWith(456, ['2']);
        expect(s.battle).not.toHaveBeenCalled();
    });
});

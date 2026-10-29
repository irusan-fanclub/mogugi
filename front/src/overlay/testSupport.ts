// Shared fixtures for the overlay page tests (mocks stay in each test file: vi.mock is hoisted per file).
import { actorManager, bossRaceIds } from '@/store';
import type { eventBase } from '@/protocols';

export const BOSS_RACE = [...bossRaceIds.value][0];
const base = { Height: 1, Weight: 1, Upper: 1, Lower: 1, GuildName: '', OwnerId: '' };

export function appear(Id: string, RaceId: number, At = 100, Name = `n:${Id}`) {
    actorManager.value.onEvent({ EventId: 1, At, Id, Name, RaceId, ...base } as unknown as eventBase);
}

export function hit(Id: string, TargetId: string, At: number, Damage: number) {
    actorManager.value.onEvent({
        EventId: 3, At, Id, TargetId, SkillId: 10, Damage, IsCritical: false, IsDelayed: false,
    } as unknown as eventBase);
}

export function cc(Id: string, CCId: number, At: number, DisableAt: number) {
    actorManager.value.onEvent({
        EventId: 4, At, Id, CCId, DisableAt, AttackerId: '', Params: {},
    } as unknown as eventBase);
}

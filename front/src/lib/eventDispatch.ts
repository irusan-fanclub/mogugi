import * as p from '@/protocols';

export interface EventSink {
    messageBox(text: string): void;
    ownerName(name: string): void;
    captureStatus(e: p.eventCaptureStatus): void;
    ownerEquipment(items: p.eventOwnerEquipment['Items']): void;
    ownerStats(panel: p.eventOwnerStats['Panel']): void;
    ownerProfile(profile: p.ownerProfile): void;
    sessionReset(reason: string): void;
    configChanged(cfg: Record<string, unknown>): void;
    sourceChanged(state: p.sourceState): void;
    /** Drop on-screen battle data: the event source switched. */
    clearData(): void;
    /** The server dropped history before `at` (unix seconds). */
    historyEvicted(at: number, present?: string[]): void;
    /** A new battle segment started at `at` (unix seconds). */
    battleBoundary(at: number, present?: string[]): void;
    battle(e: p.eventBase): void;
}

/** Routes one WS batch; negative ids without a handler are ignored. */
export function dispatchEvents(events: p.eventBase[], sink: EventSink): void {
    for (const event of events) {
        switch (event.EventId) {
            case p.eventIdMessageBox:
                sink.messageBox((event as p.eventMessageBox).Message);
                continue;
            case p.eventIdConfigChanged:
                sink.configChanged((event as p.eventConfigChanged).Config);
                continue;
            case p.eventIdSourceChanged: {
                const { Mode, File, Done, Total, Finished, Err, Notice, ClientVersion } = event as p.eventSourceChanged;
                sink.sourceChanged({ Mode, File, Done, Total, Finished, Err, Notice, ClientVersion });
                continue;
            }
            case p.eventIdCaptureStatus:
                sink.captureStatus(event as p.eventCaptureStatus);
                continue;
            case p.eventIdHistoryEvicted:
                sink.historyEvicted(event.At, (event as p.eventHistoryEvicted).Present);
                continue;
            case p.eventIdBattleBoundary:
                sink.battleBoundary(event.At, (event as p.eventBattleBoundary).Present);
                continue;
            case p.eventIdOwnerEquipment:
                sink.ownerEquipment((event as p.eventOwnerEquipment).Items);
                continue;
            case p.eventIdOwnerStats:
                sink.ownerStats((event as p.eventOwnerStats).Panel);
                continue;
            case p.eventIdOwnerProfile:
                sink.ownerProfile((event as p.eventOwnerProfile).Profile);
                continue;
            case p.eventIdSessionReset:
{
                const reason = (event as p.eventSessionReset).Reason;
                sink.sessionReset(reason);
                // One source at a time: entering and leaving a replay both reset the screen.
                if (reason === 'replay' || reason === 'live') sink.clearData();
            }
                continue;
            case p.eventIdOwnerCharacter:
                // Also reaches the actor manager (bard-song lane owner id).
                sink.ownerName((event as p.eventOwnerCharacter).Name);
                break;
        }
        if (event.EventId < 0) continue;
        sink.battle(event);
    }
}

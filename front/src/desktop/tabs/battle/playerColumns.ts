// Numeric columns of a player row; the row and the list header both read
// this, so a header label always sits over its column.
export const PLAYER_NUM_COLUMNS = [
    { key: 'time', label: '時間', width: 44, title: '第一擊到最後一擊' },
    { key: 'total', label: '總傷害', width: 64, title: '' },
    { key: 'dps', label: 'DPS', width: 60, title: '' },
    { key: 'active', label: '活躍DPS', width: 60, title: '活躍 DPS：排除開場 5 秒、BOSS 無敵與死亡' },
    { key: 'share', label: '佔比', width: 48, title: '' },
] as const;

export type PlayerNumKey = typeof PLAYER_NUM_COLUMNS[number]['key'];

export const numWidth = (key: PlayerNumKey) => `${PLAYER_NUM_COLUMNS.find(c => c.key === key)!.width}px`;

// Mirrors MusicCell's width so the header label lines up with it.
export const musicWidth = (narrow: boolean) => (narrow ? '24px' : 'var(--music-w, 128px)');

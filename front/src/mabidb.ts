import { openSqliteDb, query } from '@/lib/sqliteDb';

export type ListKey = 'RaceList' | 'SkillList' | 'CharCondList' | 'ItemList';

export interface ListRow {
    Id: number;
    Name: string;
}

const TABLE_BY_KEY: Record<ListKey, string> = {
    RaceList:     'race',
    SkillList:    'skill',
    CharCondList: 'character_condition',
    ItemList:     'item',
};

let opened = false;
let opening: Promise<void> | null = null;

export class MabiDB {
    public constructor(private region: string, private _lang: string) {}

    public async tryOpen(): Promise<void> {
        if (opened) return;
        if (!opening) {
            opening = openSqliteDb(`db/mabi_${this.region}.sqlite`).then(() => {
                opened = true;
            }).finally(() => {
                opening = null;
            });
        }
        return opening;
    }

    public async getSortedListData(key: ListKey): Promise<ListRow[]> {
        await this.tryOpen();
        const table = TABLE_BY_KEY[key];
        return query<ListRow>(`SELECT id AS Id, name AS Name FROM ${table} ORDER BY id`);
    }

    // mabitsequal bakes localized names into entity rows, so no separate string
    // table lookup is needed — names returned by getSortedListData are already
    // in the right language. Kept as identity for caller compatibility.
    public getCurLangString(key: string): string {
        return key;
    }

    public getCurLangStrings(keys: string[]): string[] {
        return keys;
    }
}

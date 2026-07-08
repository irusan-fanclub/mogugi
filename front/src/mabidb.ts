import { openSqliteDb, query } from '@/lib/sqliteDb';

export type ListKey = 'RaceList' | 'SkillList' | 'CharCondList' | 'ItemList' | 'OptionSetList';

export interface ListRow {
    Id: number;
    Name: string;
}

export interface OptionSetRow {
    Id: number;
    Name: string;
    Level: number | null;
    Description: string | null;
}

export interface MetalwareAbilityRow {
    Id: number;
    Name: string;
    InitialValue: number | null;
    ValuePerLevel: number | null;
    BaseMaxLevel: number | null;
    Standard: number | null;    // 顯示倍率（如 0.01: 425 → 4.25）
    IsFloat: number | null;     // 1 = 顯示兩位小數
    SubDesc: string | null;     // 效果行單位後綴（"m 增加" / "% 增加"）
}

const TABLE_BY_KEY: Record<ListKey, string> = {
    RaceList:      'race',
    SkillList:     'skill',
    CharCondList:  'character_condition',
    ItemList:      'item',
    OptionSetList: 'optionset', // enchants: ENPFIX/ENSFIX ids -> names
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

    // 賦予（OptionSet）完整列：名稱 + 等級 + 效果描述（tooltip 用）。
    public async getOptionSets(): Promise<OptionSetRow[]> {
        await this.tryOpen();
        return query<OptionSetRow>('SELECT id AS Id, name AS Name, level AS Level, description AS Description FROM optionset');
    }

    // 細緻工匠能力列（tooltip 用）：value = InitialValue + (level-1) * ValuePerLevel。
    public async getMetalwareAbilities(): Promise<MetalwareAbilityRow[]> {
        await this.tryOpen();
        return query<MetalwareAbilityRow>(
            'SELECT id AS Id, name AS Name, initial_value AS InitialValue, value_per_level AS ValuePerLevel, '
            + 'base_max_level AS BaseMaxLevel, standard AS Standard, is_float AS IsFloat, sub_desc AS SubDesc '
            + 'FROM metalware_ability');
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

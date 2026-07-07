import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';

let sqlite3Promise: Promise<Sqlite3Static> | null = null;
let db: any = null;

async function getSqlite3(): Promise<Sqlite3Static> {
    if (!sqlite3Promise) {
        sqlite3Promise = sqlite3InitModule();
    }
    return sqlite3Promise;
}

export async function openSqliteDb(url: string): Promise<void> {
    const sqlite3 = await getSqlite3();

    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());

    const ptr = sqlite3.wasm.allocFromTypedArray(bytes);
    const handle = new sqlite3.oo1.DB();
    const rc = sqlite3.capi.sqlite3_deserialize(
        (handle as any).pointer,
        'main',
        ptr,
        bytes.byteLength,
        bytes.byteLength,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE,
    );
    if (rc !== 0) {
        throw new Error(`sqlite3_deserialize failed: ${rc}`);
    }

    db?.close();
    db = handle;
}

export function query<T = any>(sql: string, params: any[] = []): T[] {
    if (!db) throw new Error('sqliteDb: not open');
    const rows: T[] = [];
    db.exec({
        sql,
        bind: params,
        rowMode: 'object',
        resultRows: rows as any,
    });
    return rows;
}

export function queryOne<T = any>(sql: string, params: any[] = []): T | undefined {
    const rows = query<T>(sql, params);
    return rows[0];
}

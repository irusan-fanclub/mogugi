// Per-CC tooltip text, keyed by CCId. A CC's Params keys don't map 1:1 onto
// in-game stats (spec §12: one key can drive several stats), so each entry
// writes the game's own wording instead of generically looping over keys.

/** CC 516 覺醒 (Awakening), granted by skill 58014 力量團聚. */
export const AWAKENING_CC_ID = 516;

export type CCParamsFormatter = (params: Record<string, string>) => string | null;

function pctText(params: Record<string, string>, key: string): string | null {
    const raw = params[key];
    if (raw === undefined) return null;
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return null;
    return `${n >= 0 ? '+' : ''}${n}%`;
}

// SOP_DMG_MINMAX alone drives min/max damage, magic attack and alchemy
// damage; SOP_CRITICAL drives crit rate. Text mirrors the in-game skill
// description ("傷害 +15%、暴擊率 +15%"), not the raw key names.
const formatAwakening: CCParamsFormatter = (params) => {
    const dmg = pctText(params, 'SOP_DMG_MINMAX');
    const crit = pctText(params, 'SOP_CRITICAL');
    const parts: string[] = [];
    if (dmg !== null) parts.push(`傷害 ${dmg}`);
    if (crit !== null) parts.push(`暴擊率 ${crit}`);
    return parts.length > 0 ? parts.join('、') : null;
};

/** Add a new CC's mapping here — key→stat is per-CC, not general (spec §12). */
export const CC_PARAMS_TOOLTIP: Partial<Record<number, CCParamsFormatter>> = {
    [AWAKENING_CC_ID]: formatAwakening,
};

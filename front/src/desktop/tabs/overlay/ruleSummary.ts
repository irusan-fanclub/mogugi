import type { AlertRule, AlertTarget } from '@/lib/overlaySettings';

export const TARGET_LABEL: Record<AlertTarget, string> = { boss: 'BOSS', self: '自身', party: '其他隊友', all: '全隊' };

/** 戰場的序曲: seeds a new rule's cc and new condition rows. */
export const DEFAULT_CC_ID = 680;

export function ruleSummary(rule: AlertRule, nameOf: (ccId: number) => string): string {
    const when = rule.kind === 'periodic' ? `每 ${rule.every} 秒`
        : rule.kind === 'appear' ? `${nameOf(rule.ccId)} 出現時`
            : `${nameOf(rule.ccId)} 剩 ${rule.times.join('／')} 秒`;
    const conds = rule.conds
        .map(c => `${c.mode === 'absent' ? '沒有' : '有'} ${nameOf(c.ccId)}`)
        .join(rule.join === 'or' ? ' 或 ' : ' 且 ');
    const cond = conds ? `，${conds} 時` : '';
    const none = rule.kind === 'countdown' ? '只轉紅' : '不提醒';
    const how = (rule.text && rule.voice ? '文字＋語音' : rule.text ? '文字' : rule.voice ? '語音' : none)
        + (rule.text && rule.loud ? '（醒目）' : '');
    return `${TARGET_LABEL[rule.target]} ${when}${cond}：${how}`;
}

/** Comma-separated seconds -> distinct positive integers, largest first. */
export function parseTimes(text: string): number[] {
    const out = text.split(/[,，\s]+/)
        .filter(s => s !== '')
        .map(s => Math.round(Number(s)))
        .filter(n => Number.isFinite(n) && n > 0);
    return [...new Set(out)].sort((a, b) => b - a);
}

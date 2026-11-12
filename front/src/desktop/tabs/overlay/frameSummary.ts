import type { SectionLook } from '@/lib/overlayFrames';
import type { CcLook, CooldownLook, SectionId } from '@/lib/overlaySections';

const SIZE = { s: '小', m: '中', l: '大' } as const;
const CC_NAMES = { label: '文字', member: '隊友名', none: '無' } as const;

/** One line for a collapsed 外觀 row: what the frame looks like, or whom it follows. */
export function frameSummary(look: SectionLook, section: SectionId, follow: string | null): string {
    if (follow !== null) return `跟『${follow}』一樣`;
    const parts = [look.size === 'c' ? `自訂 ${look.px}px` : SIZE[look.size]];
    if (section === 'cooldown') {
        parts.push((look as CooldownLook).names ? '名字' : '無名字');
    } else if (section !== 'burst') {
        parts.push(CC_NAMES[(look as CcLook).names]);
    }
    if (section === 'ccParty' || section === 'cooldown') {
        parts.push(look.arrange === 'byMember' ? `依隊友排列（${look.gap === 'pack' ? '往左補齊' : '留空對齊'}）` : '平鋪');
    }
    if (section !== 'cooldown' && section !== 'burst') parts.push(`${(look as CcLook).dim}%`);
    return parts.join('・');
}

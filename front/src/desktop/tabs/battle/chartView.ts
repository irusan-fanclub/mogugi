import { ref } from 'vue';
import { INVINCIBLE_NAME, PARTY_NAME } from '@/desktop/charts/dpsTimelineOption';

// The DPS chart's view state, shared by every mount for this session.
// The party line starts hidden, the invincible tint shown.
export const chartView = {
    collapsed: ref(false),
    legend: { [PARTY_NAME]: false, [INVINCIBLE_NAME]: true } as Record<string, boolean>,
};

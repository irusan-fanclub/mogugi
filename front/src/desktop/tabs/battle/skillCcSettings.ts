import { ref } from 'vue';
import { settingsStorage } from '@/lib/settingsStorage';
import {
    defaultSkillCcModel, loadSkillCcModel, saveSkillCcModel, type SkillCcModel,
} from '@/lib/skillCcLists';
// 通用/秘法 x BOSS/自身 lists.
export const skillCcModel = ref<SkillCcModel>(loadSkillCcModel(settingsStorage));

export function setSkillCcList(owner: 'common' | number, kind: 'boss' | 'self', list: number[]) {
    const m = skillCcModel.value;
    skillCcModel.value = owner === 'common'
        ? { ...m, common: { ...m.common, [kind]: list } }
        : { ...m, arcana: { ...m.arcana, [owner]: { ...(m.arcana[owner] ?? { boss: [], self: [] }), [kind]: list } } };
    saveSkillCcModel(settingsStorage, skillCcModel.value);
}

export function resetSkillCcModel() {
    skillCcModel.value = defaultSkillCcModel();
    saveSkillCcModel(settingsStorage, skillCcModel.value);
}

export function resetSkillCcList(owner: 'common' | number, kind: 'boss' | 'self') {
    const d = defaultSkillCcModel();
    setSkillCcList(owner, kind, [...((owner === 'common' ? d.common : d.arcana[owner])?.[kind] ?? [])]);
}

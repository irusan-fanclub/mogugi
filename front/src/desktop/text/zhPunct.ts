// Full-width punctuation for labels that come from shared (web-UI) modules.
// URLs are left untouched so their colons survive.
const MAP: Record<string, string> = { '(': '（', ')': '）', ',': '，', ':': '：', ';': '；' };
export const zhPunct = (s: string): string =>
    s.split(/(https?:\/\/\S+)/).map((p, i) => i % 2 ? p : p.replace(/[(),:;]/g, c => MAP[c])).join('');

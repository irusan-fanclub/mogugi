import type { VoiceSettings } from '@/lib/overlaySettings';

const MAX_WAIT_MS = 3000;
const MIN_STUCK_MS = 10_000;
const STUCK_MS_PER_CHAR = 600;
const FALLBACK_LANG = 'zh-TW';

interface Pending { text: string; v: VoiceSettings; queuedAt: number }

function pickVoice(synth: SpeechSynthesis, name: string): SpeechSynthesisVoice | undefined {
    const voices = synth.getVoices();
    return voices.find(x => x.name === name) ?? voices.find(x => x.lang.startsWith(FALLBACK_LANG));
}

function makeUtterance(text: string): SpeechSynthesisUtterance {
    return typeof SpeechSynthesisUtterance === 'function'
        ? new SpeechSynthesisUtterance(text)
        : ({ text } as SpeechSynthesisUtterance);
}

/** Speaks one at a time; an item that waited over 3 s for its turn is dropped as stale. */
export function createSpeechQueue(synth: SpeechSynthesis | null, now: () => number) {
    const queue: Pending[] = [];
    let speaking = false;
    let epoch = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    function clearWatchdog() {
        if (watchdog !== undefined) clearTimeout(watchdog);
        watchdog = undefined;
    }

    function next() {
        if (!synth) return;
        let item: Pending | undefined;
        while ((item = queue.shift())) {
            if (now() - item.queuedAt <= MAX_WAIT_MS) break;
            item = undefined;
        }
        if (!item) { speaking = false; clearWatchdog(); return; }
        speaking = true;
        const mine = epoch;
        const u = makeUtterance(item.text);
        const voice = pickVoice(synth, item.v.voiceName);
        if (voice) u.voice = voice;
        u.rate = item.v.rate;
        u.volume = item.v.volume / 100;
        let finished = false;
        const done = () => {
            if (finished || mine !== epoch) return;
            finished = true;
            clearWatchdog();
            next();
        };
        u.onend = done;
        u.onerror = done;
        clearWatchdog();
        // A synth that never fires onend/onerror would block the queue for good.
        watchdog = setTimeout(() => {
            if (finished || mine !== epoch) return;
            synth.cancel();
            done();
        }, Math.max(MIN_STUCK_MS, item.text.length * STUCK_MS_PER_CHAR));
        synth.speak(u);
    }

    return {
        say(text: string, v: VoiceSettings) {
            if (!synth) return;
            queue.push({ text, v, queuedAt: now() });
            if (!speaking) next();
        },
        cancel() {
            epoch++;
            clearWatchdog();
            queue.length = 0;
            speaking = false;
            synth?.cancel();
        },
    };
}

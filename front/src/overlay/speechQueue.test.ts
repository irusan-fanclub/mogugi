import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSpeechQueue } from './speechQueue';

const voice = { voiceName: '', rate: 1.5, volume: 50, muted: false };

function fakeSynth(voices: { name: string; lang: string }[] = []) {
    const spoken: { text: string; voice?: { name: string }; rate: number; volume: number; onend?: () => void }[] = [];
    const synth = {
        speak: (u: (typeof spoken)[number]) => { spoken.push(u); },
        cancel: () => { spoken.length = 0; },
        getVoices: () => voices,
    } as unknown as SpeechSynthesis;
    return { synth, spoken };
}

afterEach(() => { vi.useRealTimers(); });

describe('speechQueue', () => {
    it('a stuck utterance is cancelled and the queue moves on', () => {
        vi.useFakeTimers();
        const { synth, spoken } = fakeSynth();
        const cancel = vi.spyOn(synth, 'cancel');
        let t = 0;
        const q = createSpeechQueue(synth, () => t);
        q.say('一', voice);
        q.say('二', voice);
        t = 2000;
        vi.advanceTimersByTime(9_999);
        expect(spoken.map(u => u.text)).toEqual(['一']);
        vi.advanceTimersByTime(2);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(spoken.map(u => u.text)).toEqual(['二']);
    });

    it('a normal end does not trigger the watchdog', () => {
        vi.useFakeTimers();
        const { synth, spoken } = fakeSynth();
        const cancel = vi.spyOn(synth, 'cancel');
        const q = createSpeechQueue(synth, () => 0);
        q.say('一', voice);
        spoken[0].onend!();
        vi.advanceTimersByTime(60_000);
        expect(cancel).not.toHaveBeenCalled();
    });

    it('speaks the first at once with rate and volume (0-1)', () => {
        const { synth, spoken } = fakeSynth();
        const q = createSpeechQueue(synth, () => 0);
        q.say('一', voice);
        expect(spoken.map(u => u.text)).toEqual(['一']);
        expect(spoken[0].rate).toBe(1.5);
        expect(spoken[0].volume).toBe(0.5);
    });

    it('drops queued items that waited more than 3 seconds', () => {
        const { synth, spoken } = fakeSynth();
        let t = 0;
        const q = createSpeechQueue(synth, () => t);
        q.say('一', voice);
        q.say('二', voice);
        q.say('三', voice);
        t = 4000;
        spoken[0].onend!();
        expect(spoken.map(u => u.text)).toEqual(['一']);
    });

    it('speaks a queued item that waited under 3 seconds', () => {
        const { synth, spoken } = fakeSynth();
        let t = 0;
        const q = createSpeechQueue(synth, () => t);
        q.say('一', voice);
        q.say('二', voice);
        t = 2000;
        spoken[0].onend!();
        expect(spoken.map(u => u.text)).toEqual(['一', '二']);
    });

    it('picks the named voice, else the first zh-TW one', () => {
        const voices = [{ name: 'A', lang: 'en-US' }, { name: 'B', lang: 'zh-TW' }, { name: 'C', lang: 'zh-TW' }];
        const a = fakeSynth(voices);
        createSpeechQueue(a.synth, () => 0).say('x', { ...voice, voiceName: 'C' });
        expect(a.spoken[0].voice!.name).toBe('C');
        const b = fakeSynth(voices);
        createSpeechQueue(b.synth, () => 0).say('x', { ...voice, voiceName: 'nope' });
        expect(b.spoken[0].voice!.name).toBe('B');
    });

    it('cancel clears the queue', () => {
        const { synth, spoken } = fakeSynth();
        const q = createSpeechQueue(synth, () => 0);
        q.say('一', voice);
        q.say('二', voice);
        const first = spoken[0];
        q.cancel();
        first.onend?.();
        expect(spoken).toEqual([]);
    });

    it('does nothing without a synth', () => {
        const q = createSpeechQueue(null, () => 0);
        expect(() => { q.say('x', voice); q.cancel(); }).not.toThrow();
    });
});

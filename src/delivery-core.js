import { DEFAULT_TONE_TAGS, cleanToneTable, inlineNames } from './tts-text.js';

/**
 * Delivery tags, the writing side (fork): what the story model is told, and the regex scripts that
 * turn the tags into something to style. Pure, so it can be tested without SillyTavern.
 *
 * The model writes [whisper]"I know."[/whisper]. The saved text keeps the tags. Two regex scripts
 * (SillyTavern's own, shown in its Regex list) do the rest:
 *   - the display script wraps the pair in <span class="wk-tone wk-tone-whisper" data-tone="whisper">,
 *     for display only. The look of each delivery is CSS, set in Appearance; the model is never asked
 *     for styling, and no colour or slant comes from here.
 *   - the saver script removes the tags from what is sent back to the model. It starts switched off.
 */

/** What each delivery means, in the words the story model is given. */
export const DELIVERY_MEANINGS = Object.freeze({
    whisper: 'quiet, intimate, secret or breathy',
    shout: 'loud, forceful, urgent or furious',
    sigh: 'weary, resigned, wistful or relieved',
    laugh: 'said while laughing, amused or giddy',
    cry: 'voice breaking, tearful or choked up',
    excited: 'eager, thrilled, fast and bright',
    playful: 'teasing, light, mischievous',
    curious: 'questioning, interested, leaning in',
    nervous: 'anxious, unsteady, hesitant',
    scared: 'frightened, shaky, small',
    angry: 'sharp, hard, barely held in',
    tired: 'worn out, slow, flat',
    murmur: 'soft and low, half to oneself',
    hushed: 'kept quiet so as not to be overheard',
    breathy: 'airy, close, short of breath',
    intimate: 'warm, close, meant for one listener',
    snarl: 'a low, vicious growl of anger',
    command: 'an order, firm and authoritative',
    seething: 'rage held down under pressure',
    sneer: 'contempt, mockery, a curl of the lip',
    defiant: 'refusing to back down, loud and proud',
    bite: 'clipped, cutting, sharp',
    pleading: 'begging, desperate, asking for mercy',
    sobbing: 'crying hard while speaking',
    wistful: 'longing, nostalgic, thinking of what is lost',
    uncertain: 'hesitant, unsure of the words',
    resigned: 'given up, accepting, no fight left',
    trembling: 'voice shaking with fear, cold or emotion',
    teasing: 'playfully needling, light mockery',
    flirtatious: 'charming, smooth, inviting',
    amused: 'entertained, a smile in the voice',
    dreamy: 'distant, drifting, half-lost in thought',
    deadpan: 'flat and expressionless, dry humour',
    reverent: 'solemn, ceremonial, in awe',
    ominous: 'a slow threat, heavy with warning',
    steady: 'calm, even, in control',
});

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The tag names in force, longest first so one name never swallows another. */
export function deliveryNames(table) {
    const clean = cleanToneTable(table);
    const names = Object.keys(Object.keys(clean).length ? clean : DEFAULT_TONE_TAGS);
    return names.sort((a, b) => b.length - a.length);
}

/**
 * The tag names split by kind, longest first: WRAPPERS go around words, INLINE tags stand alone.
 *
 * @param {Record<string,string>} [table]
 * @param {Set<string>|string[]} [inline] The inline names in force (inlineNames); the built-in kinds when left out.
 * @returns {{ wrappers: string[], inline: string[] }}
 */
export function splitDeliveryNames(table, inline) {
    const clean = cleanToneTable(table);
    const effective = Object.keys(clean).length ? clean : DEFAULT_TONE_TAGS;
    const set = inline === undefined ? inlineNames(effective) : new Set(inline);
    const names = deliveryNames(table);
    return { wrappers: names.filter(n => !set.has(n)), inline: names.filter(n => set.has(n)) };
}

/**
 * The instruction sent to the story model: wrapping tags and standalone (inline) tags, and the rules for each.
 *
 * @param {Record<string,string>} [table] Delivery tag to ElevenLabs word; only the names are used here.
 * @param {Record<string,string>} [meanings] The owner's own wording per tag; the built-in one is used where there is none.
 * @param {{ inline?: Set<string>|string[] }} [options] inline: the standalone tag names (inlineNames).
 * @returns {string}
 */
export function buildDeliveryPrompt(table, meanings, { inline } = {}) {
    const { wrappers, inline: solo } = splitDeliveryNames(table, inline);
    const own = meanings && typeof meanings === 'object' ? meanings : {};
    const said = (n) => String(own[n] ?? '').replace(/\s+/g, ' ').trim() || DELIVERY_MEANINGS[n] || n;
    const lines = wrappers.map(n => `  ${n}: ${said(n)}`);
    const soloLines = solo.map(n => `  ${n}: ${said(n)}`);
    const first = wrappers.includes('whisper') ? 'whisper' : (wrappers[0] || 'whisper');
    const out = [
        '### DELIVERY TAGS',
        '- When a line of speech is delivered in a clearly different way from normal talking, mark it with a delivery tag. A wrapping tag goes around the quoted words:',
        `  [${first}]"I know."[/${first}]`,
        '- Wrapping tags (open and close):',
        ...lines,
    ];
    if (soloLines.length) {
        out.push(
            '- Standalone tags (inline): written alone in square brackets with NO closing tag, inside the quoted speech, right before the words they affect:',
            `  "I didn't think you would come. [${solo.includes('pause') ? 'pause' : solo[0]}] [${solo.includes('sighs') ? 'sighs' : solo[solo.length - 1]}] But here you are."`,
            ...soloLines,
        );
    }
    out.push(
        '- Use only the tags listed here, and choose the one that fits most closely (for example [pleading] for begging rather than [cry], [seething] for held-down rage rather than [angry]). Ordinary speech needs no tag, but never skip one when a line is clearly whispered, shouted, laughed, cried or otherwise marked; if the scene or the line calls for it, tag it.',
        '- A wrapping tag goes around the quoted words of ONE speaker, inside that speaker\'s own paragraph, one per line of speech. Never wrap narration, actions or several speakers.',
    );
    if (soloLines.length) {
        out.push(
            '- A standalone tag has no closing tag. Put one per clause at most, right before the words it affects, and use them sparingly, only where the delivery really changes. Never put one in narration or in an action.',
        );
    }
    out.push('- Tags are plain text. Do not describe sounds or delivery in the tag, and never use colour, bold or italics to show delivery.');
    return out.join('\n');
}

/** Where the instruction goes in the story prompt, the same choices as the other injected blocks. */
export const DELIVERY_POSITIONS = Object.freeze({
    before: 'Before the story prompt',
    prompt: 'In the prompt',
    chat: 'In the chat, this many messages back',
});
export const DELIVERY_ROLES = Object.freeze({ system: 'System', user: 'User', assistant: 'Assistant' });

export const DELIVERY_INJECT_DEFAULTS = Object.freeze({
    position: 'chat',
    depth: 0,
    role: 'system',
    /** The injection order a prompt-list entry starts with (blocks at one depth are sorted by it). */
    order: 110,
    /** Hand placement to SillyTavern's own prompt list. */
    inList: false,
});

const pick = (v, table, d) => (Object.prototype.hasOwnProperty.call(table, v) ? v : d);
const int = (v, lo, hi, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

/** The injection settings with every field in range. */
export function normalizeDeliveryInject(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = DELIVERY_INJECT_DEFAULTS;
    return {
        position: pick(r.position, DELIVERY_POSITIONS, d.position),
        depth: int(r.depth, 0, 100, d.depth),
        role: pick(r.role, DELIVERY_ROLES, d.role),
        order: int(r.order, 0, 1000, d.order),
        inList: r.inList === true,
    };
}

/** One sentence saying where the instruction goes, for the settings page. */
export function describeDeliveryPlacement(inject) {
    const o = normalizeDeliveryInject(inject);
    if (o.inList) return `In SillyTavern's prompt list (entry "Worldkit - Delivery Tags"); its position, depth, role and order are set there.`;
    const roleName = DELIVERY_ROLES[o.role].toLowerCase();
    if (o.position === 'before') return `As a ${roleName} message before the story prompt.`;
    if (o.position === 'prompt') return `As a ${roleName} message in the prompt.`;
    return `As a ${roleName} message ${o.depth === 0 ? 'right after the newest message' : `${o.depth} message${o.depth === 1 ? '' : 's'} back`}.`;
}

export const DELIVERY_SCRIPT_IDS = Object.freeze({
    display: '5b0e6d1c-6c2e-4a52-9d1e-77a1f0a0de11',
    saver: '5b0e6d1c-6c2e-4a52-9d1e-77a1f0a0de12',
    inline: '5b0e6d1c-6c2e-4a52-9d1e-77a1f0a0de13',
});

/**
 * The three SillyTavern regex scripts for the current tag names: display (wrappers), saver (both kinds), and a
 * display script for the standalone tags, which only leaves an empty marker span (so the tag is hidden in the chat).
 *
 * @param {Record<string,string>} [table]
 * @param {{ enabled?: boolean, saverOn?: boolean, saverDepth?: number, inline?: Set<string>|string[] }} [options]
 * @returns {object[]} Regex script objects in SillyTavern's own format: display, saver, inline display, in that order.
 */
export function deliveryScripts(table, { enabled = true, saverOn = false, saverDepth = 2, inline, extraNames = [] } = {}) {
    const split = splitDeliveryNames(table, inline);
    const alt = split.wrappers.map(escapeRe).join('|') || '(?!)';
    const both = [...split.wrappers, ...split.inline].map(escapeRe).join('|');
    // The third script hides every delivery tag still showing after the pairs were turned into spans: standalone tags, an
    // opening tag the model never closed, a stray closing tag, and any known tag name that is not in the saved list.
    const strayAlt = [...new Set([...split.wrappers, ...split.inline, ...extraNames.map(n => String(n).toLowerCase())])]
        .sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    // An opening tag may carry extra words ([whisper, soft]); the closing tag must match the opening one.
    const open = `\\[(${alt})(?:\\s{0,3},[^\\]\\[]{0,40})?\\]`;
    return [
        {
            id: DELIVERY_SCRIPT_IDS.display,
            scriptName: 'Worldkit - Delivery Tags (display)',
            findRegex: `/${open}([\\s\\S]{1,2000}?)\\[\\/\\1\\]/gi`,
            replaceString: '<span class="wk-tone wk-tone-$1" data-tone="$1">$2</span>',
            trimStrings: [],
            placement: [1, 2],
            disabled: !enabled,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null,
        },
        {
            id: DELIVERY_SCRIPT_IDS.saver,
            scriptName: 'Worldkit - Delivery Tags Context Saver',
            // Also the [sfx:name] sound tags, which are only for the chat chips and cost tokens in older messages.
            findRegex: `/\\[\\/?(?:${both})(?:\\s{0,3},[^\\]\\[]{0,40})?\\]|\\[\\s*sfx\\s*:[^\\]\\[]{1,60}\\]/gi`,
            replaceString: '',
            trimStrings: [],
            placement: [1, 2],
            // Independent of Delivery Tags: it also hides [sfx:] tags, which Sound Effects writes.
            disabled: !saverOn,
            markdownOnly: false,
            promptOnly: true,
            runOnEdit: false,
            substituteRegex: 0,
            minDepth: Math.max(0, Math.round(Number(saverDepth) || 0)),
            maxDepth: null,
        },
        {
            id: DELIVERY_SCRIPT_IDS.inline,
            scriptName: 'Worldkit - Delivery Tags (inline)',
            // Hides what the display script left: a single bracket pair only, so a double bracket ([[Name]], a speaker marker) is never touched.
            findRegex: strayAlt ? `/(?<!\\[)\\[\\/?(${strayAlt})(?:\\s{0,3},[^\\]\\[]{0,40})?\\](?!\\])/gi` : '/(?!)/g',
            replaceString: '<span class="wk-inline" data-tone="$1"></span>',
            trimStrings: [],
            placement: [1, 2],
            disabled: !enabled,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null,
        },
    ];
}

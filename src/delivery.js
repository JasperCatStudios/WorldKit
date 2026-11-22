import { saveSettingsDebounced, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { placeWritingPrompt } from './prompt-slot.js';
import { getSettings } from './settings.js';
import { mergeRegexScripts } from './content-kit.js';
import { withTrackerSavers } from './saver-scripts.js';
import { KNOWN_TAG_NAMES } from './eleven-tags.js';
import { buildDeliveryPrompt, deliveryScripts, deliveryNames, normalizeDeliveryInject, DELIVERY_SCRIPT_IDS } from './delivery-core.js';
import { deliveryCss, fontsUrl } from './delivery-style.js';
import { toneTable, toneInline } from './alltalk.js';
import { debugLog } from './constants.js';

/**
 * Delivery tags at run time (fork): the instruction sent to the story model, and the two regex scripts
 * kept in SillyTavern's Regex list to match the switch and the tag names. See delivery-core.js.
 * The saver's own switch and depth are settings here (deliverySaverOn, deliverySaverDepth), so
 * turning the feature off and on again does not forget them.
 */

export const DELIVERY_KEY = 'sillynpc-delivery-tags';

export function deliveryEnabled() {
    const settings = getSettings();
    return settings.enabled !== false && settings.deliveryTagsEnabled === true;
}

/** The instruction text: the owner's if they have written their own, else built from the tag names. */
export function deliveryPromptText() {
    return String(getSettings().deliveryTagsPrompt ?? '').trim() || buildDeliveryPrompt(toneTable(), getSettings().deliveryMeanings, { inline: toneInline() });
}

const POSITIONS = {
    before: extension_prompt_types.BEFORE_PROMPT,
    prompt: extension_prompt_types.IN_PROMPT,
    chat: extension_prompt_types.IN_CHAT,
};
const ROLES = {
    system: extension_prompt_roles.SYSTEM,
    user: extension_prompt_roles.USER,
    assistant: extension_prompt_roles.ASSISTANT,
};

/** The injection settings (position, depth, role, order, prompt list), always in range. */
export function deliveryInject() {
    const settings = getSettings();
    settings.deliveryInject = normalizeDeliveryInject(settings.deliveryInject);
    return settings.deliveryInject;
}

/** Puts the instruction in front of the model, or takes it away. */
export function applyDeliveryPrompt() {
    const o = deliveryInject();
    const text = deliveryEnabled() ? deliveryPromptText() : '';
    const name = 'Worldkit - Delivery Tags';
    if (o.inList) {
        placeWritingPrompt(DELIVERY_KEY, text, { inList: true, depth: o.depth, name, order: o.order });
        return;
    }
    // Not in the list: clear any list entry from an earlier choice, then inject it directly.
    placeWritingPrompt(DELIVERY_KEY, '', { inList: false });
    if (!text.trim()) return;
    setExtensionPrompt(DELIVERY_KEY, text, POSITIONS[o.position], o.depth, false, ROLES[o.role]);
}

/** What is installed and what would be sent, for the settings page. */
export function deliveryStatus() {
    const list = Array.isArray(extension_settings.regex) ? extension_settings.regex : [];
    const find = (id) => list.find(s => s?.id === id) || null;
    const display = find(DELIVERY_SCRIPT_IDS.display);
    const saver = find(DELIVERY_SCRIPT_IDS.saver);
    const inline = find(DELIVERY_SCRIPT_IDS.inline);
    return {
        enabled: deliveryEnabled(),
        display: { script: display, installed: !!display, on: !!display && display.disabled !== true },
        inline: { script: inline, installed: !!inline, on: !!inline && inline.disabled !== true },
        saver: { script: saver, installed: !!saver, on: !!saver && saver.disabled !== true },
        text: deliveryPromptText(),
        inject: deliveryInject(),
    };
}

/**
 * Writes the three regex scripts (display, saver, inline display) into SillyTavern's list for the current tag names and switch. The
 * context saver keeps whatever on/off and depth the owner gave it; it starts on.
 */
export function syncDeliveryScripts({ force = false } = {}) {
    const list = Array.isArray(extension_settings.regex) ? extension_settings.regex : [];
    const settings = getSettings();
    const scripts = deliveryScripts(toneTable(), {
        enabled: deliveryEnabled(),
        saverOn: settings.deliverySaverOn === true,
        saverDepth: settings.deliverySaverDepth ?? 2,
        inline: toneInline(settings),
        extraNames: KNOWN_TAG_NAMES,
    });
    // While the feature has never been on, only the saver is written (it also hides [sfx:] tags); the display scripts wait.
    const neverOn = !deliveryEnabled() && !list.some(s => s?.id === DELIVERY_SCRIPT_IDS.display);
    const toWrite = (neverOn ? scripts.filter(s => s.id === DELIVERY_SCRIPT_IDS.saver) : scripts).map(s => {
        // The two display scripts keep the on/off the owner gave them (in the Regex list or here). Only the Delivery Tags
        // switch itself (force) sets them; otherwise every start-up, which on a phone happens between messages, switched
        // them off again whenever that setting was off.
        if (force || s.id === DELIVERY_SCRIPT_IDS.saver) return s;
        const there = list.find(x => x?.id === s.id);
        return there && typeof there.disabled === 'boolean' ? { ...s, disabled: there.disabled } : s;
    });
    // The four tracker savers ship with the extension: any that is missing is added, one that is there is left as it is.
    const withSavers = withTrackerSavers(mergeRegexScripts(list, toWrite).merged);
    extension_settings.regex = withSavers.list;
    saveSettingsDebounced();
    debugLog('Delivery tag regex scripts brought up to date');
}

/** Puts the current styles on the page: one <style> for the looks and, when a font needs loading, one <link>. */
export function applyDeliveryStyle() {
    if (typeof document === 'undefined') return;
    const settings = getSettings();
    const names = deliveryNames(toneTable());
    let style = document.getElementById('wk-delivery-style');
    if (!style) {
        style = document.createElement('style');
        style.id = 'wk-delivery-style';
        document.head.append(style);
    }
    style.textContent = deliveryCss(settings.deliveryStyles, names);

    const url = fontsUrl(settings.deliveryStyles, names);
    let link = document.getElementById('wk-delivery-fonts');
    if (!url) { link?.remove(); return; }
    if (!link) {
        link = document.createElement('link');
        link.id = 'wk-delivery-fonts';
        link.rel = 'stylesheet';
        document.head.append(link);
    }
    if (link.getAttribute('href') !== url) link.setAttribute('href', url);
}

/** Both at once: what the toggle and a change to the tag table call. */
export function applyDelivery({ force = false } = {}) {
    applyDeliveryPrompt();
    syncDeliveryScripts({ force });
}

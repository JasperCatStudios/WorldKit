import { runRegexScript } from '../../../regex/engine.js';
import { getSettings, saveSettings } from './settings.js';
import { promptListAvailable } from './prompt-slot.js';
import { toneTable, toneInline } from './alltalk.js';
import { toneAt, speechFor } from './tts-text.js';
import { engineOf, engineReadsAudioTags, ENGINES } from './tts-engines.js';
import {
    DELIVERY_POSITIONS, DELIVERY_ROLES, normalizeDeliveryInject, describeDeliveryPlacement,
} from './delivery-core.js';
import { deliveryInject, deliveryStatus, applyDelivery, setDeliveryScriptOn } from './delivery.js';
import { DELIVERY_SCRIPT_IDS } from './delivery-core.js';

/**
 * Writing Rules, Delivery Tags (fork): where the instruction is injected, and a checker that shows
 * what the tags turn into at each step, so "is the regex doing anything" has an answer on screen.
 *
 * The checker runs the two regex scripts SillyTavern holds on a sample you can edit. A script that is
 * switched off in SillyTavern would pass the text through unchanged, so a copy with the switch on is
 * run, and the status line above says it is off.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const row = (labelText, control, hint) => {
    const wrap = el('div', 'sillynpc-setting-row');
    const label = el('label', '', labelText);
    if (hint) label.title = hint;
    wrap.append(label, control);
    return wrap;
};

function select(table, value, onChange) {
    const s = el('select', 'text_pole');
    for (const [k, v] of Object.entries(table)) s.append(new Option(v, k));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
}

function number(value, min, max, onChange) {
    const i = el('input', 'text_pole');
    i.type = 'number';
    i.min = String(min);
    i.max = String(max);
    i.value = String(value);
    i.addEventListener('change', () => onChange(Number(i.value)));
    return i;
}

/** The injection controls: where, how far back, which role, order, or SillyTavern's prompt list. */
export function buildDeliveryPlacement(rerender) {
    const wrap = el('div', 'sillynpc-delivery-placement');
    const o = deliveryInject();
    const set = (patch, redraw = false) => {
        getSettings().deliveryInject = normalizeDeliveryInject({ ...deliveryInject(), ...patch });
        saveSettings();
        applyDelivery();
        if (redraw) rerender();
    };

    if (promptListAvailable()) {
        const box = el('input');
        box.type = 'checkbox';
        box.checked = o.inList;
        box.addEventListener('change', () => set({ inList: box.checked }, true));
        const label = el('label', 'checkbox_label');
        label.append(box, el('span', '', "Manage In SillyTavern's Prompt List"));
        wrap.append(label);
    }
    if (!o.inList) {
        wrap.append(row('Where', select(DELIVERY_POSITIONS, o.position, v => set({ position: v }, true))));
        if (o.position === 'chat') wrap.append(row('Messages back', number(o.depth, 0, 100, v => set({ depth: v })), '0 is right after the newest message'));
        wrap.append(row('Role', select(DELIVERY_ROLES, o.role, v => set({ role: v }))));
    } else {
        wrap.append(row('Order', number(o.order, 0, 1000, v => set({ order: v })), 'Blocks at the same depth are sorted by this. The entry\'s position, depth and role are set in the prompt list.'));
    }
    wrap.append(el('small', 'notes', describeDeliveryPlacement(o)));
    return wrap;
}

/** Rebuilds regex output for display, keeping only text and the delivery <span>s. */
function safePreview(html) {
    const out = document.createDocumentFragment();
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const copy = (from, to) => {
        for (const node of from.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) to.append(document.createTextNode(node.nodeValue));
            else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN' && node.classList.contains('wk-tone')) {
                const span = el('span', 'wk-tone');
                span.dataset.tone = String(node.getAttribute('data-tone') || '').replace(/[^a-z0-9_-]/gi, '');
                copy(node, span);
                to.append(span);
            } else copy(node, to);
        }
    };
    copy(doc.body, out);
    return out;
}

const SAMPLE = 'She leaned in close. [whisper]"Stay quiet."[/whisper] Then, louder, [shout, urgent]"Run!"[/shout] He laughed. "Fine." Then, quietly: "I... [pause] don\'t know. [sighs] Really."';

/** The checker: status, a sample, and what each step makes of it. */
export function buildDeliveryChecker() {
    const wrap = el('div', 'sillynpc-delivery-check');
    wrap.append(el('h4', 'sillynpc-combat-heading', 'Check The Tags'));

    const status = deliveryStatus();
    const lines = el('ul', 'sillynpc-delivery-status');
    const item = (ok, text) => { const li = el('li', '', `${ok ? 'Yes' : 'No'} - ${text}`); li.dataset.ok = ok ? '1' : '0'; lines.append(li); };
    item(status.enabled, 'Delivery Tags is on, so the instruction is sent to the story model with each message');
    const scriptSwitch = (id, entry) => {
        if (!entry.installed) return;
        const toggle = el('button', 'menu_button', entry.on ? 'Turn off' : 'Turn on');
        toggle.type = 'button';
        toggle.style.marginLeft = '8px';
        toggle.addEventListener('click', () => {
            setDeliveryScriptOn(id, !entry.on);
            toggle.closest('.sillynpc-delivery-check')?.replaceWith(buildDeliveryChecker());
        });
        lines.lastChild.append(toggle);
    };
    item(status.display.installed && status.display.on, status.display.installed
        ? `the display script is installed and ${status.display.on ? 'on' : 'switched off'} in the Regex list (it shows tagged lines styled)`
        : 'the display script is not installed yet (switching Delivery Tags on installs it)');
    scriptSwitch(DELIVERY_SCRIPT_IDS.display, status.display);
    item(status.inline.installed && status.inline.on, status.inline.installed
        ? `the standalone-tag script is installed and ${status.inline.on ? 'on' : 'switched off'} in the Regex list (it hides [pause], [sighs] and the like in the chat)`
        : 'the standalone-tag script is not installed yet (switching Delivery Tags on installs it)');
    scriptSwitch(DELIVERY_SCRIPT_IDS.inline, status.inline);
    item(status.saver.installed && status.saver.on, status.saver.installed
        ? `the context saver is ${status.saver.on ? 'on: tags (both kinds) and [sfx:] tags are hidden from older messages sent to the model' : 'off: older messages keep their tags when sent to the model'}`
        : 'the context saver is not installed yet');
    // The saver starts off; a button right on its line turns it on, so the answer is not elsewhere on the page.
    if (status.saver.installed) {
        const li = lines.lastChild;
        const toggle = el('button', 'menu_button', status.saver.on ? 'Turn off' : 'Turn on');
        toggle.type = 'button';
        toggle.style.marginLeft = '8px';
        toggle.addEventListener('click', () => {
            getSettings().deliverySaverOn = !status.saver.on;
            saveSettings();
            applyDelivery();
            toggle.closest('.sillynpc-delivery-check')?.replaceWith(buildDeliveryChecker());
        });
        li.append(toggle);
    }
    const engine = engineOf();
    item(engineReadsAudioTags(), `the voice engine (${ENGINES[engine]}) ${engineReadsAudioTags() ? 'reads delivery tags' : 'does not read delivery tags: only the words are spoken'}`);
    wrap.append(lines);
    wrap.append(el('small', 'notes', `The instruction is sent: ${describeDeliveryPlacement(status.inject)}`));

    const sample = el('textarea', 'text_pole');
    sample.rows = 3;
    sample.value = SAMPLE;
    sample.title = 'Edit this, or paste a reply, and press Check.';
    wrap.append(sample);

    const out = el('div', 'sillynpc-delivery-out');
    const button = el('button', 'menu_button', 'Check');
    button.type = 'button';
    button.addEventListener('click', () => {
        out.replaceChildren();
        const text = sample.value;
        const s = deliveryStatus();
        const forced = (script) => (script ? { ...script, disabled: false } : null);

        const block = (title, content) => {
            const box = el('div', 'sillynpc-delivery-block');
            box.append(el('strong', '', title), content);
            out.append(box);
        };

        if (s.display.script) {
            // Both display scripts run in order: wrappers first, then the standalone tags.
            let html = runRegexScript(forced(s.display.script), text);
            if (s.inline.script) html = runRegexScript(forced(s.inline.script), html);
            const shown = el('div', 'sillynpc-delivery-shown');
            shown.append(safePreview(html));
            block(`In the chat${s.display.on ? '' : ' (the script is switched off, so the chat would show the tags as written)'}:`, shown);
            block('The page HTML those scripts make (a standalone tag becomes an empty wk-inline marker):', el('pre', 'snpc-hi-preview', html));
        } else {
            block('In the chat:', el('p', 'notes', 'Nothing yet: the display script is not installed.'));
        }
        if (s.saver.script) {
            const kept = runRegexScript(forced(s.saver.script), text);
            block(`Older messages sent to the model${s.saver.on ? '' : ' (the saver is off, so they are sent exactly as written)'}:`, el('pre', 'snpc-hi-preview', kept));
        }

        const table = toneTable();
        const inline = toneInline();
        const audio = engineReadsAudioTags() && getSettings().ttsToneTags !== false;
        const sent = [];
        for (const m of text.matchAll(/"([^"]+)"/g)) {
            sent.push(speechFor(m[1], { tone: toneAt(text, m.index, table, inline), table, audioTags: audio, inline }));
        }
        block(`Sent to the voice (${ENGINES[engine]}${audio ? ', tags on' : ', tags off'}):`, el('pre', 'snpc-hi-preview', sent.join('\n') || 'No quoted speech in the sample.'));
    });
    wrap.append(button, out);
    return wrap;
}

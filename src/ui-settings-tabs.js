import { getSettings, saveSettings } from './settings.js';
import { pickAndProcessImages, resolveImageFolder, describeSaveDestination } from './utils.js';
import { promptListAvailable } from './prompt-slot.js';
import { applyDialogueFormatPrompt } from './dialogue-format.js';
import { applyDelivery, syncDeliveryScripts } from './delivery.js';
import { buildDeliveryPlacement, buildDeliveryChecker } from './ui-delivery-check.js';
import { buildIdentitySettings } from './ui-identity.js';
import { buildSceneHeaderSettings } from './ui-scene-header-prompt.js';
import { buildSoundSettings } from './ui-sound.js';
import { buildResultInjectionPanel } from './ui-result-injection.js';
import { buildSettingSelect, buildSettingToggle, buildSettingTextArea, buildSettingSlider, buildSettingNumber, updateAllExtensionThemes, applyPortraitFraming, applySpeechPadding } from './ui-shared.js';
import { buildPromptEditor, buildPromptBudget } from './ui-prompts.js';
import { buildContextSaverControls } from './ui-context-savers.js';
import { renderBanList } from './ui-banlist.js';
import { promptById } from './prompts.js';
import { world_names } from '../../../../world-info.js';
import { extension_settings } from '../../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../popup.js';
import { LOG_PREFIX, GEMINI_IMAGE_MODELS, PORTRAIT_SHAPES, debugLog, setDebugLogging, PRODUCT_NAME } from './constants.js';
import { buildLoreExcerpt, resolvePortraitShape, getLastLoreConnection, resolveImageSecretId, scanFolderForCharacterImages, persistGeneratedImage, findOrphanedImages, deleteImageFiles, findAllPortraits, deleteAllPortraits } from './api.js';
import { getSecretLabelById } from '../../../../secrets.js';
import { getRequestHeaders } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { clearRuns } from './default-portraits.js';
import { triggerReprocess } from './chat.js';
import { renderForkSettings, buildStrangerVoices } from './ui-character-extras.js';
import { renderFactionSettings } from './ui-faction.js';
import { renderDeliveryStyles } from './ui-delivery-styles.js';

/**
 * How the chat and the menu look.
 *
 * Was "UI Style", which held the styling but not the four controls that decide whether
 * anything is coloured, whether names are replaced by portraits, or how a portrait is
 * scaled - those were in a tab called Settings, along with the prompts, the popup size and
 * the debug switch. Everything visual is here now.
 */
export function renderAppearanceView(view, onReprocessMessages, updateExtensionTheme) {
    if (!view) return;

    view.replaceChildren();
    const reprocess = () => onReprocessMessages();
    const rerender = () => renderAppearanceView(view, onReprocessMessages, updateExtensionTheme);

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'Chat & Menu Styling';
    view.appendChild(title);
    try { renderFactionSettings(view, rerender); } catch (err) { console.warn('[Worldkit] faction settings failed', err); }
    try { renderDeliveryStyles(view, rerender); } catch (err) { console.warn('[Worldkit] delivery styles failed', err); }

    view.append(buildSettingSlider({
        key: 'menuFontScale',
        label: 'Menu Text Size',
        min: 0.8, max: 1.5, step: 0.05, suffix: 'x',
        help: 'Text in the menus, the character pages and the player sheet, against what '
            + 'the chosen theme sets - so a theme with larger type stays larger.',
        onChange: () => updateAllExtensionThemes(),
    }));
    view.append(buildSettingSlider({
        key: 'trackerFontScale',
        label: 'Tracker Text Size',
        min: 0.8, max: 1.5, step: 0.05, suffix: 'x',
        help: 'Text in the status box in the chat. Separate from the menus because the box '
            + 'sits in the middle of the story and competes with the prose around it - '
            + 'wanting it smaller there is not wanting the settings smaller too.',
        onChange: reprocess,
    }));
    view.append(buildSettingSelect({ key: 'dividerStyle', label: 'Speech Block Dividers', options: [{value:'subtle',label:'Subtle Fade'},{value:'bold',label:'Solid Accent'},{value:'dashed',label:'Dashed Line'},{value:'none',label:'No Dividers'}], onChange: reprocess }));
    view.append(buildSettingSlider({
        key: 'speechPadY',
        label: 'Speech Block Spacing',
        min: 0, max: 30, step: 1, suffix: 'px',
        help: 'Space above and below each character block. The width of the coloured band '
            + 'is fixed; only its height changes here.',
        onChange: () => { applySpeechPadding(); reprocess(); },
    }));

    const colourHeading = document.createElement('h3');
    colourHeading.className = 'sillynpc-section-title';
    colourHeading.style.marginTop = '20px';
    colourHeading.textContent = 'Colour';
    view.append(colourHeading);

    view.append(buildSettingToggle({
        key: 'applyColors',
        label: 'Enable Colored Chat Blocks',
        help: 'The master switch for colour in the chat: with it off nothing is tinted, and '
            + 'any colour the model wrote into its own reply is left showing through. On, a '
            + 'speaker\'s dialogue carries their colour in the style set below.',
        onChange: rerender,
    }));
    // Only while there is colouring for them to affect. Both decide how colour is applied
    // rather than whether it happens, so with the switch above off they do nothing at all -
    // and a live-looking control that does nothing is worse than one that is absent.
    if (getSettings().applyColors) {
        view.append(buildSettingSelect({ key: 'colorStyle', label: 'Character Coloring Logic', options: [{value:'text',label:'Text Only'},{value:'background',label:'Soft Background'},{value:'border',label:'Left Border Accent'},{value:'gradient',label:'Subtle Gradient'},{value:'all',label:'Full Highlight (Strong)'}], onChange: reprocess }));
        view.append(buildSettingToggle({
            key: 'autoColorUnknownSpeakers',
            label: 'Colour Speakers Without A Card',
            help: 'A card\'s own colour always wins, so this is only about everybody else. '
                + 'On, anyone who speaks gets a shade derived from their name - the same '
                + 'name always the same shade. Off, a colour is what marks the characters '
                + 'you have made a card for.',
            onChange: reprocess,
        }));
    }

    const portraitHeading = document.createElement('h3');
    portraitHeading.className = 'sillynpc-section-title';
    portraitHeading.style.marginTop = '20px';
    portraitHeading.textContent = 'Portraits In The Chat';
    view.append(portraitHeading);

    view.append(buildSettingSelect({ key: 'avatarShape', label: 'Chat Avatar Shape', options: [{value:'square',label:'Sharp Square'},{value:'rounded',label:'Rounded Corners'},{value:'circle',label:'Perfect Circle'}], onChange: reprocess }));
    view.append(buildSettingSelect({ key: 'avatarSize', label: 'Chat Avatar Size', options: [{value:'small',label:'Small (44px)'},{value:'medium',label:'Medium (64px)'},{value:'large',label:'Large (96px)'},{value:'extra',label:'Extra Large (132px)'}], onChange: reprocess }));
    view.append(buildSettingSelect({ key: 'defaultImageFit', label: 'Avatar Image Scaling', options: [{value:'contain',label:'Fit within frame (Contain)'},{value:'cover',label:'Fill frame completely (Cover)'}], onChange: reprocess }));
    view.append(buildSettingToggle({
        key: 'hideSpeakerNames',
        label: 'Hide Default Speaker Names',
        help: 'Replaces the bold name before a colon with that character\'s portrait. Only '
            + 'where there is a card to supply one: a speaker without a card keeps their '
            + 'name, since telling two of them apart is what the name is doing.',
        onChange: reprocess,
    }));

    renderDefaultView(view, rerender);
}

/**
 * What the model is asked to write, and how what it writes is read back.
 *
 * A tab of its own because these three - the dialogue format, the narrator rules and the
 * ban list - are one job done three ways, and they were scattered across two tabs, one of
 * which was called Settings and held the popup size as well.
 *
 * The reading half belongs with them rather than with the styling: "Not Speakers" and
 * lenient matching decide what counts as somebody talking, which is the same question the
 * dialogue format asks the model to make easy.
 */
export function renderWritingRulesView(view, onReprocessMessages) {
    if (!view) return;

    view.replaceChildren();
    const reprocess = () => onReprocessMessages();
    const rerender = () => renderWritingRulesView(view, onReprocessMessages);

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'What The Model Is Asked To Write';
    view.appendChild(title);

    const intro = document.createElement('p');
    intro.className = 'notes sillynpc-tab-intro';
    intro.textContent = 'Everything here is sent with your messages, and each is placed '
        + 'rather than merely worded: where an instruction sits in the prompt decides '
        + 'whether it holds. Only the dialogue format is on to begin with, because the '
        + 'rest of the extension reads what it asks for.';
    view.appendChild(intro);

    const formatHeading = document.createElement('h4');
    formatHeading.className = 'sillynpc-subsection-title';
    formatHeading.textContent = 'Dialogue Formatting';
    view.append(formatHeading);

    view.append(buildSettingToggle({
        key: 'dialogueFormatEnabled',
        label: 'Ask The Model To Format Dialogue',
        help: 'Sends the Dialogue Format prompt with every message, asking for a speaker '
            + 'line - the name in brackets before each line, like \u27e6Name\u27e7 "Hello." - which is what avatars, speech '
            + 'blocks and colours all read. Without it, whether your chat is decorated '
            + 'depends on your persona or preset happening to ask for the same thing, and '
            + 'switching either one silently stops all of it.',
        onChange: rerender,
    }));
    if (getSettings().dialogueFormatEnabled) {
        view.append(buildPromptEditor(promptById('dialogueFormat')));
        if (promptListAvailable()) {
            view.append(buildSettingToggle({
                key: 'dialogueFormatInPromptList',
                label: "Manage In SillyTavern's Prompt List",
                help: "Puts the dialogue format into SillyTavern's own prompt list, under AI Response Configuration, where it can be dragged among the system prompts, given another depth, or switched off beside everything else. It goes in as In-Chat at depth 0, which is where it already sits, so switching this on moves nothing until you move it. The entry is kept in your chat completion preset: it is exported with that preset, and loading a different one drops it until Worldkit puts it back. The text stays here - the list owns only where it goes and whether it is sent. Chat Completion only: there is no such list on Text Completion.",
                onChange: () => {
                    // At once rather than at the next message: the list entry is
                    // what makes the block appear there at all, and a setting whose
                    // effect waits for a send reads as a setting that did nothing.
                    applyDialogueFormatPrompt();
                    rerender();
                },
            }));
        }
        // Hidden rather than disabled when the list owns the block. There is no extension
        // injection left to give a depth to then - the entry in the list is the injection,
        // and its own depth field is the one that means anything.
        if (!getSettings().dialogueFormatInPromptList) view.append(buildSettingNumber({
            key: 'dialogueFormatDepth',
            advanced: true,
            label: 'Format Reminder Depth',
            suffix: 'messages back',
            help: 'How far back from the newest message the prompt above is inserted. 0 '
                + 'puts it after the newest one, so it is the last thing the model reads '
                + 'before answering - which is where a layout rule holds best, and why it '
                + 'is the default. Raise it only if it crowds something you would rather '
                + 'have last.',
        }));
    }

    const deliveryHeading = document.createElement('h4');
    deliveryHeading.className = 'sillynpc-subsection-title';
    deliveryHeading.textContent = 'Delivery Tags';
    view.append(deliveryHeading);
    const appearanceNote = document.createElement('small');
    appearanceNote.className = 'notes';
    appearanceNote.textContent = 'How tagged lines look (size, weight, spacing, font, underline, effects) is set in the Appearance tab, under Tonal Typography. '
        + 'The same place lets you hear each tag with an ElevenLabs voice. This page only decides whether the tags are used and what the model is told.';
    view.append(appearanceNote);
    view.append(buildSettingToggle({
        key: 'deliveryTagsEnabled',
        label: 'Ask The Model To Mark How Lines Are Said',
        help: 'The model wraps a line in a delivery tag when it is said in a notable way, like [whisper]"I know."[/whisper]. '
            + 'The saved message keeps the tags; two SillyTavern regex scripts (see the Regex list) show them styled and the look '
            + 'of each is set under Appearance. A voice that understands them (Eleven v4, v4 Turbo, v3) is told the delivery with the '
            + 'closing tag dropped; any other voice reads only the words. Smaller models sometimes forget a tag, and then the line shows plain.',
        onChange: () => { applyDelivery({ force: true }); rerender(); },
    }));
    if (getSettings().deliveryTagsEnabled) {
        view.append(buildPromptEditor(promptById('deliveryTags')));
        view.append(buildDeliveryPlacement(rerender));
        view.append(buildSettingToggle({
            key: 'deliverySaverOn',
            label: 'Hide Delivery Tags From The Model In Older Messages',
            help: 'Takes the tags out of what is sent back to the model, from the depth below. Saves a few tokens a turn; the model then sees '
                + 'fewer examples of its own tags, so it may use them less.',
            onChange: () => { syncDeliveryScripts(); },
        }));
        view.append(buildSettingNumber({
            key: 'deliverySaverDepth',
            advanced: true,
            label: 'Hide From This Many Messages Back',
            suffix: 'messages back',
            help: '2 keeps the tags on the newest reply and removes them from older ones.',
            onChange: () => { syncDeliveryScripts(); },
        }));
        view.append(buildDeliveryChecker());
    }

    view.append(buildIdentitySettings(rerender));

    // The scene header: the Scene module reads the date, time, place and weather from it.
    try { view.append(buildSceneHeaderSettings(rerender)); } catch (err) { console.warn('[Worldkit] scene header settings failed', err); }

    // Sound effects: [sfx:name] chips.
    try { view.append(buildSoundSettings(rerender)); } catch (err) { console.warn('[Worldkit] sound settings failed', err); }

    // Knives (saved story twists kept on each character): when one is offered to the story. The twists themselves are on the profile.
    const knivesHeading = document.createElement('h4');
    knivesHeading.className = 'sillynpc-subsection-title';
    knivesHeading.textContent = 'Knives';
    view.append(knivesHeading);
    try { view.append(buildResultInjectionPanel('knives')); } catch (err) { console.warn('[Worldkit] knives settings failed', err); }

    const banHeading = document.createElement('h4');
    banHeading.className = 'sillynpc-subsection-title';
    banHeading.textContent = 'Ban List';
    view.append(banHeading);

    view.append(buildSettingToggle({
        key: 'banListEnabled',
        label: 'Stop The Model Repeating Itself',
        help: 'Phrases you have banned are sent to the sampler where your backend takes '
            + 'them, which means the model cannot write them - not that it is asked not '
            + 'to. On an API that has no such thing they are asked for in the prompt '
            + 'instead, and the panel says which of the two you are getting.',
        onChange: rerender,
    }));
    if (getSettings().banListEnabled) {
        const banPanel = document.createElement('div');
        view.append(banPanel);
        renderBanList(banPanel);

        view.append(buildSettingNumber({
            key: 'banScanDepth',
            advanced: true,
            label: 'Scan Depth',
            suffix: 'replies',
            help: 'How many of the model\'s own replies the scan reads. Your own messages '
                + 'are skipped - your habits are not what this is for. 0 reads the whole '
                + 'chat, which costs more and finds older habits.',
        }));
    }

    const readingHeading = document.createElement('h3');
    readingHeading.className = 'sillynpc-section-title';
    readingHeading.style.marginTop = '24px';
    readingHeading.textContent = 'How Its Writing Is Read';
    view.append(readingHeading);

    const readingNote = document.createElement('p');
    readingNote.className = 'notes sillynpc-tab-intro';
    readingNote.textContent = 'The other side of the same question: which of the words in a '
        + 'reply are somebody speaking.';
    view.append(readingNote);

    view.append(buildSettingSelect({
        key: 'speakerDetection',
        label: 'Speaker Detection',
        help: 'Speaker Tag reads only the tag the model is asked to write at the start of a '
            + 'line, so a name in prose, or bold text from another extension, is never '
            + 'taken for somebody speaking. Tag And Legacy also keeps the bold-colon and '
            + 'name-in-prose matching, which is what to pick for chats written before the '
            + 'tag existed.',
        options: [
            { value: 'marker', label: 'Speaker Tag only' },
            { value: 'both', label: 'Tag and legacy styles' },
            { value: 'legacy', label: 'Legacy styles only (upstream)' },
        ],
        onChange: () => { reprocess(); rerender(); },
    }));
    if (getSettings().speakerDetection !== 'legacy') {
        view.append(buildMarkerPairControl(() => { reprocess(); rerender(); }));
    }

    view.append(buildSettingTextArea({
        key: 'speakerIgnoreList',
        label: 'Not Speakers',
        help: 'Words the narrator writes in bold before a colon that are not people - DC, '
            + 'Cost, Damage, Roll. One per line or separated by commas. Everything you '
            + 'named in System Builder is already excluded, so stats and collections need '
            + 'no entry here. A character who has a card is never ignored.',
        onChange: reprocess,
    }));
    view.append(buildSettingToggle({
        key: 'caseInsensitive',
        label: 'Lenient Name Matching',
        help: 'Matches character names regardless of uppercase/lowercase letters.',
        onChange: reprocess,
    }));

    renderForkSettings(view, () => { reprocess(); rerender(); });
}

/**
 * The extension itself: whether it runs, how big its menu is, and how to see what it does.
 *
 * What is left of a tab called Settings once everything that belonged to a subject went to
 * that subject's tab. These four genuinely belong to no feature.
 *
 * @param {HTMLElement} view
 * @param {{ applyPopupSize: () => void, onExport: () => void, onImport: () => void }} handlers
 */
export function renderAdvancedView(view, handlers = {}) {
    if (!view) return;
    const { applyPopupSize, onExport, onImport } = handlers;

    view.replaceChildren();
    // Dev mode changes which controls exist, so the panel is drawn again rather than left
    // showing the answer to the previous question.
    const rerender = () => renderAdvancedView(view, handlers);

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = PRODUCT_NAME;
    view.appendChild(title);

    view.append(buildSettingToggle({
        key: 'enabled',
        label: 'Enable Worldkit',
        help: 'The master switch. Off, nothing is decorated, no prompt is sent and the '
            + 'tracker reads nothing - your characters and everything they hold are kept.',
        onChange: () => triggerReprocess(),
    }));

    view.append(buildSettingToggle({
        key: 'devMode',
        label: 'Show Every Setting',
        help: 'Eighteen settings are hidden to begin with: reply budgets, transcript sizes, '
            + 'prompt depths, and the two that can lose an update if set wrong. Their '
            + 'defaults are right until something specific goes wrong, and meeting all '
            + 'eighty-one at once is how the useful ones get lost among them. Nothing is '
            + 'removed - this shows them again, on every tab.',
        onChange: () => rerender(),
    }));

    view.append(buildContextSaverControls());

    const sizeHeading = document.createElement('h3');
    sizeHeading.className = 'sillynpc-section-title';
    sizeHeading.style.marginTop = '20px';
    sizeHeading.textContent = 'Menu Size';
    view.append(sizeHeading);

    view.append(buildSettingSlider({ key: 'popupWidth', label: 'Menu Width', min: 20, max: 100, suffix: 'vw', help: 'Width relative to screen size.', onChange: () => applyPopupSize?.() }));
    view.append(buildSettingSlider({ key: 'popupHeight', label: 'Menu Height', min: 20, max: 100, suffix: 'vh', help: 'Height relative to screen size.', onChange: () => applyPopupSize?.() }));

    const backupHeading = document.createElement('h3');
    backupHeading.className = 'sillynpc-section-title';
    backupHeading.style.marginTop = '20px';
    backupHeading.textContent = 'Backup';
    view.append(backupHeading);

    const backupNote = document.createElement('p');
    backupNote.className = 'notes sillynpc-tab-intro';
    backupNote.textContent = 'Everything at once - every character, every setting, every '
        + 'System. Importing one replaces all of it, so this is a backup rather than a way '
        + 'to share: to send somebody a single character, use Export on their page.';
    view.append(backupNote);

    const backupRow = document.createElement('div');
    backupRow.className = 'sillynpc-backup-row';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'menu_button';
    exportBtn.innerHTML = '<i class="fa-solid fa-file-export"></i> <span>Export everything</span>';
    exportBtn.addEventListener('click', () => onExport?.());

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'menu_button';
    importBtn.innerHTML = '<i class="fa-solid fa-file-import"></i> <span>Import a backup</span>';
    importBtn.addEventListener('click', () => onImport?.());

    backupRow.append(exportBtn, importBtn);
    view.append(backupRow);

    const portraitHeading = document.createElement('h3');
    portraitHeading.className = 'sillynpc-section-title';
    portraitHeading.style.marginTop = '20px';
    portraitHeading.textContent = 'Portraits';
    view.append(portraitHeading);

    const portraitNote = document.createElement('p');
    portraitNote.className = 'notes sillynpc-tab-intro';
    portraitNote.textContent = 'New portraits are saved in user/images/world-kit. This clears the picture lists of every '
        + 'character and of you, and deletes the files (the older user/images/sillynpc folder too). The cards themselves, '
        + 'and the faces for strangers, stay.';
    view.append(portraitNote);

    const wipeBtn = document.createElement('button');
    wipeBtn.type = 'button';
    wipeBtn.className = 'menu_button';
    wipeBtn.innerHTML = '<i class="fa-solid fa-trash"></i> <span>Delete all character portraits</span>';
    wipeBtn.addEventListener('click', async () => {
        wipeBtn.disabled = true;
        try {
            const found = await findAllPortraits();
            if (!found.files.length) {
                toastr.info('There are no portrait files to delete.', PRODUCT_NAME);
                return;
            }
            const ok = await Popup.show.confirm('Delete all character portraits?', `${found.files.length} picture file${found.files.length === 1 ? '' : 's'} will be deleted and every character's portrait list emptied. This cannot be undone.`);
            if (!ok) return;
            const { deleted, failed } = await deleteAllPortraits(found.files);
            toastr[failed ? 'warning' : 'success'](`${deleted} deleted${failed ? `, ${failed} could not be deleted` : ''}.`, PRODUCT_NAME);
        } catch (err) {
            console.error(LOG_PREFIX, 'Could not delete portraits', err);
            toastr.error(String(err.message || err), PRODUCT_NAME);
        } finally {
            wipeBtn.disabled = false;
        }
    });
    view.append(wipeBtn);

    const troubleshooting = document.createElement('h3');
    troubleshooting.className = 'sillynpc-section-title';
    troubleshooting.style.marginTop = '20px';
    troubleshooting.textContent = 'Troubleshooting';
    view.append(troubleshooting);

    view.append(buildSettingToggle({
        key: 'debugLogging',
        label: 'Log Requests To The Console',
        help: 'Prints one line in the browser console for every request Worldkit makes - '
            + 'lore, portraits and the tracker readers - naming the connection, the model and which '
            + 'API key it used. Off by default because the tracker readers can run after every message. '
            + 'Open the console with F12.',
        onChange: () => setDebugLogging(getSettings().debugLogging),
    }));
}

/**
 * The pool of faces for speakers who have none.
 *
 * Was one picture and a Browse button. One picture meant every stranger in the story wore
 * the same face, which is worse than no picture at all - it says these are all one person.
 *
 * @param {HTMLElement} view
 * @param {() => void} rerender
 */
export function renderDefaultView(view, rerender) {
    if (!view) return;

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'Faces For Strangers';
    view.appendChild(title);

    const help = document.createElement('p');
    help.className = 'notes sillynpc-pool-note';
    help.textContent = 'Anybody who speaks without a card of their own wears one of these, '
        + 'and so does a character whose card has no portrait yet. Add as many as you like: '
        + 'with only one, every stranger in the story is the same face.';
    view.appendChild(help);

    const sticky = document.createElement('p');
    sticky.className = 'notes sillynpc-pool-note';
    sticky.textContent = 'A face is drawn once and kept, not picked again on every redraw. '
        + 'A stranger holds theirs while they keep appearing and draws a new one if they '
        + 'turn up again much later - the guard you talk to for three messages is one '
        + 'guard, and the guard two hundred messages later is somebody else. A character '
        + 'with a card keeps theirs for good, until you give them a portrait.';
    view.appendChild(sticky);

    const pool = Array.isArray(getSettings().defaultImages) ? getSettings().defaultImages : [];

    view.appendChild(buildStrangerVoices());

    const grid = document.createElement('div');
    grid.className = 'sillynpc-pool-grid';

    if (pool.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'notes sillynpc-pool-empty';
        empty.textContent = 'No faces yet. Until there is at least one, a speaker with no '
            + 'card gets the plain silhouette.';
        grid.appendChild(empty);
    }

    // Sorted by gender for reading only: removal below goes by the entry itself, so the
    // order the list is stored in does not change.
    const rank = (entry) => (entry.gender === 'female' ? 0 : entry.gender === 'male' ? 1 : 2);
    const heading = ['Female', 'Male', 'Unsorted'];
    let lastRank = -1;
    const shown = pool.map((entry, index) => ({ entry, index }))
        .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index);

    shown.forEach(({ entry }) => {
        if (rank(entry) !== lastRank) {
            lastRank = rank(entry);
            const label = document.createElement('div');
            label.className = 'sillynpc-pool-group';
            label.textContent = heading[lastRank];
            grid.appendChild(label);
        }
        const cell = document.createElement('div');
        cell.className = 'sillynpc-pool-cell';

        const frame = document.createElement('div');
        frame.className = 'sillynpc-pool-frame';
        const img = document.createElement('img');
        img.src = entry.src;
        img.alt = '';
        frame.appendChild(img);
        cell.appendChild(frame);

        // Free text rather than a fixed vocabulary: what a world is full of is the world's
        // business. Matched against the words in a speaker's name and a card's category.
        const tags = document.createElement('input');
        tags.type = 'text';
        tags.className = 'text_pole sillynpc-pool-tags';
        tags.placeholder = 'guard, soldier';
        tags.title = 'Words that decide who can draw this face. A speaker whose name or '
            + 'category contains one of them draws from the tagged faces only.';
        tags.value = (entry.tags || []).join(', ');
        tags.addEventListener('change', () => {
            entry.tags = tags.value.split(',').map(t => t.trim()).filter(Boolean);
            saveSettings();
        });
        cell.appendChild(tags);

        const gender = document.createElement('select');
        gender.className = 'text_pole sillynpc-pool-gender';
        gender.title = 'Female and male faces are drawn by speakers whose name says so '
            + '(Female Soldier, Old Man). They also decide which generic voice a stranger uses.';
        for (const [value, text] of [['', 'Gender: unsorted'], ['female', 'Female'], ['male', 'Male']]) {
            gender.append(new Option(text, value));
        }
        gender.value = entry.gender || '';
        gender.addEventListener('change', () => {
            entry.gender = gender.value;
            saveSettings();
            rerender?.();
        });
        cell.appendChild(gender);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'menu_button sillynpc-pool-remove';
        remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        remove.title = 'Take this face out of the pool.';
        remove.addEventListener('click', () => {
            const at = getSettings().defaultImages.indexOf(entry);
            if (at !== -1) getSettings().defaultImages.splice(at, 1);
            saveSettings();
            // Anybody already wearing it is given another the next time they are drawn;
            // faceForCard checks that the face it remembers is still in the pool.
            rerender?.();
        });
        cell.appendChild(remove);

        grid.appendChild(cell);
    });

    view.appendChild(grid);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'menu_button';
    addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> <span>Add faces</span>';
    addBtn.title = 'Choose one or several pictures at once.';
    addBtn.addEventListener('click', async () => {
        // Full size, because these are written to disk like any other portrait rather than
        // stored inline - the small cap only ever cost quality.
        const picked = await pickAndProcessImages({ fullSize: true });
        if (!picked.length) return;

        addBtn.disabled = true;
        try {
            const settings = getSettings();
            if (!Array.isArray(settings.defaultImages)) settings.defaultImages = [];
            for (const dataUri of picked) {
                const stored = await persistGeneratedImage(dataUri, 'default');
                settings.defaultImages.push({ src: stored, tags: [], gender: '' });
            }
            saveSettings();
        } catch (err) {
            console.error(LOG_PREFIX, 'Could not add fallback portraits', err);
            toastr.error(String(err.message || err), PRODUCT_NAME);
        } finally {
            addBtn.disabled = false;
            rerender?.();
        }
    });
    view.appendChild(addBtn);

    // Only worth asking once there is more than one face to swap between.
    if (pool.length > 1) {
        view.appendChild(buildSettingNumber({
            key: 'defaultPortraitRunGap',
            label: 'A Stranger Is Somebody New After',
            suffix: 'messages away',
            help: 'How long a stranger can be absent before the next sighting draws a new '
                + 'face. Lower means a busier world of one-off faces; higher means the same '
                + 'stranger is remembered across a longer stretch of story.',
        }));

        const forget = document.createElement('button');
        forget.type = 'button';
        forget.className = 'menu_button';
        forget.innerHTML = '<i class="fa-solid fa-arrow-rotate-left"></i> <span>Redraw every face in this chat</span>';
        forget.title = 'Forgets which face this chat gave to whom, so everybody draws again.';
        forget.addEventListener('click', async () => {
            const ok = await Popup.show.confirm('Redraw every face',
                'Everybody without a card of their own draws a new face. Nothing else changes.');
            if (!ok) return;
            clearRuns();
            triggerReprocess();
            rerender?.();
        });
        view.appendChild(forget);
    }
}

/**
 * The two strings the speaker tag is written between.
 *
 * Changing them does not rewrite the Dialogue Format prompt, because that text may be
 * yours - the button beside it does, on request. Rewriting it silently would throw away
 * edits, and leaving it silently would ask the model for one tag while reading another.
 *
 * @param {() => void} onChange Redraws the chat.
 * @returns {HTMLElement}
 */
function buildMarkerPairControl(onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    wrap.dataset.setting = 'speakerMarkerPair';

    const row = document.createElement('div');
    row.className = 'sillynpc-setting-row';
    const label = document.createElement('label');
    label.className = 'sillynpc-setting-label';
    label.textContent = 'Speaker Tag Brackets';
    row.append(label);

    const make = (key, placeholder) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'text_pole';
        input.style.width = '5em';
        input.maxLength = 8;
        input.placeholder = placeholder;
        input.value = getSettings()[key] ?? '';
        input.addEventListener('change', () => {
            getSettings()[key] = input.value.trim();
            saveSettings();
            onChange();
        });
        return input;
    };
    row.append(make('speakerMarkerOpen', 'open'), make('speakerMarkerClose', 'close'));
    wrap.append(row);

    const help = document.createElement('small');
    help.className = 'notes';
    help.style.cssText = 'display:block; margin-top:4px;';
    help.textContent = 'The pair the speaker name is written between. After changing it, '
        + 'press Restore Recommended under Dialogue Format so the model is asked for the '
        + 'same pair that is being read.';
    wrap.append(help);
    return wrap;
}

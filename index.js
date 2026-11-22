import { hasReadableText } from './src/message-content.js';
import { eventSource, event_types } from '../../../events.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { LOG_PREFIX, extensionName, debugLog, PRODUCT_NAME } from './src/constants.js';
import { getContext } from '../../../st-context.js';
import { initSettings, loadCharacters, saveSettings, getSettings } from './src/settings.js';
import { repairDefaultImages } from './src/default-portraits.js';
import { 
    openManagePopup
} from './src/ui-manage.js';
import {
    reprocessAllMessages,
    reprocessMessage,
    setReprocessCallback,
    triggerReprocess,
    invalidateChatRender,
} from './src/chat.js';
import {
    createCharacter, addAlias, addCharacterToChat,
    CAST_KEY, setChatCast, getAllCategories, UNCATEGORISED,
} from './src/characters.js';
import { tryAutoSyncLorebook, syncLorebookScope, repairEntryIdentities } from './src/lorebook.js';
import { initStatusLogic, hasOpenChat } from './src/status-logic.js';
import { openPlayerModal } from './src/ui-player-modal.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { applyPortraitFraming, applySpeechPadding } from './src/ui-shared.js';
import { applyCheckpointSchedule } from './src/status-logic.js';
import { noteActivatedLore } from './src/activated-lore.js';
import { setDebugLogging } from './src/constants.js';
import { describeChatConnection } from './src/utils.js';
import { applyDialogueFormatPrompt } from './src/dialogue-format.js';
import { applyDeliveryPrompt, syncDeliveryScripts, applyDeliveryStyle, ensureDeliveryScriptsOn } from './src/delivery.js';
import { reloadCurrentChat } from '../../../../script.js';
import { placeWritingPrompt } from './src/prompt-slot.js';
import { applyBanList } from './src/banlist.js';
import { applyHistoryInjection } from './src/history-inject.js';
import { initTts } from './src/tts.js';
import { primeLore } from './src/profile-text.js';
import { initInternalStates } from './src/internal-states.js';
import { initBonds } from './src/bonds.js';
import { initVitals } from './src/vitals.js';
import { initThreads } from './src/threads-runtime.js';
import { initResultInjection } from './src/result-runtime.js';
import { initVitalsSection } from './src/vitals-section.js';
import { initInventory } from './src/inventory.js';
import { initIdentity } from './src/identity.js';
import { initSceneHeaderPrompt } from './src/scene-header-inject.js';
import { initSound } from './src/sound-runtime.js';
import { initInventorySection } from './src/inventory-section.js';
import { initVectors } from './src/vectors.js';
import { recordModuleLoad } from './src/module-panes.js';
import { initImagePromptInjection } from './src/image-prompts.js';

function onMessageRendered(messageId) {
    try {
        const mesEl = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        reprocessMessage(mesEl);

        // If "showOnlyAtBottom" is enabled, we need to reprocess the previous message
        // to ensure its tracker is removed now that there's a new message.
        if (getSettings().statusTracker?.showOnlyAtBottom) {
            const prevMesId = Number(messageId) - 1;
            if (prevMesId >= 0) {
                const prevMesEl = document.querySelector(`#chat .mes[mesid="${prevMesId}"]`);
                if (prevMesEl) reprocessMessage(prevMesEl);
            }
        }
    } catch (err) {
        console.error(LOG_PREFIX, 'onMessageRendered error', err);
    }
}

/** Swiping between replies rewrites the message in place, so it is decorated again. */
function onSwipe(messageId) {
    onMessageRendered(messageId);
}

async function addSettingsPanel() {
    try {
        const html = await renderExtensionTemplateAsync(extensionName, 'index');
        $('#extensions_settings2').append(html);

        document.getElementById('sillynpc-open-manage')?.addEventListener('click', () => {
            openManagePopup().catch(err => console.error(LOG_PREFIX, 'openManagePopup failed', err));
        });
    } catch (err) {
        console.error(LOG_PREFIX, 'failed to load settings panel', err);
    }
    addWandMenuEntry();
}

/** An entry in the wand menu beside the chat box, so the menu opens without going through Extensions. */
function addWandMenuEntry() {
    try {
        const menu = document.getElementById('extensionsMenu');
        if (!(menu instanceof HTMLElement) || document.getElementById('sillynpc_wand_button')) return;
        const item = document.createElement('div');
        item.id = 'sillynpc_wand_button';
        item.classList.add('list-group-item', 'flex-container', 'flexGap5');
        item.title = `Open ${PRODUCT_NAME}`;
        const icon = document.createElement('div');
        icon.classList.add('fa-solid', 'fa-dice-d20', 'extensionsMenuExtensionButton');
        const label = document.createElement('span');
        label.textContent = PRODUCT_NAME;
        item.append(icon, label);
        item.addEventListener('click', () => {
            openManagePopup().catch(err => console.error(LOG_PREFIX, 'openManagePopup failed', err));
        });
        menu.append(item);
        // Games, Combat and the Phone have their own floating buttons (src/floating-buttons.js), not wand entries.
    } catch (err) {
        console.error(LOG_PREFIX, 'failed to add the wand menu entry', err);
    }
}

/**
 * Wire global click handling for injected avatars: your own portrait opens your sheet,
 * existing characters open their editor, default-image avatars prompt to create a card
 * for the speaker.
 */
function wireAvatarClicks() {
    document.addEventListener('click', async (e) => {
        const avatar = e.target.closest?.('.sillynpc-chat-avatar');
        if (!avatar) return;
        e.preventDefault();
        e.stopPropagation();

        // Checked before the card, because the avatar is drawn that way round too: this
        // name is you, so it opens your sheet even if a card of the name exists.
        if (avatar.dataset.persona) {
            openPlayerModal();
            return;
        }

        const charId = avatar.dataset.charId;
        if (charId) {
            await openManagePopup({ tab: 'characters', charId });
            return;
        }

        // Default-image case: this name has no card. Offer both readings of that - a
        // person nobody has carded yet, or another name for somebody already carded.
        const speakerName = avatar.dataset.charName || '';
        const choice = await askAboutUnknownSpeaker(speakerName);
        if (!choice) return;

        if (choice.aliasOf) {
            // Someone you are aliasing was spoken here, so they belong here.
            addCharacterToChat(choice.aliasOf);
            if (addAlias(choice.aliasOf, speakerName)) triggerReprocess();
            return;
        }

        const char = createCharacter(speakerName);
        // Created from this chat, so it is a member of it whatever the chat is scoped to -
        // otherwise the card you just made would be invisible in the chat that prompted it.
        addCharacterToChat(char.id);
        if (speakerName) {
            await tryAutoSyncLorebook(char);
        }
        saveSettings();
        await openManagePopup({ tab: 'characters', charId: char.id });
    });
}

/**
 * Asks what an uncarded speaker actually is.
 *
 * @param {string} speakerName
 * @returns {Promise<{ aliasOf: string|null }|null>} Null when dismissed.
 */
async function askAboutUnknownSpeaker(speakerName) {
    const existing = getSettings().characters.filter(c => c.name);

    const wrap = document.createElement('div');
    const question = document.createElement('p');
    question.textContent = speakerName
        ? `"${speakerName}" has no character card.`
        : 'This speaker has no character card.';
    wrap.append(question);

    // With nobody to alias to, the old single question is still the right one.
    if (!existing.length || !speakerName) {
        return await Popup.show.confirm(question.textContent, 'Create a character card?')
            ? { aliasOf: null }
            : null;
    }

    const select = document.createElement('select');
    select.className = 'text_pole';
    select.style.width = '100%';

    const createOption = document.createElement('option');
    createOption.value = '';
    createOption.textContent = 'Create a new character card';
    select.append(createOption);

    const group = document.createElement('optgroup');
    group.label = `Or record "${speakerName}" as another name for…`;
    for (const char of existing) {
        const option = document.createElement('option');
        option.value = char.id;
        option.textContent = char.name;
        group.append(option);
    }
    select.append(group);
    wrap.append(select);

    const help = document.createElement('small');
    help.className = 'notes';
    help.style.cssText = 'display:block; margin-top:8px;';
    help.textContent = 'An alias makes both names resolve to the same character '
        + 'everywhere - the tracker, the lorebook and the scene cast, not only the avatar.';
    wrap.append(help);

    const result = await new Popup(wrap, POPUP_TYPE.CONFIRM, '', {
        okButton: 'OK', cancelButton: 'Cancel',
    }).show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;

    return { aliasOf: select.value || null };
}

jQuery(async () => {
    try {
        initSettings();
        // The characters live in their own file: read it before anything looks at them.
        await loadCharacters();
        // Before the first request, so a saved choice is in force for it.
        setDebugLogging(getSettings().debugLogging);
        // Before anything draws a portrait. The stylesheet falls back to `top` on its own,
        // so this only matters for a saved choice other than the default.
        applyPortraitFraming();
        applySpeechPadding();
        // Starts the interval save if one is configured; harmless when it is not.
        applyCheckpointSchedule();
        // Not awaited: a fallback portrait still held inside settings.json works exactly
        // as it is, so nothing needs to wait for it to become a file on disk. Failures are
        // logged and tried again next time.
        repairDefaultImages().catch(err => console.warn(LOG_PREFIX, 'Portrait repair failed', err));
        initStatusLogic();
        // Narrator Rules was removed: take out whatever an earlier version left in the prompt or the prompt list.
        try { placeWritingPrompt('sillynpc-narrator-rules', '', { inList: false }); } catch (err) { debugLog('Narrator rules cleanup failed', err); }
        setReprocessCallback(reprocessAllMessages);
        await addSettingsPanel();
        wireAvatarClicks();
        try {
            initTts();
            try { syncDeliveryScripts(); applyDeliveryStyle(); } catch (err) { debugLog('Delivery tag scripts not synced', err); }
            initImagePromptInjection();
            initInternalStates();
            // Its own guard: a bonds fault must not stop the modules registered after it.
            try {
                initBonds();
            } catch (bondsErr) {
                console.error(LOG_PREFIX, 'initBonds failed', bondsErr);
            }
            try {
                initVitals();
                initVitalsSection();
            } catch (vitalsErr) {
                console.error(LOG_PREFIX, 'initVitals failed', vitalsErr);
            }
            try {
                initInventory();
                initInventorySection();
            } catch (inventoryErr) {
                console.error(LOG_PREFIX, 'initInventory failed', inventoryErr);
            }
            try {
                initIdentity();
            } catch (identityErr) {
                console.error(LOG_PREFIX, 'initIdentity failed', identityErr);
            }
            try {
                initSceneHeaderPrompt();
            } catch (headerErr) {
                console.error(LOG_PREFIX, 'initSceneHeaderPrompt failed', headerErr);
            }
            try {
                initSound();
            } catch (soundErr) {
                console.error(LOG_PREFIX, 'initSound failed', soundErr);
            }
            try {
                initResultInjection();
            } catch (resultErr) {
                console.error(LOG_PREFIX, 'initResultInjection failed', resultErr);
            }
            try {
                initThreads();
            } catch (threadsErr) {
                console.error(LOG_PREFIX, 'initThreads failed', threadsErr);
            }
            // After the bonds and before the modules: its GENERATION_STARTED search is put first,
            // so it finishes before any module reads its picks. Off by default; off changes nothing.
            try {
                initVectors();
            } catch (vectorsErr) {
                console.error(LOG_PREFIX, 'initVectors failed', vectorsErr);
            }
            primeLore().catch(err => debugLog('Could not read linked lorebook entries', err));
            eventSource.on(event_types.CHAT_CHANGED, () => primeLore().catch(() => { }));
            // Modules adapted from the RPG suite (AGPL-3.0). Each loads on its own, so one
            // failing, or one folder missing, takes nothing else with it.
            // A failure is said out loud (console and one toast) and kept, so the Modules tab can
            // show the real error where the module's pane should be.
            for (const name of ['phone', 'games', 'combat', 'scene', 'activities']) {
                recordModuleLoad(name, 'loading');
                import(`./modules/${name}/${name}.js`)
                    .then(() => {
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = new URL(`./modules/${name}/${name}.css`, import.meta.url).href;
                        document.head.append(link);
                        recordModuleLoad(name, 'loaded');
                    })
                    .catch(err => {
                        console.error(LOG_PREFIX, `Module "${name}" failed to load`, err);
                        recordModuleLoad(name, 'failed', err);
                        try {
                            toastr.error(`The ${name} module failed to load: ${err?.message || err}`, PRODUCT_NAME, { preventDuplicates: true });
                        } catch { /* toastr not there */ }
                    });
            }
        } catch (err) {
            console.error(LOG_PREFIX, 'fork features failed to start', err);
        }
        /* A preset carries its own prompt list, so loading one throws away the entries
           the two writing prompts are placed by - not the settings that ask for them.
           Written again here, which puts them back at the foot of the new list.
           Nothing happens for a block that is not managed there. */
        eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
            try {
                applyDialogueFormatPrompt();
                applyDeliveryPrompt();
            } catch (err) {
                debugLog('Could not put the writing prompts back after the preset change', err);
            }
        });

        // Logged beside Worldkit's own request lines, so "what does the chat use" and
        // "what does the extension use" can be compared at a glance instead of by reading
        // secrets.json. Dry runs are skipped: SillyTavern fires several per message while
        // measuring the prompt, and they would bury the real one.
        eventSource.on(event_types.GENERATION_STARTED, (_type, _options, dryRun) => {
            if (dryRun) return;
            debugLog(describeChatConnection());
            // Here rather than in the tracker's own handler: that one returns early when
            // the tracker is off, and the chat is still decorated then.
            try {
                applyDialogueFormatPrompt();
                applyDeliveryPrompt();
                ensureDeliveryScriptsOn();
                applyBanList();
                applyHistoryInjection();
            } catch (err) {
                debugLog('Could not set what is injected into the story prompt', err);
            }
        });

        /* Fires while SillyTavern assembles the story prompt, and - contrary to what this
           comment used to say - in time to change it. getWorldInfoPrompt, which emits
           this, is awaited at script.js:4576; doChatInject, which reads our IN_CHAT
           blocks, runs at 4686.

           So the scene block is written again here, now that we know whose entries fired.
           A character whose lore reached the prompt without their stats or their profile
           is one the narrator has to invent the moment it gives them a line. */
        eventSource.on(event_types.WORLD_INFO_ACTIVATED, (entries) => {
            try {
                noteActivatedLore(entries);
            } catch (err) {
                debugLog('Could not record activated lore', err);
            }
        });

        // A connection profile can carry a Regex preset, which switches off every script not in it, ours included. Put the
        // delivery scripts back on and redraw the chat, which was drawn while they were off.
        eventSource.on(event_types.CONNECTION_PROFILE_LOADED, async () => {
            try { if (ensureDeliveryScriptsOn()) await reloadCurrentChat(); } catch (err) { debugLog('Delivery scripts not restored after a profile change', err); }
        });
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
        eventSource.on(event_types.USER_MESSAGE_RENDERED, onMessageRendered);
        eventSource.on(event_types.MESSAGE_UPDATED, onMessageRendered);
        // Swiping between replies that already exist rewrites the message in place and
        // emits nothing else - no generation runs, so CHARACTER_MESSAGE_RENDERED never
        // fires. The new text arrived undecorated and stayed that way until something
        // else redrew the chat.
        eventSource.on(event_types.MESSAGE_SWIPED, onSwipe);
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
            // The signature describes the settings, not the DOM, and these two change
            // which messages exist without changing a setting - so they have to say
            // so, or a redraw that has learned to decline will decline this one.
            invalidateChatRender();
            reprocessAllMessages();
        });
        eventSource.on(event_types.CHAT_CHANGED, () => {
            invalidateChatRender();
            reprocessAllMessages();
        });
        // Entries written before they carried a heading are named here, once, rather than
        // waiting to be regenerated by hand. It writes only where something differs, so a
        // chat switch with nothing to fix touches no files.
        eventSource.on(event_types.CHAT_CHANGED, () => {
            repairEntryIdentities().catch(err =>
                console.error(LOG_PREFIX, 'Naming lorebook entries failed', err));
        });
        eventSource.on(event_types.CHAT_CHANGED, () => {
            syncLorebookScope().catch(err => console.error(LOG_PREFIX, 'syncLorebookScope failed', err));
        });
        eventSource.on(event_types.CHARACTER_EDITED, () => {
            try {
                reprocessAllMessages();
            } catch (err) {
                console.error(LOG_PREFIX, 'CHARACTER_EDITED HUD update failed', err);
            }
        });

        eventSource.on('sillynpc-player-portrait-changed', () => {
            try {
                reprocessAllMessages();
            } catch (err) {
                console.error(LOG_PREFIX, 'player portrait refresh failed', err);
            }
        });

        eventSource.on('sillynpc-open-manage', (data) => {
            openManagePopup(data).catch(err => console.error(LOG_PREFIX, 'openManagePopup failed', err));
        });

        console.log(LOG_PREFIX, 'extension loaded successfully', { extensionName });
    } catch (err) {
        console.error(LOG_PREFIX, 'CRITICAL: Extension failed to load during jQuery ready!', err);
    }
});

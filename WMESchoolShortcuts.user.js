// ==UserScript==
// @name         WME School Shortcuts
// @namespace    https://github.com/
// @version      1.0.1
// @description  Keyboard shortcuts for creating School Zones and School Area Places in WME.
// @author       Thynamelessone
// @match        https://www.waze.com/*editor*
// @match        https://beta.waze.com/*editor*
// @exclude      https://www.waze.com/*user/*editor/*
// @grant        none
// @require https://cdn.jsdelivr.net/gh/TheEditorX/wme-sdk-plus@1234567890abcdef1234567890abcdef12345678/wme-sdk-plus.js
// @require     https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @downloadURL  https://github.com/Thynamelessone/WME-School-Shortcuts/raw/refs/heads/main/WMESchoolShortcuts.user.js
// @updateURL    https://github.com/Thynamelessone/WME-School-Shortcuts/raw/refs/heads/main/WMESchoolShortcuts.user.js
// ==/UserScript==

(function () {
    "use strict";
    const SCRIPT_ID = "WME-School-Shortcuts";
    const SCRIPT_NAME = "WME School Shortcuts";
    const updateMessage = "";
    WazeWrap.Interface.ShowScriptUpdate('WME School Shortcuts', GM_info.script.version, updateMessage);
    const SHORTCUT_GROUP_ID = `${SCRIPT_ID}-shortcuts`;

    const SHORTCUT_IDS = {
        schoolPlace: `${SCRIPT_ID}-create-school-place`,
        schoolZone: `${SCRIPT_ID}-create-school-zone`,
    };

    /*
     * Default shortcuts
     *
     * CS+S = Ctrl + Shift + S
     * AS+S = Alt + Shift + S
     */

    const DEFAULT_SHORTCUTS = {
        schoolPlace: "CS+S",
        schoolZone: "AS+S",
    };

    let sdk = null;

    function isDrawCancelled(error) {
        if (!error) {
            return false;
        }

        const message =
            String(error?.message || error);

        return (
            message.toLowerCase().includes("draw has been cancelled") ||
            message.toLowerCase().includes("draw was cancelled") ||
            message.toLowerCase().includes("drawing cancelled")
        );
    }

    function selectVenue(venueId) {
        try {
            sdk.Editing.setSelection({
                selection: {
                    ids: [String(venueId)],
                    objectType: "venue",
                },
            });

        } catch (error) {
            console.error(
                `[${SCRIPT_NAME}] Failed to select School Area Place.`,
                error
            );
        }
    }

    function selectPermanentHazard(hazardId) {
        try {
            sdk.Editing.setSelection({
                selection: {
                    ids: [Number(hazardId)],
                    objectType: "permanentHazard",
                },
            });

        } catch (error) {
            console.error(
                `[${SCRIPT_NAME}] Failed to select School Zone.`,
                error
            );
        }
    }

    async function createSchoolZone() {
        if (!sdk) {
            console.error(
                `[${SCRIPT_NAME}] SDK is not available.`
            );
            return;
        }

        if (!sdk.DataModel?.PermanentHazards?.addSchoolZone) {
            console.error(
                `[${SCRIPT_NAME}] School Zone creation is unavailable.`
            );

            alert(
                `${SCRIPT_NAME}\n\n` +
                `School Zone creation is unavailable.\n\n` +
                `WME SDK+ did not initialise correctly.`
            );

            return;
        }

        try {
            const geometry =
                await sdk.Map.drawPolygon();

            if (!geometry) {
                return;
            }

            const schoolZoneId =
                await sdk.DataModel.PermanentHazards.addSchoolZone({
                    geometry,
                });

            setTimeout(() => {
                selectPermanentHazard(
                    schoolZoneId
                );
            }, 100);

        } catch (error) {

            if (isDrawCancelled(error)) {
                return;
            }

            console.error(
                `[${SCRIPT_NAME}] Failed to create School Zone.`,
                error
            );

            alert(
                `${SCRIPT_NAME}\n\n` +
                `Failed to create School Zone:\n\n` +
                `${error?.message || error}`
            );
        }
    }

    async function createSchoolAreaPlace() {
        if (!sdk) {
            console.error(
                `[${SCRIPT_NAME}] SDK is not available.`
            );
            return;
        }

        try {
            const geometry =
                await sdk.Map.drawPolygon();

            if (!geometry) {
                return;
            }

            const venueId =
                sdk.DataModel.Venues.addVenue({
                    category: "SCHOOL",
                    geometry,
                });

            setTimeout(() => {
                selectVenue(venueId);
            }, 100);

        } catch (error) {

            if (isDrawCancelled(error)) {
                return;
            }

            console.error(
                `[${SCRIPT_NAME}] Failed to create School Area Place.`,
                error
            );

            alert(
                `${SCRIPT_NAME}\n\n` +
                `Failed to create School Area Place:\n\n` +
                `${error?.message || error}`
            );
        }
    }

    function registerShortcutGroup() {
        if (!sdk?.Shortcuts?.addShortcutGroup) {
            console.error(
                `[${SCRIPT_NAME}] addShortcutGroup() is unavailable.`
            );

            return false;
        }

        try {
            sdk.Shortcuts.addShortcutGroup({
                groupId: SHORTCUT_GROUP_ID,
                groupName: SCRIPT_NAME,
            });

            return true;

        } catch (error) {
            return true;
        }
    }

    function registerShortcut({
        shortcutId,
        description,
        shortcutKeys,
        callback,
    }) {
        try {
            if (
                sdk.Shortcuts.isShortcutRegistered({
                    shortcutId,
                })
            ) {
                sdk.Shortcuts.deleteShortcut({
                    shortcutId,
                });
            }

            try {
                sdk.Shortcuts.createShortcut({
                    callback,
                    description,
                    shortcutId,
                    shortcutKeys,
                });

                return true;

            } catch (error) {

                console.warn(
                    `[${SCRIPT_NAME}] Could not register ${description} with ${shortcutKeys}.`,
                    error
                );

                sdk.Shortcuts.createShortcut({
                    callback,
                    description,
                    shortcutId,
                    shortcutKeys: null,
                });

                return true;
            }

        } catch (error) {
            console.error(
                `[${SCRIPT_NAME}] Failed to register ${description}.`,
                error
            );

            return false;
        }
    }

    function registerKeyboardShortcuts() {

        const schoolPlace =
            registerShortcut({
                shortcutId:
                    SHORTCUT_IDS.schoolPlace,

                description:
                    "Create School Area Place",

                shortcutKeys:
                    DEFAULT_SHORTCUTS.schoolPlace,

                callback:
                    createSchoolAreaPlace,
            });

        const schoolZone =
            registerShortcut({
                shortcutId:
                    SHORTCUT_IDS.schoolZone,

                description:
                    "Create School Zone",

                shortcutKeys:
                    DEFAULT_SHORTCUTS.schoolZone,

                callback:
                    createSchoolZone,
            });

        return {
            schoolZone,
            schoolPlace,
        };
    }

    async function initialise() {
        try {

            if (
                typeof getWmeSdk !== "function"
            ) {
                throw new Error(
                    "WME SDK is unavailable."
                );
            }

            const wmeSdk =
                getWmeSdk({
                    scriptId: SCRIPT_ID,
                    scriptName: SCRIPT_NAME,
                });

            await wmeSdk.Events.once({
                eventName: "wme-ready",
            });

            if (
                typeof initWmeSdkPlus ===
                "function"
            ) {
                try {

                    const sdkPlus =
                        await initWmeSdkPlus(
                            wmeSdk,
                            {
                                hooks: [
                                    "DataModel.PermanentHazards",
                                ],
                            }
                        );

                    sdk =
                        sdkPlus ||
                        wmeSdk;

                } catch (error) {

                    sdk = wmeSdk;

                    console.error(
                        `[${SCRIPT_NAME}] SDK+ initialisation failed.`,
                        error
                    );
                }

            } else {

                sdk = wmeSdk;

                console.error(
                    `[${SCRIPT_NAME}] initWmeSdkPlus() is unavailable.`
                );
            }

            window.wmeSchoolShortcutsSdk = sdk;

            registerShortcutGroup();

            registerKeyboardShortcuts();

        } catch (error) {

            console.error(
                `[${SCRIPT_NAME}] Initialisation failed.`,
                error
            );
        }
    }

    if (
        window.SDK_INITIALIZED &&
        typeof window.SDK_INITIALIZED.then ===
            "function"
    ) {

        window.SDK_INITIALIZED.then(
            initialise
        );

    } else {

        console.error(
            `[${SCRIPT_NAME}] SDK_INITIALIZED is unavailable.`
        );
    }

})();
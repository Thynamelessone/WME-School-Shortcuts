// ==UserScript==
// @name        WME School Shortcuts
// @namespace   https://github.com/
// @version     1.0.4-beta.1
// @description Keyboard shortcuts for creating School Zones and School Area Places in WME.
// @author      Thynamelessone
// @match       https://www.waze.com/*editor*
// @match       https://beta.waze.com/*editor*
// @exclude     https://www.waze.com/*user/*editor/*
// @grant       none
// @require     https://cdn.jsdelivr.net/gh/TheEditorX/wme-sdk-plus@72968ef0792a3bd673f768f8ee2a10d67653d1ea/wme-sdk-plus.js
// @require     https://greasyfork.org/scripts/24851-wazewrap/code/WazeWrap.js
// @downloadURL https://github.com/Thynamelessone/WME-School-Shortcuts/raw/refs/heads/main/WMESchoolShortcuts.user.js
// @updateURL   https://github.com/Thynamelessone/WME-School-Shortcuts/raw/refs/heads/main/WMESchoolShortcuts.user.js
// ==/UserScript==

(function () {
    "use strict";
    const SCRIPT_ID = "WME-School-Shortcuts";
    const SCRIPT_NAME = "WME School Shortcuts";
    const updateMessage = "Fix bug if drawing tool is already selected";
    WazeWrap.Interface.ShowScriptUpdate(SCRIPT_NAME, GM_info.script.version, updateMessage);

    const SHORTCUT_GROUP_ID =
        `${SCRIPT_ID}-shortcuts`;

    const SHORTCUT_IDS = {
        schoolPlace:
            `${SCRIPT_ID}-create-school-place`,

        schoolZone:
            `${SCRIPT_ID}-create-school-zone`,
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


    /*
     * ---------------------------------------------------------
     * Helpers
     * ---------------------------------------------------------
     */

    function isDrawCancelled(error) {
        if (!error) {
            return false;
        }

        const message =
            String(error?.message || error).toLowerCase();

        return (
            message.includes("draw has been cancelled") ||
            message.includes("draw was cancelled") ||
            message.includes("drawing cancelled")
        );
    }


    function selectVenue(venueId) {
        if (venueId == null) {
            return;
        }

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
        if (hazardId == null) {
            return;
        }

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

/********************************************************************
 * CANCEL ANY ACTIVE WME DRAWING TOOL
 ********************************************************************/

function cancelActiveDrawing() {
    try {
        if (!sdk?.Editing?.isDrawingInProgress()) {
            return;
        }

        /*
         * WME's native drawing controls are still available through
         * the WME map object.
         *
         * Find any active OpenLayers drawing control and deactivate it.
         */
        if (
            typeof W !== "undefined" &&
            W.map &&
            Array.isArray(W.map.controls)
        ) {
            W.map.controls.forEach((control) => {
                if (
                    control?.handler &&
                    control.handler.active &&
                    typeof control.deactivate === "function"
                ) {
                    control.deactivate();
                }
            });
        }

    } catch (error) {
        console.debug(
            `[${SCRIPT_NAME}] Could not cancel active drawing.`,
            error
        );
    }
}


/********************************************************************
 * CREATE SCHOOL ZONE
 ********************************************************************/

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

        /*
         * If another WME drawing tool is already active,
         * cancel it first.
         */
        cancelActiveDrawing();

        /*
         * Give WME a moment to finish deactivating the previous
         * drawing control before starting the new one.
         */
        await new Promise(resolve => setTimeout(resolve, 50));

        /*
         * Start School Zone drawing.
         */
        const geometry =
            await sdk.Map.drawPolygon();

        /*
         * User cancelled drawing.
         */
        if (!geometry) {
            return;
        }

        /*
         * Create the School Zone.
         */
        const schoolZoneId =
            await sdk.DataModel.PermanentHazards.addSchoolZone({
                geometry,
            });

        console.log(
            `[${SCRIPT_NAME}] School Zone created:`,
            schoolZoneId
        );

        /*
         * Select the newly-created School Zone.
         */
        setTimeout(() => {
            selectPermanentHazard(
                schoolZoneId
            );
        }, 100);

    } catch (error) {

        /*
         * User cancelled the drawing.
         */
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


/********************************************************************
 * CREATE SCHOOL AREA PLACE
 ********************************************************************/

async function createSchoolAreaPlace() {
    if (!sdk) {
        console.error(
            `[${SCRIPT_NAME}] SDK is not available.`
        );
        return;
    }

    try {

        /*
         * If another WME drawing tool is already active,
         * cancel it first.
         */
        cancelActiveDrawing();

        /*
         * Give WME a moment to finish deactivating the previous
         * drawing control before starting the new one.
         */
        await new Promise(resolve => setTimeout(resolve, 50));

        /*
         * Start School Area Place drawing.
         */
        const geometry =
            await sdk.Map.drawPolygon();

        /*
         * User cancelled drawing.
         */
        if (!geometry) {
            return;
        }

        /*
         * Create the School Area Place.
         */
        const venueId =
            sdk.DataModel.Venues.addVenue({
                category: "SCHOOL",
                geometry,
            });

        console.log(
            `[${SCRIPT_NAME}] School Area Place created:`,
            venueId
        );

        /*
         * Select the newly-created School Area Place.
         */
        setTimeout(() => {
            selectVenue(venueId);
        }, 100);

    } catch (error) {

        /*
         * User cancelled the drawing.
         */
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

    /*
     * ---------------------------------------------------------
     * Shortcut registration
     * ---------------------------------------------------------
     */

    function registerShortcutGroup() {
        if (
            !sdk?.Shortcuts?.addShortcutGroup
        ) {
            console.error(
                `[${SCRIPT_NAME}] addShortcutGroup() is unavailable.`
            );

            return false;
        }

        try {
            sdk.Shortcuts.addShortcutGroup({
                groupId:
                    SHORTCUT_GROUP_ID,

                groupName:
                    SCRIPT_NAME,
            });

            return true;

        } catch (error) {

            /*
             * The group may already exist.
             * This is harmless.
             */

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

            /*
             * Remove an existing registration first.
             */

            if (
                sdk.Shortcuts.isShortcutRegistered({
                    shortcutId,
                })
            ) {
                sdk.Shortcuts.deleteShortcut({
                    shortcutId,
                });
            }


            /*
             * Try to register with the requested
             * shortcut combination.
             */

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
                    `[${SCRIPT_NAME}] Could not register ` +
                    `${description} with ${shortcutKeys}.`,
                    error
                );


                /*
                 * Fall back to WME's shortcut manager
                 * without explicitly specifying keys.
                 */

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


    /*
     * ---------------------------------------------------------
     * Initialisation
     * ---------------------------------------------------------
     */

    async function initialise() {
        try {

            console.log(
                `[${SCRIPT_NAME}] Initialising...`
            );


            /*
             * WME SDK
             */

            if (
                typeof getWmeSdk !== "function"
            ) {
                throw new Error(
                    "WME SDK is unavailable."
                );
            }


            /*
             * SDK+
             */

            if (
                typeof initWmeSdkPlus !== "function"
            ) {
                throw new Error(
                    "WME SDK+ is unavailable."
                );
            }


            const wmeSdk =
                getWmeSdk({
                    scriptId:
                        SCRIPT_ID,

                    scriptName:
                        SCRIPT_NAME,
                });


            /*
             * Wait for WME itself to be ready.
             */

            await wmeSdk.Events.once({
                eventName: "wme-ready",
            });

            console.log(
                `[${SCRIPT_NAME}] WME SDK ready.`
            );


            /*
             * Initialise SDK+ with only the hook
             * required for School Zones.
             */

            console.log(
                `[${SCRIPT_NAME}] Initialising WME SDK+...`
            );

            const sdkPlus =
                await initWmeSdkPlus(
                    wmeSdk,
                    {
                        hooks: [
                            "DataModel.PermanentHazards",
                        ],
                    }
                );


            /*
             * SDK+ normally enhances the existing
             * WME SDK instance.
             */

            sdk =
                sdkPlus ||
                wmeSdk;


            /*
             * Make absolutely sure the School Zone
             * API is available before registering
             * the keyboard shortcuts.
             */

            if (
                typeof sdk.DataModel?.PermanentHazards?.addSchoolZone !==
                "function"
            ) {
                throw new Error(
                    "WME SDK+ initialised, but " +
                    "DataModel.PermanentHazards.addSchoolZone() " +
                    "is unavailable."
                );
            }


            console.log(
                `[${SCRIPT_NAME}] School Zone API available.`
            );


            /*
             * Expose SDK for debugging.
             */

            window.wmeSchoolShortcutsSdk =
                sdk;


            /*
             * Register shortcuts.
             */

            registerShortcutGroup();

            const shortcuts =
                registerKeyboardShortcuts();


            console.log(
                `[${SCRIPT_NAME}] Shortcuts registered.`,
                shortcuts
            );

            console.log(
                `[${SCRIPT_NAME}] Initialisation complete.`
            );

        } catch (error) {

            console.error(
                `[${SCRIPT_NAME}] Initialisation failed.`,
                error
            );

            alert(
                `${SCRIPT_NAME}\n\n` +
                `Initialisation failed:\n\n` +
                `${error?.message || error}`
            );
        }
    }


    /*
     * ---------------------------------------------------------
     * Start
     * ---------------------------------------------------------
     */

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
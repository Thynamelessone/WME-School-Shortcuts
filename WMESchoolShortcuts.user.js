// ==UserScript==
// @name        WME School Shortcuts
// @namespace   https://github.com/
// @version     1.1.0-beta.1
// @description Keyboard shortcuts for creating School Area Places and School Zones in WME.
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
    const updateMessage = "New Feature: Convert Area Places to School Zones and vice versa";
    WazeWrap.Interface.ShowScriptUpdate(SCRIPT_NAME, GM_info.script.version, updateMessage);

    const SHORTCUT_GROUP_ID = `${SCRIPT_ID}-shortcuts`;

    const SHORTCUT_IDS = {
        schoolPlace: `${SCRIPT_ID}-create-school-place`,
        schoolZone: `${SCRIPT_ID}-create-school-zone`,
    };

    const DEFAULT_SHORTCUTS = {
        schoolPlace: "CS+S",
        schoolZone: "AS+S",
    };

    const CONVERT_BUTTON_IDS = {
        toSchoolZone: `${SCRIPT_ID}-convert-to-zone`,
        toAreaPlace: `${SCRIPT_ID}-convert-to-place`,
    };

    let sdk = null;
    let observer = null;

    /*
     * ---------------------------------------------------------
     * Helpers
     * ---------------------------------------------------------
     */

    function isDrawCancelled(error) {
        if (!error) return false;
        const message = String(error?.message || error).toLowerCase();
        return (
            message.includes("draw has been cancelled") ||
            message.includes("draw was cancelled") ||
            message.includes("drawing cancelled")
        );
    }

    function selectVenue(venueId) {
        if (venueId == null) return;
        try {
            sdk.Editing.setSelection({
                selection: { ids: [String(venueId)], objectType: "venue" },
            });
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Failed to select School Area Place.`, error);
        }
    }

    function selectPermanentHazard(hazardId) {
        if (hazardId == null) return;
        try {
            sdk.Editing.setSelection({
                selection: { ids: [Number(hazardId)], objectType: "permanentHazard" },
            });
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Failed to select School Zone.`, error);
        }
    }

    function cancelActiveDrawing() {
        try {
            if (!sdk?.Editing?.isDrawingInProgress()) return;
            if (typeof W !== "undefined" && W.map && Array.isArray(W.map.controls)) {
                W.map.controls.forEach((control) => {
                    if (control?.handler && control.handler.active && typeof control.deactivate === "function") {
                        control.deactivate();
                    }
                });
            }
        } catch (error) {
            console.debug(`[${SCRIPT_NAME}] Could not cancel active drawing.`, error);
        }
    }

    /*
     * ---------------------------------------------------------
     * Selection readers
     * ---------------------------------------------------------
     */

    function getCurrentSelection() {
        try {
            return sdk?.Editing?.getSelection?.() || null;
        } catch (error) {
            console.debug(`[${SCRIPT_NAME}] getSelection() failed.`, error);
            return null;
        }
    }

    function getSelectedSchoolVenue() {
        const selection = getCurrentSelection();
        if (!selection || selection.objectType !== "venue" || !selection.ids?.length) {
            return null;
        }

        const venueId = selection.ids[0];

        try {
            const venue = sdk.DataModel.Venues.getById({ venueId: String(venueId) });
            if (!venue) return null;

            const categories = venue.categories || (venue.category ? [venue.category] : []);
            if (!categories.includes("SCHOOL")) return null;

            return venue;
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Failed to read selected venue.`, error);
            return null;
        }
    }

    function getSelectedSchoolZoneHazard() {
        const selection = getCurrentSelection();
        if (!selection || selection.objectType !== "permanentHazard" || !selection.ids?.length) {
            return null;
        }

        const hazardId = selection.ids[0];

        // ⚠️ getById() on PermanentHazards is documented in beta but may not exist
        // in the production SDK depending on version. Fall back to searching the
        // WME internal model if the SDK call isn't available.
        try {
            if (typeof sdk.DataModel.PermanentHazards.getById === "function") {
                const hazard = sdk.DataModel.PermanentHazards.getById({ permanentHazardId: Number(hazardId) });
                if (hazard) return hazard;
            }
        } catch (error) {
            console.debug(`[${SCRIPT_NAME}] PermanentHazards.getById() unavailable, trying fallback.`, error);
        }

        // ⚠️ Fallback: reach into WME's internal model. Selector/property names
        // here may need adjusting if Waze changes their internal model shape.
        try {
            const internal =
                W?.model?.permanentHazards?.objects?.[hazardId] ||
                W?.model?.permanentHazards?.getObjectById?.(Number(hazardId));

            if (internal && (internal.attributes?.type === "SCHOOL_ZONE" || internal.type === "SCHOOL_ZONE")) {
                return internal;
            }
        } catch (error) {
            console.debug(`[${SCRIPT_NAME}] Internal model fallback failed.`, error);
        }

        return null;
    }

    function extractGeometry(feature) {
        return feature?.geometry || feature?.attributes?.geometry || null;
    }

    /*
     * ---------------------------------------------------------
     * Deletion helpers (the uncertain part)
     * ---------------------------------------------------------
     */

    async function deleteVenueById(venueId) {
        await sdk.DataModel.Venues.deleteVenue({ venueId: String(venueId) });
    }

    async function deletePermanentHazardById(hazardId) {
        const attempts = [
            // ⚠️ None of these are guaranteed to exist — tried in order,
            // first one that doesn't throw "wins".
            async () => sdk.DataModel.PermanentHazards.deletePermanentHazard({ permanentHazardId: Number(hazardId) }),
            async () => sdk.DataModel.PermanentHazards.deleteSchoolZone({ permanentHazardId: Number(hazardId) }),
            async () => sdk.DataModel.PermanentHazards.delete({ id: Number(hazardId) }),
            async () => {
                // Last-resort fallback via WME's internal action system.
                if (typeof W === "undefined" || !W.model?.actionManager) {
                    throw new Error("Internal action manager unavailable.");
                }
                const hazardObj =
                    W.model.permanentHazards?.objects?.[hazardId] ||
                    W.model.permanentHazards?.getObjectById?.(Number(hazardId));
                if (!hazardObj) {
                    throw new Error("Could not locate internal hazard object.");
                }
                if (typeof Waze === "undefined" || !Waze.Action?.DeletePermanentHazard) {
                    throw new Error("Waze.Action.DeletePermanentHazard unavailable.");
                }
                const action = new Waze.Action.DeletePermanentHazard(hazardObj);
                W.model.actionManager.add(action);
            },
        ];

        let lastError = null;

        for (const attempt of attempts) {
            try {
                await attempt();
                return true;
            } catch (error) {
                lastError = error;
            }
        }

        console.error(`[${SCRIPT_NAME}] Every deletion method failed for hazard ${hazardId}.`, lastError);
        return false;
    }

    /*
     * ---------------------------------------------------------
     * Conversions
     * ---------------------------------------------------------
     */

    async function convertVenueToSchoolZone(venue) {
        if (!sdk.DataModel?.PermanentHazards?.addSchoolZone) {
            alert(`${SCRIPT_NAME}\n\nSchool Zone creation is unavailable.\n\nWME SDK+ did not initialise correctly.`);
            return;
        }

        const geometry = extractGeometry(venue);
        if (!geometry) {
            alert(`${SCRIPT_NAME}\n\nCould not read the geometry of the selected School Area Place.`);
            return;
        }

        const venueId = venue.id ?? venue.venueId;

        try {
            const schoolZoneId = await sdk.DataModel.PermanentHazards.addSchoolZone({ geometry });

            const deleted = await deleteVenueById(venueId);
            if (deleted === false) {
                // deleteVenueById throws on failure rather than returning false,
                // this branch only guards against a future signature change.
                console.warn(`[${SCRIPT_NAME}] Venue deletion reported failure but no error was thrown.`);
            }

            console.log(`[${SCRIPT_NAME}] Converted School Area Place ${venueId} -> School Zone ${schoolZoneId}.`);

            setTimeout(() => selectPermanentHazard(schoolZoneId), 100);
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Failed to convert School Area Place to School Zone.`, error);
            alert(
                `${SCRIPT_NAME}\n\nFailed to convert to School Zone:\n\n${error?.message || error}\n\n` +
                    `If a new School Zone was created, the original School Area Place may still exist ` +
                    `and will need to be deleted manually.`
            );
        }
    }

    async function convertHazardToSchoolVenue(hazard) {
        const geometry = extractGeometry(hazard);
        if (!geometry) {
            alert(`${SCRIPT_NAME}\n\nCould not read the geometry of the selected School Zone.`);
            return;
        }

        const hazardId = hazard.id ?? hazard.permanentHazardId;

        try {
            const venueId = sdk.DataModel.Venues.addVenue({
                category: "SCHOOL",
                geometry,
            });

            const deleted = await deletePermanentHazardById(hazardId);

            console.log(`[${SCRIPT_NAME}] Converted School Zone ${hazardId} -> School Area Place ${venueId}.`);

            if (!deleted) {
                alert(
                    `${SCRIPT_NAME}\n\n` +
                        `Created the new School Area Place, but could not automatically delete the ` +
                        `original School Zone (no working deletion method found on this WME SDK version).\n\n` +
                        `Please delete the old School Zone manually.`
                );
            }

            setTimeout(() => selectVenue(venueId), 100);
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Failed to convert School Zone to School Area Place.`, error);
            alert(`${SCRIPT_NAME}\n\nFailed to convert to School Area Place:\n\n${error?.message || error}`);
        }
    }

    /*
     * ---------------------------------------------------------
     * Create (draw) functions
     * ---------------------------------------------------------
     */

    async function createSchoolZone() {
        if (!sdk) return console.error(`[${SCRIPT_NAME}] SDK is not available.`);

        if (!sdk.DataModel?.PermanentHazards?.addSchoolZone) {
            console.error(`[${SCRIPT_NAME}] School Zone creation is unavailable.`);
            alert(`${SCRIPT_NAME}\n\nSchool Zone creation is unavailable.\n\nWME SDK+ did not initialise correctly.`);
            return;
        }

        const existingVenue = getSelectedSchoolVenue();
        if (existingVenue) {
            return convertVenueToSchoolZone(existingVenue);
        }

        try {
            cancelActiveDrawing();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const geometry = await sdk.Map.drawPolygon();
            if (!geometry) return;

            const schoolZoneId = await sdk.DataModel.PermanentHazards.addSchoolZone({ geometry });
            console.log(`[${SCRIPT_NAME}] School Zone created:`, schoolZoneId);

            setTimeout(() => selectPermanentHazard(schoolZoneId), 100);
        } catch (error) {
            if (isDrawCancelled(error)) return;
            console.error(`[${SCRIPT_NAME}] Failed to create School Zone.`, error);
            alert(`${SCRIPT_NAME}\n\nFailed to create School Zone:\n\n${error?.message || error}`);
        }
    }

    async function createSchoolAreaPlace() {
        if (!sdk) return console.error(`[${SCRIPT_NAME}] SDK is not available.`);

        const existingHazard = getSelectedSchoolZoneHazard();
        if (existingHazard) {
            return convertHazardToSchoolVenue(existingHazard);
        }

        try {
            cancelActiveDrawing();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const geometry = await sdk.Map.drawPolygon();
            if (!geometry) return;

            const venueId = sdk.DataModel.Venues.addVenue({ category: "SCHOOL", geometry });
            console.log(`[${SCRIPT_NAME}] School Area Place created:`, venueId);

            setTimeout(() => selectVenue(venueId), 100);
        } catch (error) {
            if (isDrawCancelled(error)) return;
            console.error(`[${SCRIPT_NAME}] Failed to create School Area Place.`, error);
            alert(`${SCRIPT_NAME}\n\nFailed to create School Area Place:\n\n${error?.message || error}`);
        }
    }

    /*
     * ---------------------------------------------------------
     * Shortcut registration
     * ---------------------------------------------------------
     */

    function registerShortcutGroup() {
        if (!sdk?.Shortcuts?.addShortcutGroup) {
            console.error(`[${SCRIPT_NAME}] addShortcutGroup() is unavailable.`);
            return false;
        }

        try {
            sdk.Shortcuts.addShortcutGroup({ groupId: SHORTCUT_GROUP_ID, groupName: SCRIPT_NAME });
            return true;
        } catch (error) {
            return true; // group probably already exists
        }
    }

    function registerShortcut({ shortcutId, description, shortcutKeys, callback }) {
        try {
            if (sdk.Shortcuts.isShortcutRegistered({ shortcutId })) {
                sdk.Shortcuts.deleteShortcut({ shortcutId });
            }

            try {
                sdk.Shortcuts.createShortcut({ callback, description, shortcutId, shortcutKeys });
                return true;
            } catch (error) {
                console.warn(`[${SCRIPT_NAME}] Could not register ${description} with ${shortcutKeys}.`, error);
                sdk.Shortcuts.createShortcut({ callback, description, shortcutId, shortcutKeys: null });
                return true;
            }
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Failed to register ${description}.`, error);
            return false;
        }
    }

    function registerKeyboardShortcuts() {
        const schoolPlace = registerShortcut({
            shortcutId: SHORTCUT_IDS.schoolPlace,
            description: "Create/Convert School Area Place",
            shortcutKeys: DEFAULT_SHORTCUTS.schoolPlace,
            callback: createSchoolAreaPlace,
        });

        const schoolZone = registerShortcut({
            shortcutId: SHORTCUT_IDS.schoolZone,
            description: "Create/Convert School Zone",
            shortcutKeys: DEFAULT_SHORTCUTS.schoolZone,
            callback: createSchoolZone,
        });

        return { schoolZone, schoolPlace };
    }

    /*
     * ---------------------------------------------------------
     * Feature editor button injection
     * ---------------------------------------------------------
     */

    function makeConvertButton({ id, label, onClick }) {
        const existing = document.getElementById(id);
        if (existing) existing.remove();

        const btn = document.createElement("button");
        btn.id = id;
        btn.type = "button";
        btn.textContent = label;
        btn.className = "waze-btn waze-btn-white";
        btn.style.cssText = "margin: 8px 0; width: 100%; display: block;";

        btn.addEventListener("click", async (event) => {
            event.preventDefault();
            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = "Converting…";
            try {
                await onClick();
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });

        return btn;
    }

    function injectVenueConvertButton() {
        const venue = getSelectedSchoolVenue();
        if (!venue) return;

        // ⚠️ Selector guess based on the original script's comment.
        // Adjust if WME's venue editor panel structure has changed.
        const panel =
            document.querySelector("#venue-edit-general") ||
            document.querySelector(".venue-edit-general") ||
            document.querySelector("wz-panel[data-testid='venue-feature-editor'] .feature-editor-panel-content");

        if (!panel) return;

        const button = makeConvertButton({
            id: CONVERT_BUTTON_IDS.toSchoolZone,
            label: "Convert to School Zone",
            onClick: () => convertVenueToSchoolZone(venue),
        });

        panel.insertBefore(button, panel.firstChild);
    }

    function injectHazardConvertButton() {
        const hazard = getSelectedSchoolZoneHazard();
        if (!hazard) return;

        // ⚠️ Selector guess based on the original script's comment.
        // Adjust if WME's permanent hazard editor panel structure has changed.
        const panel =
            document.querySelector(".permanent-hazard-feature-editor") ||
            document.querySelector("wz-panel[data-testid='permanent-hazard-feature-editor'] .feature-editor-panel-content");

        if (!panel) return;

        const button = makeConvertButton({
            id: CONVERT_BUTTON_IDS.toAreaPlace,
            label: "Convert to School Area Place",
            onClick: () => convertHazardToSchoolVenue(hazard),
        });

        panel.insertBefore(button, panel.firstChild);
    }

    function removeStaleConvertButtons() {
        const venue = getSelectedSchoolVenue();
        const hazard = getSelectedSchoolZoneHazard();

        if (!venue) document.getElementById(CONVERT_BUTTON_IDS.toSchoolZone)?.remove();
        if (!hazard) document.getElementById(CONVERT_BUTTON_IDS.toAreaPlace)?.remove();
    }

    function refreshConvertButtons() {
        removeStaleConvertButtons();
        injectVenueConvertButton();
        injectHazardConvertButton();
    }

    function watchFeatureEditor() {
        // React to WME's own selection-changed event when available...
        try {
            sdk.Events.on({
                eventName: "wme-selection-changed",
                eventHandler: () => setTimeout(refreshConvertButtons, 150),
            });
        } catch (error) {
            console.debug(`[${SCRIPT_NAME}] wme-selection-changed event unavailable.`, error);
        }

        // ...and also fall back to a DOM observer, since the editor panel
        // is rendered asynchronously and selector-based hooks can be timing-sensitive.
        observer = new MutationObserver(() => {
            refreshConvertButtons();
        });

        const sidebar = document.getElementById("sidebar") || document.body;
        observer.observe(sidebar, { childList: true, subtree: true });
    }

    /*
     * ---------------------------------------------------------
     * Initialisation
     * ---------------------------------------------------------
     */

    async function initialise() {
        try {
            console.log(`[${SCRIPT_NAME}] Initialising...`);

            if (typeof getWmeSdk !== "function") throw new Error("WME SDK is unavailable.");
            if (typeof initWmeSdkPlus !== "function") throw new Error("WME SDK+ is unavailable.");

            const wmeSdk = getWmeSdk({ scriptId: SCRIPT_ID, scriptName: SCRIPT_NAME });

            await wmeSdk.Events.once({ eventName: "wme-ready" });
            console.log(`[${SCRIPT_NAME}] WME SDK ready.`);

            console.log(`[${SCRIPT_NAME}] Initialising WME SDK+...`);
            const sdkPlus = await initWmeSdkPlus(wmeSdk, {
                hooks: ["DataModel.PermanentHazards"],
            });

            sdk = sdkPlus || wmeSdk;

            if (typeof sdk.DataModel?.PermanentHazards?.addSchoolZone !== "function") {
                throw new Error(
                    "WME SDK+ initialised, but DataModel.PermanentHazards.addSchoolZone() is unavailable."
                );
            }

            console.log(`[${SCRIPT_NAME}] School Zone API available.`);

            window.wmeSchoolShortcutsSdk = sdk;

            registerShortcutGroup();
            const shortcuts = registerKeyboardShortcuts();
            console.log(`[${SCRIPT_NAME}] Shortcuts registered.`, shortcuts);

            watchFeatureEditor();
            console.log(`[${SCRIPT_NAME}] Feature editor watcher active.`);

            console.log(`[${SCRIPT_NAME}] Initialisation complete.`);
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] Initialisation failed.`, error);
            alert(`${SCRIPT_NAME}\n\nInitialisation failed:\n\n${error?.message || error}`);
        }
    }

    /*
     * ---------------------------------------------------------
     * Start
     * ---------------------------------------------------------
     */

    if (window.SDK_INITIALIZED && typeof window.SDK_INITIALIZED.then === "function") {
        window.SDK_INITIALIZED.then(initialise);
    } else {
        console.error(`[${SCRIPT_NAME}] SDK_INITIALIZED is unavailable.`);
    }
})();